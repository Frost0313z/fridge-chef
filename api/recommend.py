"""
POST /api/recommend
입력한 재료로 AI가 만들 수 있는 요리를 추천하는 Vercel Serverless Function.

요청 페이로드: {"ingredients": str, "portion": str, "timeLimit": str, "category": str}
(healthy는 UI/UX와 함께 뺐다(2026-08-20) — 보내도 무시한다. build_user_prompt의 주석 참고.)
반환(200): {"recipes": [{"name": str, "searchKeyword": str, "time": str, "ingredients": [str], "steps": [str]}]}
반환(4xx/5xx): {"error": str, "message": str}  # message는 화면에 그대로 표시할 한국어 안내문
"""

import recipe_match
from _common import BASIC_SEASONINGS, call_openai, to_str_list
from shopping import find_owned, normalize_name, parse_line

SYSTEM_PROMPT = """당신은 냉장고에 있는 재료로 만들 수 있는 한식/양식/중식 요리를 추천하는 요리 도우미입니다.
사용자가 알려준 재료를 최대한 활용하는 요리 1~3개를 추천하세요.
소금, 후추, 식용유, 물처럼 대부분의 가정에 있는 기본 조미료는 목록에 없어도 사용할 수 있다고 가정합니다.
사용자가 알려주지 않은 값비싸거나 특수한 재료를 임의로 추가하지 마세요.

당신은 실제로 존재하는 레시피 중에 이 재료 조합과 충분히 겹치는 것이 없어서 대신 호출됐습니다.
그러니 완전히 새로운 요리를 창작하기보다, 사용자가 가진 재료를 최대한 그대로 살리는 조합을
우선하세요. 특이하거나 낯선 조합보다, 평범해도 실제로 이 재료들로 바로 만들 수 있는 요리가
더 낫습니다.

사용자는 혼자 사는 자취생입니다. 이건 선택 사항이 아니라 항상 참인 전제입니다.
설거지가 적고 조리 과정이 간단한 요리를 우선하고, 특수한 조리도구가 필요한 요리는 피하세요.

재료 옆에 "(13일 전에 넣음)"처럼 냉장고에 들어온 지 오래됐다는 표시가 붙어 있을 수 있습니다.
그 재료는 곧 상해서 버리게 될 가능성이 높으니, 그것을 쓰는 요리를 반드시 먼저 추천하세요.
표시가 없는 재료는 최근에 넣은 것이라 급하지 않습니다. 재료를 버리지 않게 하는 것이
이 서비스의 목적이므로, 맛보다 이 순서를 우선합니다.

searchKeyword는 레시피 사이트에서 검색할 때 쓰는 값입니다. 수식어를 빼고 널리 쓰이는 짧은 요리 이름만
적으세요 (예: name이 "냉장고털이 두부 계란 덮밥"이면 searchKeyword는 "두부덮밥"). 검색어가 길면
엉뚱한 결과가 나오므로 되도록 두 단어를 넘기지 마세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 문장을 추가하지 마세요.
{
  "recipes": [
    {
      "name": "요리 이름",
      "searchKeyword": "검색용 짧은 요리 이름",
      "time": "예상 조리 시간 (예: 15분)",
      "ingredients": ["재료1", "재료2"],
      "steps": ["조리 순서 1", "조리 순서 2"]
    }
  ]
}"""


# 이전에는 "자취생 간단요리 / 가족 식사 / 다이어트·건강식" 3지선다였다.
# 타겟이 1인 가구 자취생으로 고정돼 있으므로 "가족 식사"는 모순이고 "자취생 간단요리"는
# 선택지가 아니라 기본값이어야 한다(SYSTEM_PROMPT로 승격). 세대 구성과 무관한 축 하나만 남긴다.
#
# 2026-08-20 매칭 결과가 있으면 이 힌트까지 안 가고 그대로 반환되므로(레시피 매칭이
# healthy를 모른다 — KADX 데이터에 칼로리·기름기 정보가 없다), 체크해도 매칭이 걸리면
# 조용히 무시됐다. UI/UX 제거하고 여기 로직은 되살릴 수 있게 주석만 처리해 남겨둔다.
# HEALTHY_HINT = "건강 관리를 신경 쓰는 중이야. 기름지거나 자극적인 조리법은 피하고 칼로리가 낮은 쪽으로 추천해줘."


MAX_RECIPES = 3

# 식단 계획의 "이번 주 후보" 목록 전용. AI로 채우지 않고 실제 매칭만 넉넉하게 돌려준다 —
# "지금 냉장고로 만들 수 있는 요리"라는 말 그대로를 지키려면 지어낸 레시피를 섞으면 안 된다.
POOL_MATCH_LIMIT = 10


