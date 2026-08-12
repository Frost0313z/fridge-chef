"""
POST /api/mealplan   냉장고 재료를 살려 여러 날짜의 아침·점심·저녁을 계획한다.
POST /api/shopping   이미 있는 계획을 받아 장보기 목록만 다시 뽑는다 (사용자가 식단을 고친 뒤).

두 기능이 한 파일에 있는 이유는 프롬프트의 "무엇을 사야 하는가" 규칙과
sanitize_shopping_list를 그대로 공유하기 때문이다.

mealplan 요청: {"days": int, "portion": str, "healthy": bool, "pantry": [str]}
mealplan 반환: {"plan": [{"day": str, "meal": str, "menu": str, "searchKeyword": str, "ingredients": [str]}],
                "shoppingList": [{"name": str, "amount": str}]}
shopping 요청: {"plan": [...위와 같은 항목...], "pantry": [str]}
shopping 반환: {"shoppingList": [{"name": str, "amount": str}]}
반환(4xx/5xx): {"error": str, "message": str}
"""

from _common import call_openai, to_str_list

# 화면과 프롬프트가 같은 순서·같은 이름을 써야 자리를 맞출 수 있다.
MEALS = ("아침", "점심", "저녁")

# 식단을 처음 짤 때와, 사용자가 고친 뒤 목록만 다시 뽑을 때가 같은 기준을 써야 한다.
# 한쪽만 고치면 "방금 전엔 안 사도 된다더니" 같은 어긋남이 생기므로 한 곳에 둔다.
SHOPPING_RULES = """shoppingList에는 사용자가 실제로 장을 봐야 하는 것만 담으세요. 판단 기준은 이렇습니다.
- 계획 전체에 필요한 양이 냉장고에 있는 양보다 많으면, 부족한 만큼을 넣으세요.
  (예: 냉장고에 "계란 2개"가 있는데 계획에 8개가 필요하면 계란을 넣습니다)
- 냉장고에 충분히 있는 재료는 넣지 마세요.
- 다음은 절대 넣지 마세요: 소금, 후추, 설탕, 식용유, 참기름, 간장, 된장, 고추장, 고춧가루,
  다진마늘, 물, 밥, 쌀. 대부분의 가정에 이미 있어서 사러 갈 일이 없습니다.
  요리에 쓰이더라도 shoppingList에는 넣지 않습니다.
- "채소", "야채", "고기", "양념"처럼 뭘 사야 할지 알 수 없는 뭉뚱그린 이름도 넣지 마세요.
  마트에서 집어 들 수 있는 구체적인 재료명만 씁니다.
- name은 쿠팡에서 검색할 짧고 일반적인 이름(예: "계란"), amount는 사야 할 양(예: "6개")입니다."""

SYSTEM_PROMPT = """당신은 자취생을 위한 하루 세 끼 식단을 계획해주는 도우미입니다.
사용자가 이미 냉장고에 가진 재료를 최대한 활용해서, 날짜별로 아침·점심·저녁을 모두 계획하세요.
가진 재료만으로 부족하면 새로 사야 할 재료를 자유롭게 추가해도 됩니다 (장보기 리스트를 만드는 것이 목적입니다).
같은 요리가 계획 기간 내에 반복되지 않게 다양하게 구성하세요.

사용자는 혼자 사는 자취생입니다. 이건 선택 사항이 아니라 항상 참인 전제입니다.
설거지가 적고 조리 과정이 간단한 요리를 우선하고, 특수한 조리도구가 필요한 요리는 피하세요.

끼니마다 성격이 다릅니다. 이걸 지키지 않으면 아침부터 찌개를 끓이라는 계획이 됩니다.
- 아침: 5분 안에 준비되는 것. 재료는 3개 이내로 하고 불을 거의 쓰지 않는 쪽을 우선하세요.
- 점심: 간단한 한 그릇. 전날 저녁에 만든 것을 다시 활용하는 구성도 좋습니다.
- 저녁: 제대로 된 한 끼. 재료를 가장 많이 쓰는 끼니입니다.

냉장고 재료에는 수량이 함께 적혀 있을 수 있습니다(예: "계란 2개", "김치 조금").
수량을 반드시 고려하세요. 가진 재료로만 전부 채우려 하지 말고, 며칠은 새로 살 재료를 넣어
재료 구성도 다양하게 하세요. 같은 재료 서너 개로 모든 날을 돌려막으면 안 됩니다.

재료 옆에 "(13일 전에 넣음)"처럼 냉장고에 들어온 지 오래됐다는 표시가 붙어 있을 수 있습니다.
그 재료는 곧 상하므로 반드시 1일차에 가까운 날짜에 배치해서 먼저 소비되게 하세요.
뒷날로 미루면 그때는 이미 못 쓰게 됩니다. 표시가 없는 재료는 뒷날에 써도 괜찮습니다.

""" + SHOPPING_RULES + """

searchKeyword는 레시피 사이트에서 검색할 때 쓰는 값입니다. 수식어를 빼고 널리 쓰이는 짧은 요리 이름만
적으세요 (예: menu가 "냉장고털이 두부 계란 덮밥"이면 searchKeyword는 "두부덮밥"). 검색어가 길면
엉뚱한 결과가 나오므로 되도록 두 단어를 넘기지 마세요.

plan에는 요청받은 일수 × 3끼를 빠짐없이 담으세요. day는 "1일차" 형식, meal은 "아침"·"점심"·"저녁"만 씁니다.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 문장을 추가하지 마세요.
{
  "plan": [
    {"day": "1일차", "meal": "아침", "menu": "요리 이름", "searchKeyword": "검색용 짧은 요리 이름", "ingredients": ["재료1", "재료2"]}
  ],
  "shoppingList": [
    {"name": "계란", "amount": "6개"}
  ]
}"""

