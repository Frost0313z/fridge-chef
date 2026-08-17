"""
장보기 목록을 계산한다 — 식단이 쓰는 재료를 전부 더하고, 냉장고에 있는 만큼 뺀다.

이 계산은 원래 AI가 했다. 그런데 계획이 커질수록 틀렸다. 재료 1종·3끼로 격리하면
정확히 맞히는데, 7일치 21끼(34종)를 주면 6종을 통째로 빠뜨렸다
(계란·대파·양파·갈비·무·요거트). 빠뜨리는 방식도 일정했다 — 냉장고에 조금이라도
있으면 "있다"로 보고 넘어갔다. 프롬프트를 고쳐서 될 문제가 아니었다. 곱하고 더하고
빼는 일을 34번 반복하는 것 자체가 언어 모델이 잘하는 일이 아니다.

그래서 AI에게는 "이 끼니에 무엇이 얼마나 들어가는가"까지만 맡기고(재료명 + 수량),
합산과 차감은 여기서 한다. 같은 식단이면 항상 같은 목록이 나온다.
"""

import math
import re

from _common import BASIC_SEASONINGS

# 프롬프트로 "넣지 마세요"라고 지시해도 AI가 계속 넣던 항목들. 이제는 재료 목록에
# 들어와도 상관없다 — 요리에 실제로 쓰이니 적는 게 맞고, 사러 갈 일이 없을 뿐이므로
# 장보기 목록을 만들 때 여기서 뺀다. 기본 조미료(BASIC_SEASONINGS)에 "양념"과
# 뭉뚱그린 이름(채소·야채·고기 — 뭘 사야 할지 알 수 없다)만 더한다.
NOT_WORTH_BUYING = BASIC_SEASONINGS | {"양념", "채소", "야채", "고기"}

# 7일치 21끼면 30종을 넘는 것이 정상이라 예전 상한(30)은 목록 끝을 조용히 잘라먹었다.
# 응답 크기를 막기 위한 안전장치로만 남기고, 실제 계획이 닿지 않을 높이로 올린다.
MAX_SHOPPING_ITEMS = 60

# "2", "1.5", "1/2" 세 형태를 받는다. 분수는 AI가 "대파 1/2대"처럼 실제로 쓴다.
_NUMBER = r"\d+(?:\.\d+)?(?:/\d+)?"

# js/shared.js의 QUANTITY_PATTERN과 같은 단위를 알아봐야 한다. 한쪽에만 단위를 추가하면
# 화면이 수량으로 지운 글자를 서버는 이름의 일부로 읽어 같은 재료가 둘로 갈라진다.
_UNITS = (
    "g", "kg", "ml", "l", "개", "알", "장", "줄", "대", "모", "쪽", "톨", "컵",
    "큰술", "작은술", "스푼", "봉지", "봉", "팩", "캔", "공기", "인분", "주먹",
    "단", "통", "마리", "조각",
)

# 긴 단위를 먼저 시도해야 "kg"이 "g"로, "봉지"가 "봉"으로 잘리지 않는다.
_UNIT_PATTERN = "|".join(sorted(_UNITS, key=len, reverse=True))
_QUANTITY_RE = re.compile(rf"({_NUMBER})\s*({_UNIT_PATTERN})?")

# 숫자 없는 수량 표현. 이름에 남겨두면 "김치"와 "김치 조금"이 다른 재료가 된다.
_VAGUE_RE = re.compile(r"(조금|약간|살짝|많이|넉넉히|한줌|두줌)")

# 냉장고 재료는 "계란 2개 (13일 전에 넣음)" 형태로 올라온다. 수량이 아니므로 먼저 걷어낸다.
_ADDED_NOTE_RE = re.compile(r"\([^)]*넣음[^)]*\)")

# 같은 것을 다르게 세는 말. 합칠 수 있어야 "계란 2개"와 "계란 3알"이 5개로 모인다.
# 확실히 같은 것만 넣는다 — 마늘 "1통"과 "1톨"은 양이 열 배 차이라 묶으면 안 된다.
_UNIT_ALIASES = {"알": "개"}

# 배수만 다른 단위. 작은 쪽으로 맞춰서 더한다.
_UNIT_SCALES = {"kg": ("g", 1000), "l": ("ml", 1000)}