def dedupe_key(name):
    """"김치볶음밥"과 "김치 볶음밥"을 같은 요리로 본다. 띄어쓰기만 지우고 그 이상은 하지 않는다 —
    "된장찌개"와 "차돌된장찌개"를 같다고 묶으면 멀쩡한 추천이 사라진다."""
    return name.replace(" ", "")


def _pantry_keys(ingredients_str):
    """사용자가 입력한 재료 문자열("계란 2개, 대파, 두부")을 비교용 이름 목록으로 바꾼다.
    parse_line은 shopping.py가 장보기 계산에 쓰는 것과 같은 함수다 — 수량·괄호 메모("13일
    전에 넣음")를 걷어내는 규칙이 여기서도 그대로 맞아야, 같은 재료를 다르게 읽지 않는다."""
    keys = []
    for raw in (ingredients_str or "").split(","):
        raw = raw.strip()
        if not raw:
            continue
        name, _, _ = parse_line(raw)
        if name:
            keys.append(normalize_name(name))
    return keys


def _unknown_ingredients(ingredients, pantry_keys):
    """레시피가 쓴 재료 중 사용자 재료에도, 기본 조미료에도 없는 것만 골라낸다.
    find_owned는 shopping.py가 "냉장고에 이 재료가 있는가"를 판단할 때 쓰는 것과 같은
    함수라, 여기서도 같은 기준으로 "있다/없다"를 가른다.

    레시피 쪽 재료도 parse_line으로 수량을 떼고 비교한다. 안 떼면 "물 1컵"이 "물"과
    글자가 달라 find_owned의 포함 비교에 기대게 되는데, 그 비교는 짧은 쪽이 한 글자면
    우연한 겹침으로 보고 거절한다 — 그래서 물·밥·쌀처럼 한 글자짜리는 수량이 붙는 순간
    영영 못 알아본다. 양쪽을 같은 방법으로 다듬어야 같은 것을 같다고 한다."""
    known = pantry_keys + list(BASIC_SEASONINGS)
    unknown = []
    for raw in ingredients:
        name, _, _ = parse_line(raw)
        key = normalize_name(name or raw)
        if key and not find_owned(key, known):
            unknown.append(raw)
    return unknown


def sanitize_recipes(raw, pantry_ingredients=None):
    """response_format으로 JSON은 보장되지만 '스키마'까지 보장되지는 않는다.
    이름 없는 항목은 버리고, 나머지 필드는 프론트가 기대하는 타입으로 맞춰서 내보낸다.

    pantry_ingredients(사용자가 입력한 재료 문자열)가 주어지면, 레시피의 ingredients에
    사용자가 갖고 있지 않고 기본 조미료도 아닌 재료가 하나라도 섞인 레시피는 통째로 버린다.
    "알려주지 않은 재료를 임의로 추가하지 마세요"는 SYSTEM_PROMPT가 지시만 할 뿐 강제하지
    않는다 — shopping.py가 장보기 합산을 AI에게 맡겼다가 34종 중 6종을 놓쳤던 것과 같은
    종류의 문제다("이 끼니에 뭐가 들어가는지"까지만 AI에게 맡기고, 맞는지 확인은 코드가 한다).
    일부 재료만 지우면 이름과 실제 재료 목록이 어긋나므로, 레시피 전체를 버린다."""
    if not isinstance(raw, list):
        return []

    pantry_keys = _pantry_keys(pantry_ingredients) if pantry_ingredients else None

    recipes = []
    dropped = []  # 재료 검증에 걸린 것. 남는 게 하나도 없을 때만 되살린다(아래 참고).
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        # 한 응답 안에 같은 요리를 두 번 주는 경우가 있다. 카드가 두 장 뜨면 추천이 아니라 고장으로 보인다.
        key = dedupe_key(name)
        if key in seen:
            continue
        seen.add(key)

        ingredients = to_str_list(item.get("ingredients"))
        recipe = {
            "name": name,
            # 비면 프론트가 name으로 대체한다. 옛 이력 데이터에도 이 필드가 없다.
            "searchKeyword": str(item.get("searchKeyword") or "").strip(),
            "time": str(item.get("time") or "").strip(),
            "ingredients": ingredients,
            "steps": to_str_list(item.get("steps")),
        }

        if pantry_keys is not None and ingredients and _unknown_ingredients(ingredients, pantry_keys):
            dropped.append(recipe)
            continue
        recipes.append(recipe)

    # 전부 걸렸다면 거른 것을 그대로 돌려준다. 이 검증은 이름을 글자로 맞춰보는 것이라
    # "달걀"과 "계란", "후춧가루"와 "후추"처럼 같은 것을 다르게 적으면 못 알아본다 —
    # 그때 빈 손으로 돌려보내면 화면은 "재료를 다르게 입력해보세요"라는 엉뚱한 말을 하고
    # 막다른 길이 된다(B7). 카드는 없는 재료에 이미 "사야 해요"를 붙이므로 속지도 않는다.
    # 검증은 결과의 질을 올리는 장치이지 결과를 없애는 장치가 아니다.
    return (recipes or dropped)[:MAX_RECIPES]


