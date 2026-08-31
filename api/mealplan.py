"""
POST /api/mealplan   냉장고 재료를 살려 여러 날짜의 아침·점심·저녁을 계획한다.
POST /api/shopping   이미 있는 계획을 받아 장보기 목록만 다시 뽑는다 (사용자가 식단을 고친 뒤).

두 기능이 한 파일에 있는 이유는 "재료를 어떻게 적을 것인가" 규칙(INGREDIENT_RULES)을
그대로 공유하기 때문이다. 장보기 목록 자체는 AI가 아니라 shopping.py가 계산한다 —
왜 그렇게 바꿨는지는 그 파일의 첫머리에 적어두었다.

mealplan 요청: {"days": int, "portion": str, "pantry": [str]}
mealplan 반환: {"plan": [{"day": str, "meal": str, "menu": str, "searchKeyword": str, "ingredients": [str]}],
                "shoppingList": [{"name": str, "amount": str}]}
shopping 요청: {"plan": [...위와 같은 항목...], "pantry": [str]}
shopping 반환: {"shoppingList": [{"name": str, "amount": str}]}
반환(4xx/5xx): {"error": str, "message": str}
"""

import shopping
from _common import call_openai, to_str_list

# 화면과 프롬프트가 같은 순서·같은 이름을 써야 자리를 맞출 수 있다.
MEALS = ("아침", "점심", "저녁")

# 식단을 처음 짤 때와, 고친 식단의 빠진 재료를 채울 때가 같은 기준을 써야 한다.
# 한쪽만 고치면 같은 요리인데 재료를 적는 방식이 달라져 합산이 어긋난다.
INGREDIENT_RULES = """ingredients에는 그 요리에 들어가는 재료를 빠짐없이, 반드시 수량과 함께 적으세요.
- "재료명 + 숫자 + 단위" 형태로 씁니다 (예: "계란 2개", "대파 1/2대", "돼지고기 150g").
- 혼자 한 끼 먹을 양이 기준입니다.
- 숫자를 빠뜨리면 장을 얼마나 봐야 하는지 계산할 수 없습니다. 모든 재료에 숫자를 붙이세요.
- 재료명은 마트에서 집어 들 수 있는 짧고 구체적인 이름으로 씁니다(예: "계란", "돼지고기").
  "채소", "야채", "고기", "양념"처럼 뭘 사야 할지 알 수 없는 뭉뚱그린 이름은 쓰지 마세요.
- 소금·간장 같은 기본 양념도 그대로 적으면 됩니다. 냉장고에 있으면 장보기 목록에서 빠지고,
  없으면 사야 할 것으로 올라갑니다 — 빼야 할지는 서버가 판단하니 신경 쓰지 마세요."""

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

계획 전체에 서로 다른 재료가 **최소 15가지**는 나와야 합니다. 냉장고에 있는 것만으로는 그 수가
절대 나오지 않습니다 — 고기·생선·두부·채소·과일 같은 것을 새로 사서 넣으세요. 일주일 내내
계란과 양파만 먹는 계획은 실패한 계획입니다.

재료 옆에 "(13일 전에 넣음)"처럼 냉장고에 들어온 지 오래됐다는 표시가 붙어 있을 수 있습니다.
그 재료는 곧 상하므로 반드시 1일차에 가까운 날짜에 배치해서 먼저 소비되게 하세요.
뒷날로 미루면 그때는 이미 못 쓰게 됩니다. 표시가 없는 재료는 뒷날에 써도 괜찮습니다.

""" + INGREDIENT_RULES + """

searchKeyword는 레시피 사이트에서 검색할 때 쓰는 값입니다. 수식어를 빼고 널리 쓰이는 짧은 요리 이름만
적으세요 (예: menu가 "냉장고털이 두부 계란 덮밥"이면 searchKeyword는 "두부덮밥"). 검색어가 길면
엉뚱한 결과가 나오므로 되도록 두 단어를 넘기지 마세요.

plan에는 요청받은 일수 × 3끼를 빠짐없이 담으세요. day는 "1일차" 형식, meal은 "아침"·"점심"·"저녁"만 씁니다.