def _to_number(raw):
    """"2", "1.5", "1/2"를 실수로. 못 읽으면 None."""
    if "/" in raw:
        top, _, bottom = raw.partition("/")
        try:
            return float(top) / float(bottom)
        except (ValueError, ZeroDivisionError):
            return None
    try:
        return float(raw)
    except ValueError:
        return None


def parse_line(raw):
    """재료 한 줄을 (이름, 수량, 단위)로 나눈다.

    수량을 못 읽으면 수량과 단위가 None이다 — 옛 계획에 저장된 "두부"처럼 수량 없이
    적힌 재료가 실제로 올라온다. 그때는 "없다"가 아니라 "모른다"로 다뤄야 한다.
    """
    text = _ADDED_NOTE_RE.sub(" ", str(raw))
    # "두부(반모)"처럼 괄호 안에 수량을 적기도 한다. 괄호만 벗기고 안쪽은 살려서 읽는다.
    text = text.replace("(", " ").replace(")", " ").strip()

    match = _QUANTITY_RE.search(text)
    quantity = _to_number(match.group(1)) if match else None
    unit = (match.group(2) or "") if match else ""

    unit = _UNIT_ALIASES.get(unit, unit)
    if quantity is not None and unit in _UNIT_SCALES:
        unit, factor = _UNIT_SCALES[unit]
        quantity *= factor

    name = _QUANTITY_RE.sub(" ", text)
    name = _VAGUE_RE.sub(" ", name)
    name = re.sub(r"\s+", " ", name).strip()

    if quantity is None:
        return name, None, ""
    return name, quantity, unit


def normalize_name(name):
    """비교용 이름. 띄어쓰기 차이("닭 가슴살"과 "닭가슴살")까지 같게 본다.
    js/shared.js의 normalizeIngredient와 같은 규칙이다."""
    return str(name).replace(" ", "")


def format_amount(value, unit):
    """살 수 있는 단위로 올려서 적는다. 0.5모가 필요하면 1모를 사야 하고,
    "2.0개"가 아니라 "2개"라고 적어야 목록으로 읽힌다."""
    # 0.5 + 0.5가 0.9999...로 떨어져도 2개가 되지 않도록 여유를 두고 올린다.
    rounded = int(math.ceil(value - 1e-9))
    return f"{rounded}{unit}" if unit else str(rounded)


def _collect(entries):
    """재료 줄들을 이름별로 모은다. entries는 (줄, 출처) 쌍이고, 출처는 냉장고면 None이다.

    {정규화 이름: {"label": 처음 본 이름, "amounts": {단위: 합계}, "uses": [...]}}
    수량을 못 읽은 줄은 합계에 넣을 수 없지만 이름은 등록된다 — "있는지"와 "얼마나
    있는지"는 다른 질문이고, 둘을 구분해야 뺄 수 있는지 없는지를 판단할 수 있다.

    uses는 "이 재료가 어느 끼니에 얼마나 쓰이는가"다. 목록에 왜 이 재료가 이 수량으로
    올라왔는지를 화면이 그대로 펼쳐 보여주기 위해 여기서 함께 모은다 — 계산한 자리에서
    같이 만들어야 합계와 근거가 어긋나지 않는다.
    """
    collected = {}
    for raw, source in entries:
        name, quantity, unit = parse_line(raw)
        if not name:
            continue
        entry = collected.setdefault(
            normalize_name(name), {"label": name, "amounts": {}, "uses": []}
        )
        if quantity is not None:
            entry["amounts"][unit] = entry["amounts"].get(unit, 0.0) + quantity
        if source is not None:
            # 수량을 못 읽었으면 빈 문자열이다. 근거 목록에서는 빠지지 않아야 한다 —
            # 그 끼니에 쓰이는 것은 사실이고, 다만 얼마나인지를 모를 뿐이다.
            amount = format_amount(quantity, unit) if quantity is not None else ""
            entry["uses"].append({**source, "amount": amount})
    return collected


def _format_amounts(amounts):
    """{단위: 합계}를 사람이 읽는 한 줄로. 단위가 섞여 있으면 나란히 적는다."""
    return ", ".join(format_amount(total, unit) for unit, total in amounts.items())