# 타겟이 1인 가구 자취생으로 고정돼 있어 "가족 식사"는 모순이고 "자취생 간단요리"는
# 선택지가 아니라 기본값이다(SYSTEM_PROMPT로 승격). 세대 구성과 무관한 축 하나만 남긴다.
HEALTHY_HINT = "건강 관리를 신경 쓰는 중이야. 기름지거나 자극적인 조리법은 피하고 칼로리가 낮은 쪽으로 계획해줘."


MAX_DAYS = 7
MAX_SHOPPING_ITEMS = 30

# 프롬프트가 날짜 수만큼 곱해져 길어지므로 재료를 앞에서 끊는다.
# 화면이 "먼저 넣은 30개만 쓰인다"고 안내하므로 js/shared.js의 MEALPLAN_PANTRY_LIMIT과
# 같은 값이어야 한다. 한쪽만 고치면 화면이 사실과 다른 말을 하게 된다.
MAX_PANTRY = 30


def sanitize_plan(raw, days):
    """response_format으로 JSON은 보장되지만 '스키마'까지 보장되지는 않는다.
    메뉴 없는 항목은 버리고, 나머지 필드는 프론트가 기대하는 타입으로 맞춰서 내보낸다.

    (날짜, 끼니) 한 쌍에는 메뉴가 하나만 놓인다. AI가 같은 자리를 두 번 채우면 뒤엣것을 버린다 —
    화면이 날짜×끼니 격자로 그려지므로 한 자리에 둘이 오면 하나는 어차피 보이지 않는다."""
    if not isinstance(raw, list):
        return []

    plan = []
    taken = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        menu = str(item.get("menu") or "").strip()
        if not menu:
            continue

        # 끼니가 아예 없으면 저녁으로 본다 — 세 끼로 나누기 전에 저장된 계획이 그렇다.
        # 반대로 "브런치"처럼 모르는 값이 왔을 때 저녁으로 바꾸면, 진짜 저녁 메뉴가
        # 자리를 뺏겨 사라진다. 그건 고쳐주는 게 아니라 지우는 것이므로 항목을 버린다.
        meal = str(item.get("meal") or "").strip()
        if not meal:
            meal = "저녁"
        elif meal not in MEALS:
            continue
        day = str(item.get("day") or "").strip() or f"{len(plan) // 3 + 1}일차"

        if (day, meal) in taken:
            continue
        taken.add((day, meal))

        plan.append(
            {
                "day": day,
                "meal": meal,
                "menu": menu,
                # 비면 프론트가 menu로 대체한다. 옛 저장 데이터에도 이 필드가 없다.
                "searchKeyword": str(item.get("searchKeyword") or "").strip(),
                "ingredients": to_str_list(item.get("ingredients")),
            }
        )
    return plan[: days * len(MEALS)]


# 프롬프트로 "넣지 마세요"라고 지시해도 AI가 계속 넣는 항목이 있다(밥이 대표적).
# 스키마만이 아니라 내용도 서버가 보장한다 — 사러 갈 일이 없는 항목이 섞이면 리스트가 쓸모없어진다.
# 뒤쪽 셋(채소·야채·고기)은 뭘 사야 할지 알 수 없는 뭉뚱그린 이름이라 함께 거른다.
NOT_WORTH_BUYING = {
    "소금", "후추", "설탕", "식용유", "올리브유", "참기름", "들기름",
    "간장", "된장", "고추장", "고춧가루", "고추가루", "다진마늘", "양념",
    "물", "밥", "쌀",
    "채소", "야채", "고기",
}


