"""
POST /api/recommend
입력한 재료로 AI가 만들 수 있는 요리를 추천하는 Vercel Serverless Function.

요청 페이로드: {"ingredients": str, "portion": str, "timeLimit": str, "healthy": bool}
반환(200): {"recipes": [{"name": str, "searchKeyword": str, "time": str, "ingredients": [str], "steps": [str]}]}
반환(4xx/5xx): {"error": str, "message": str}  # message는 화면에 그대로 표시할 한국어 안내문
"""

from _common import call_openai, to_str_list

SYSTEM_PROMPT = """당신은 냉장고에 있는 재료로 만들 수 있는 한식/양식/중식 요리를 추천하는 요리 도우미입니다.
사용자가 알려준 재료를 최대한 활용하는 요리 1~3개를 추천하세요.
소금, 후추, 식용유, 물처럼 대부분의 가정에 있는 기본 조미료는 목록에 없어도 사용할 수 있다고 가정합니다.
사용자가 알려주지 않은 값비싸거나 특수한 재료를 임의로 추가하지 마세요.

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
HEALTHY_HINT = "건강 관리를 신경 쓰는 중이야. 기름지거나 자극적인 조리법은 피하고 칼로리가 낮은 쪽으로 추천해줘."


MAX_RECIPES = 3


def dedupe_key(name):
    """"김치볶음밥"과 "김치 볶음밥"을 같은 요리로 본다. 띄어쓰기만 지우고 그 이상은 하지 않는다 —
    "된장찌개"와 "차돌된장찌개"를 같다고 묶으면 멀쩡한 추천이 사라진다."""
    return name.replace(" ", "")


def sanitize_recipes(raw):
    """response_format으로 JSON은 보장되지만 '스키마'까지 보장되지는 않는다.
    이름 없는 항목은 버리고, 나머지 필드는 프론트가 기대하는 타입으로 맞춰서 내보낸다."""
    if not isinstance(raw, list):
        return []

    recipes = []
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
        recipes.append(
            {
                "name": name,
                # 비면 프론트가 name으로 대체한다. 옛 이력 데이터에도 이 필드가 없다.
                "searchKeyword": str(item.get("searchKeyword") or "").strip(),
                "time": str(item.get("time") or "").strip(),
                "ingredients": to_str_list(item.get("ingredients")),
                "steps": to_str_list(item.get("steps")),
            }
        )
    return recipes[:MAX_RECIPES]


def build_user_prompt(ingredients, portion, time_limit, healthy, exclude=()):
    lines = [
        f"보유 재료: {ingredients}",
        # 혼자 먹는다는 전제이므로 "몇 인분"이 아니라 "몇 끼 분량"으로 전달한다.
        f"만들 분량: 혼자 먹을 {portion} 분량 (남으면 다음 끼니에 먹음)",
        f"희망 조리 시간: {time_limit}",
    ]
    if healthy:
        lines.append(HEALTHY_HINT)
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
    healthy = bool(payload.get("healthy"))

    # 프롬프트에 그대로 들어가므로 개수를 제한한다. 이력이 5개라 실제로는 넘칠 일이 없다.
    # str(None)은 "None"이라 참 같은 값이 된다. 문자열만 받아야 프롬프트에 "None"이 섞이지 않는다.
    raw_exclude = payload.get("exclude")
    exclude = [x.strip() for x in raw_exclude if isinstance(x, str) and x.strip()][:10] if isinstance(raw_exclude, list) else []

    data, error = call_openai(
        SYSTEM_PROMPT,
        build_user_prompt(ingredients, portion, time_limit, healthy, exclude),
        timeout=15.0,
        temperature=0.7,
    )
    if error:
        return error

    raw_recipes = data.get("recipes") if isinstance(data, dict) else None
    return 200, {"recipes": sanitize_recipes(raw_recipes)}