def find_owned(target, owned_keys):
    """냉장고(또는 그에 준하는 목록)에서 같은 재료를 찾는다. js/shared.js의 isCovered와
    같은 규칙 — 한 방향 포함 비교는 "파"가 "파프리카"까지 보유로 만들어버리므로
    양방향으로 보되, 짧은 쪽이 한 글자면 우연한 겹침이라 인정하지 않는다.
    recommend.py가 레시피의 재료가 사용자 재료에 있는지 확인할 때도 이 함수를 그대로 쓴다 —
    "같은 이름인지 판단하는 규칙"이 갈라지면 한쪽은 있다고 하고 한쪽은 없다고 하게 된다."""
    for key in owned_keys:
        if key == target:
            return key
        shorter = key if len(key) <= len(target) else target
        if len(shorter) >= 2 and (target in key or key in target):
            return key
    return None


def build_shopping_list(plan, pantry):
    """계획이 쓰는 재료를 전부 더하고 냉장고에 있는 만큼 빼서 살 것만 남긴다.

    plan: [{"day","meal","menu","ingredients": ["계란 2개", ...]}, ...]   pantry: ["계란 4개", ...]
    반환: [{"name": "계란", "amount": "6개", "need": "10개", "have": "4개", "subtracted": True,
            "uses": [{"day","meal","menu","amount"}, ...]}, ...]

    amount 말고 나머지는 **왜 이 수량이 나왔는지**를 화면이 그대로 펼쳐 보이기 위한 것이다.
    숫자만 던지면 사용자는 맞는지 틀리는지 판단할 방법이 없다. 특히 "냉장고에 있는데 왜
    또 사라고 하지?"는 근거를 봐야만 풀린다(단위가 달라 못 뺐다는 것이 답인 경우가 있다).
    """
    lines = []
    for item in plan:
        source = {
            "day": str(item.get("day") or ""),
            "meal": str(item.get("meal") or ""),
            "menu": str(item.get("menu") or ""),
        }
        for raw in item.get("ingredients") or []:
            lines.append((raw, source))

    needs = _collect(lines)
    owned = _collect([(raw, None) for raw in pantry])
    owned_keys = list(owned.keys())

    shopping_list = []
    for key, need in needs.items():
        if key in NOT_WORTH_BUYING:
            continue

        owned_key = find_owned(key, owned_keys)
        have = owned[owned_key]["amounts"] if owned_key else {}
        # 냉장고에 있긴 한데 뺄 수 없었던 경우를 화면이 구분해 말할 수 있어야 한다.
        # (수량을 안 적었거나 단위가 달라서 — 사용자 눈에는 "있는데 또 사라네"로만 보인다)
        have_text = _format_amounts(have) if owned_key else ""

        if not need["amounts"]:
            # 얼마나 필요한지를 모르는 재료(수량 없이 저장된 옛 계획). 부족한 양을 계산할
            # 수 없으니 냉장고에 있으면 있는 대로 두고, 없으면 이름만 올린다.
            if owned_key is None:
                shopping_list.append(
                    {"name": need["label"], "amount": "", "need": "", "have": "",
                     "subtracted": False, "uses": need["uses"]}
                )
            continue

        parts = []
        subtracted = False
        for unit, total in need["amounts"].items():
            # 냉장고에 같은 단위로 적혀 있을 때만 뺄 수 있다. 수량을 안 적었거나("계란")
            # 단위가 다르면(150g 필요한데 "1팩") 뺄 근거가 없으므로 필요한 만큼을 그대로
            # 올린다 — 이미 있는 걸 또 사는 쪽이, 필요한 걸 안 사서 못 만드는 쪽보다 낫다.
            covered = have.get(unit, 0.0)
            if covered > 0:
                subtracted = True
            short = total - covered
            if short > 0:
                parts.append(format_amount(short, unit))

        if parts:
            shopping_list.append(
                {
                    "name": need["label"],
                    "amount": ", ".join(parts),
                    "need": _format_amounts(need["amounts"]),
                    "have": have_text,
                    "subtracted": subtracted,
                    "uses": need["uses"],
                }
            )

    return shopping_list[:MAX_SHOPPING_ITEMS]