def sanitize_shopping_list(raw):
    """장보기 목록의 스키마와 내용을 함께 강제한다."""
    if not isinstance(raw, list):
        return []

    items = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name or name.replace(" ", "") in NOT_WORTH_BUYING:
            continue
        items.append({"name": name, "amount": str(item.get("amount") or "").strip()})
    return items[:MAX_SHOPPING_ITEMS]


def build_user_prompt(days, portion, healthy, pantry):
    lines = [
        f"계획할 일수: {days}일치 (하루 세 끼, 총 {days * len(MEALS)}끼)",
        # 혼자 먹는다는 전제이므로 "몇 인분"이 아니라 "한 끼당 몇 끼 분량"으로 전달한다.
        f"한 끼당 만들 분량: 혼자 먹을 {portion} 분량 (남으면 다음 끼니에 먹음)",
    ]
    if pantry:
        lines.append(f"이미 냉장고에 있는 재료: {', '.join(pantry)}")
    if healthy:
        lines.append(HEALTHY_HINT)
    lines.append(f"1일차부터 {days}일차까지 아침·점심·저녁을 빠짐없이 계획해줘.")
    return "\n".join(lines)


def handle(payload):
    """(status, body) 를 돌려준다. HTTP 처리는 api/index.py가 한다."""
    try:
        days = int(payload.get("days") or 5)
    except (TypeError, ValueError):
        days = 5
    days = max(1, min(days, 7))

    portion = (payload.get("portion") or "한 끼").strip()
    healthy = bool(payload.get("healthy"))
    pantry = payload.get("pantry") or []
    if not isinstance(pantry, list):
        pantry = []
    pantry = [str(p).strip() for p in pantry if str(p).strip()][:MAX_PANTRY]

    # 세 끼로 늘면서 응답이 3배가 됐다. 저녁만 계획하던 때의 20초로는 7일치가 잘린다.
    data, error = call_openai(
        SYSTEM_PROMPT,
        build_user_prompt(days, portion, healthy, pantry),
        timeout=25.0,
        temperature=0.8,
    )
    if error:
        return error

    if not isinstance(data, dict):
        data = {}

    return 200, {
        "plan": sanitize_plan(data.get("plan"), days),
        # 수량 판단이 필요해서 장보기 목록을 AI가 직접 뽑는다.
        # 프론트의 이름 매칭으로는 "계란 2개"와 "계란 8개"를 구분할 수 없었다.
        "shoppingList": sanitize_shopping_list(data.get("shoppingList")),
    }


SHOPPING_SYSTEM_PROMPT = """당신은 이미 짜여 있는 식단을 보고 장보기 목록을 만드는 도우미입니다.
식단은 사용자가 직접 고친 뒤일 수 있으므로, 새 요리를 제안하지 말고 주어진 식단만 보고 판단하세요.

""" + SHOPPING_RULES + """

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 문장을 추가하지 마세요.
{
  "shoppingList": [
    {"name": "계란", "amount": "6개"}
  ]
}"""


def build_shopping_prompt(plan, pantry):
    lines = ["아래는 확정된 식단입니다."]
    for item in plan:
        ingredients = ", ".join(item["ingredients"]) if item["ingredients"] else "재료 정보 없음"
        lines.append(f"- {item['day']} {item['meal']}: {item['menu']} ({ingredients})")
    lines.append("")
    lines.append(f"이미 냉장고에 있는 재료: {', '.join(pantry) if pantry else '없음'}")
    lines.append("이 식단을 전부 만들려면 무엇을 사야 하는지 목록으로 알려줘.")
    return "\n".join(lines)


def handle_shopping(payload):
    """사용자가 식단을 고친 뒤 장보기 목록만 다시 뽑는다. 계획은 새로 만들지 않는다."""
    plan = sanitize_plan(payload.get("plan"), MAX_DAYS)
    if not plan:
        return 400, {"error": "empty_plan", "message": "식단이 비어 있어요. 식단을 먼저 계획해주세요."}

    pantry = payload.get("pantry") or []
    if not isinstance(pantry, list):
        pantry = []
    pantry = [str(p).strip() for p in pantry if str(p).strip()][:MAX_PANTRY]

    data, error = call_openai(
        SHOPPING_SYSTEM_PROMPT,
        build_shopping_prompt(plan, pantry),
        timeout=20.0,
        temperature=0.3,  # 목록 뽑기는 창의성이 필요 없다. 같은 식단이면 같은 답이 나오는 편이 낫다.
    )
    if error:
        return error

    if not isinstance(data, dict):
        data = {}

    return 200, {"shoppingList": sanitize_shopping_list(data.get("shoppingList"))}