def build_user_prompt(ingredients, portion, time_limit, healthy, exclude=(), category=None):
    lines = [
        f"보유 재료: {ingredients}",
        # 혼자 먹는다는 전제이므로 "몇 인분"이 아니라 "몇 끼 분량"으로 전달한다.
        f"만들 분량: 혼자 먹을 {portion} 분량 (남으면 다음 끼니에 먹음)",
        f"희망 조리 시간: {time_limit}",
    ]
    if category and category != "상관없음":
        lines.append(f"요리 종류: {category}에 해당하는 요리로 추천해줘")
    # 건강 관리 필터 제거(2026-08-20) — 매칭 경로가 healthy를 몰라서 매칭이 걸리면 조용히
    # 무시됐다. HEALTHY_HINT 정의부의 주석 참고.
    # if healthy:
    #     lines.append(HEALTHY_HINT)
    # "다른 요리 추천받기"를 눌렀는데 같은 요리가 다시 나오면 버튼이 거짓말이 된다.
    # 같은 요청을 온도에만 맡기지 않고, 방금 본 요리를 이름으로 빼달라고 명시한다.
    if exclude:
        lines.append(f"다음 요리는 방금 추천했으니 빼고 다른 요리로 골라줘: {', '.join(exclude)}")
    lines.append("위 조건에 맞는 요리를 추천해줘.")
    return "\n".join(lines)


def handle(payload):
    """(status, body) 를 돌려준다. HTTP 처리는 api/index.py가 한다."""
    ingredients = (payload.get("ingredients") or "").strip()
    if not ingredients:
        return 400, {"error": "empty_input", "message": "재료를 1개 이상 입력해주세요."}

    portion = (payload.get("portion") or "한 끼").strip()
    time_limit = (payload.get("timeLimit") or "상관없음").strip()
    category = (payload.get("category") or "상관없음").strip()
    healthy = bool(payload.get("healthy"))
    # 식단 계획의 "이번 주 후보" 모달 전용 — AI 폴백을 아예 안 탄다(POOL_MATCH_LIMIT 주석 참고).
    match_only = bool(payload.get("matchOnly"))

    # 프롬프트에 그대로 들어가므로 개수를 제한한다. 이력이 5개라 실제로는 넘칠 일이 없다.
    # str(None)은 "None"이라 참 같은 값이 된다. 문자열만 받아야 프롬프트에 "None"이 섞이지 않는다.
    raw_exclude = payload.get("exclude")
    exclude = [x.strip() for x in raw_exclude if isinstance(x, str) and x.strip()][:10] if isinstance(raw_exclude, list) else []

    """실제 레시피를 먼저 찾는다. 있으면 AI를 부르지 않는다.

    장보기가 "재료를 아는 메뉴는 AI에게 안 묻는다"를 하는 것과 같은 자리다. 매칭 결과는
    실제로 존재하는 레시피라 AI 생성물보다 믿을 수 있고, 비용·속도도 아낀다.
    매칭과 생성을 한 응답에 섞지 않는다 — 섞으면 카드마다 있는 것과 없는 것(조리 순서)이
    달라져 화면 규칙이 둘이 된다."""
    matched = recipe_match.match(
        recipe_match.pantry_keys_from(ingredients),
        limit=(POOL_MATCH_LIMIT if match_only else MAX_RECIPES),
        category=category,
    )
    if exclude:
        # "다른 요리 보기"로 다시 부른 경우. 방금 보여준 것을 빼야 버튼 문구가 거짓말이 아니다.
        skip = {dedupe_key(x) for x in exclude}
        matched = [r for r in matched if dedupe_key(r["name"]) not in skip]
    if matched or match_only:
        return 200, {"recipes": matched}


    data, error = call_openai(
        SYSTEM_PROMPT,
        build_user_prompt(ingredients, portion, time_limit, healthy, exclude, category),
        timeout=15.0,
        temperature=0.7,
    )
    if error:
        return error

    raw_recipes = data.get("recipes") if isinstance(data, dict) else None
    return 200, {"recipes": sanitize_recipes(raw_recipes, ingredients)}