shoppingList 필드는 응답에 넣지 마세요. 무엇을 얼마나 사야 하는지는 위에 적은 재료 수량을 보고
서버가 계산합니다. 이건 **출력 형식에 대한 이야기일 뿐입니다** — 사야 할 재료를 줄이라는 뜻이
아니므로, 새로 사야 하는 재료는 평소대로 자유롭게 쓰세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 문장을 추가하지 마세요.
{
  "plan": [
    {"day": "1일차", "meal": "아침", "menu": "요리 이름", "searchKeyword": "검색용 짧은 요리 이름", "ingredients": ["계란 2개", "식빵 2장"]}
  ]
}"""

MAX_DAYS = 7

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


def build_user_prompt(days, portion, pantry):
    lines = [
        f"계획할 일수: {days}일치 (하루 세 끼, 총 {days * len(MEALS)}끼)",
        # 혼자 먹는다는 전제이므로 "몇 인분"이 아니라 "한 끼당 몇 끼 분량"으로 전달한다.
        f"한 끼당 만들 분량: 혼자 먹을 {portion} 분량 (남으면 다음 끼니에 먹음)",
    ]
    if pantry:
        lines.append(f"이미 냉장고에 있는 재료: {', '.join(pantry)}")
    lines.append(f"1일차부터 {days}일차까지 아침·점심·저녁을 빠짐없이 계획해줘.")
    return "\n".join(lines)


def handle(payload):
    """(status, body) 를 돌려준다. HTTP 처리는 api/index.py가 한다."""
    raw_days = payload.get("days")
    try:
        # `or 5`로 쓰면 명시적으로 보낸 0이 "안 보냄"과 같이 취급돼 5일치로 튄다.
        # None(진짜 안 보낸 경우)일 때만 기본값을 쓰고, 나머지는 그대로 int로 읽어
        # 바로 아래 clamp가 1로 잡게 둔다.
        days = int(raw_days) if raw_days is not None else 5
    except (TypeError, ValueError):
        days = 5
    days = max(1, min(days, 7))

    portion = (payload.get("portion") or "한 끼").strip()
    pantry = payload.get("pantry") or []
    if not isinstance(pantry, list):
        pantry = []
    pantry = [str(p).strip() for p in pantry if str(p).strip()][:MAX_PANTRY]

    # 세 끼로 늘면서 응답이 3배가 됐다. 저녁만 계획하던 때의 20초로는 7일치가 잘린다.
    data, error = call_openai(
        SYSTEM_PROMPT,
        build_user_prompt(days, portion, pantry),
        timeout=25.0,
        temperature=0.8,
    )
    if error:
        return error

    if not isinstance(data, dict):
        data = {}

    plan = sanitize_plan(data.get("plan"), days)
    # 무엇을 얼마나 사야 하는지는 AI가 아니라 코드가 센다 (shopping.py 첫머리 참고).
    return 200, {"plan": plan, "shoppingList": shopping.build_shopping_list(plan, pantry)}


INGREDIENT_SYSTEM_PROMPT = """당신은 요리 이름을 보고 그 요리에 들어가는 재료를 알려주는 도우미입니다.
사용자는 혼자 사는 자취생입니다. 새 요리를 제안하지 말고, 물어본 요리의 재료만 답하세요.

""" + INGREDIENT_RULES + """

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 문장을 추가하지 마세요.
{
  "menus": [
    {"menu": "제육볶음", "ingredients": ["돼지고기 150g", "양파 1/2개", "대파 1/2대"]}
  ]
}"""


def build_ingredient_prompt(menus):
    return "아래 요리들의 재료를 알려줘.\n" + "\n".join(f"- {menu}" for menu in menus)


def fill_missing_ingredients(plan):
    """재료 정보가 없는 메뉴의 재료를 AI에게 물어 채운다. 채울 게 없으면 부르지 않는다.

    재료가 비는 경우는 하나뿐이다 — 사용자가 식단의 빈 자리에 메뉴 이름만 직접 적어 넣은 것.
    화면이 재료를 묻지 않기로 했기 때문에(21칸마다 재료까지 적게 하면 손으로 넣는 편이
    다시 계획하는 것보다 번거로워진다) 여기서 메꾼다. 그대로 두면 그 끼니에 필요한 재료가
    장보기 목록에서 통째로 빠진다.

    실패하면 (error) 를 돌려준다. 성공이거나 부를 일이 없으면 None.
    """
    missing = []
    for item in plan:
        if not item["ingredients"] and item["menu"] not in missing:
            missing.append(item["menu"])
    if not missing:
        return None

    data, error = call_openai(
        INGREDIENT_SYSTEM_PROMPT,
        build_ingredient_prompt(missing),
        timeout=20.0,
        temperature=0.2,  # 재료를 세는 일에 창의성은 필요 없다. 같은 요리면 같은 답이 낫다.
    )
    if error:
        return error

    filled = {}
    for item in (data or {}).get("menus") or []:
        if isinstance(item, dict) and str(item.get("menu") or "").strip():
            filled[str(item["menu"]).strip()] = to_str_list(item.get("ingredients"))

    for item in plan:
        if not item["ingredients"]:
            item["ingredients"] = filled.get(item["menu"], [])
    return None


def handle_shopping(payload):
    """사용자가 식단을 고친 뒤 장보기 목록만 다시 뽑는다. 계획은 새로 만들지 않는다."""
    plan = sanitize_plan(payload.get("plan"), MAX_DAYS)
    if not plan:
        return 400, {"error": "empty_plan", "message": "식단이 비어 있어요. 식단을 먼저 계획해주세요."}

    pantry = payload.get("pantry") or []
    if not isinstance(pantry, list):
        pantry = []
    pantry = [str(p).strip() for p in pantry if str(p).strip()][:MAX_PANTRY]

    error = fill_missing_ingredients(plan)
    if error:
        return error

    return 200, {"shoppingList": shopping.build_shopping_list(plan, pantry)}
