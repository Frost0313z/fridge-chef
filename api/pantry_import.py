"""
POST /api/pantryImport
영수증 촬영 / 쿠팡 등 구매내역 캡처 사진에서 식재료 후보를 뽑는다.

스펙: docs/spec-pantry-photo-import.md

이 파일이 하는 일은 "사진 → 대략적인 품목명 후보"까지다(비전 호출 + 프롬프트 1차 필터).
"이게 진짜 요리 재료인가, 정확히 뭐라고 부르는 재료인가"의 진짜 경계는 프롬프트가 아니라
코드로 긋는다 — recipe-match가 이미 만들어 둔 재료 어휘 색인(spec-recipe-match.md,
234,538개 레시피에서 뽑은 재료명)과 대조해서, 어휘에 없으면 버리고 있으면 그 어휘의
정규화된 이름으로 치환한다(§핵심 원칙 3). 결과는 사용자가 체크박스로 걸러낸 뒤 확정하는
확인 화면(§4, 아직 미구현)을 반드시 거친다 — 이 함수는 후보만 내놓을 뿐 냉장고에 바로
반영하지 않는다.
"""

import re

from _common import call_openai
from recipe_match import vocab_with_min_occurrence
from shopping import find_owned, normalize_name

# 234,538개 레시피 원문에 우연히 한두 번 등장하는 비재료("도리토스" 1회)를 걸러내는 문턱값.
# 정확한 값은 실측 후 조정 대상이다(docs/spec-pantry-photo-import.md §구현 전 확인 사항 5) —
# spec-recipe-match.md의 MIN_COVERAGE와 같은 성격이다.
MIN_VOCAB_OCCURRENCE = 5

# 영수증 한 장에 이보다 많은 품목이 찍힐 일은 드물다 — 프롬프트 폭주 방어용 상한.
MAX_ITEMS = 30

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

SYSTEM_PROMPT = """당신은 영수증이나 온라인 구매내역 캡처 사진에서 식재료 후보를 뽑는 도우미입니다.
사진에 찍힌 품목명을 읽고, 그중 요리 재료로 쓸 수 있는 것만 고르세요.
과자·완제품 간식·조리와 무관한 음료·생활용품처럼 "먹지만 조리에 안 쓰는" 품목이나 비식품은
빼세요. 술처럼 조리에도 흔히 쓰이는 품목은 남겨도 됩니다. 과자·스낵류 이름에 붙은
"~맛"(나쵸치즈맛 등)은 그 재료가 실제로 들어있다는 뜻이 아니라 향만 낸 것이니, 그
재료를 산 것으로 착각해 적지 마세요.
브랜드명·상품 수식어·용량 표기는 빼고 실제 재료를 가리키는 짧은 원재료명만 적으세요
(예: "로켓프레시 한끼통살 닭가슴살 볼 5종 믹스세트" -> "닭가슴살", "동원)저스트노슈가스위트콘340g"
-> "스위트콘"). 정확히 무슨 재료인지 확신이 안 서면 원문에 가장 가까운 짧은 이름을 적으세요 —
최종 확인은 사용자가 화면에서 직접 합니다.
사진에 구매일자(주문일·승인일자 등)가 보이면 YYYY-MM-DD 형식으로 적으세요. 안 보이면 null로 두세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 문장을 추가하지 마세요.
{
  "items": ["재료1", "재료2"],
  "purchaseDate": "2026-08-19"
}"""


def normalize_and_filter(raw_items):
    """추출된 품목명을 재료 어휘 색인과 대조해 정규화하고, 어휘에 없거나 우연히만
    등장하는 비재료는 버린다. 같은 어휘로 겹치는 것은 한 번만 남긴다."""
    vocab = vocab_with_min_occurrence(MIN_VOCAB_OCCURRENCE)

    result = []
    seen = set()
    for raw in raw_items:
        key = normalize_name(raw)
        if not key:
            continue
        matched = find_owned(key, vocab)
        if not matched or matched in seen:
            continue
        seen.add(matched)
        result.append(matched)
    return result


def handle(payload):
    """(status, body) 를 돌려준다. HTTP 처리는 api/index.py가 한다."""
    image = payload.get("image")
    if not isinstance(image, str) or not image.startswith("data:image/"):
        return 400, {"error": "empty_input", "message": "사진을 다시 골라주세요."}

    data, error = call_openai(
        SYSTEM_PROMPT,
        "사진에서 식재료 후보를 뽑아주세요.",
        timeout=20.0,
        temperature=0.2,
        image_data_url=image,
    )
    if error:
        return error

    raw_items = data.get("items")
    raw_items = raw_items if isinstance(raw_items, list) else []
    raw_items = [str(x).strip() for x in raw_items if str(x).strip()][:MAX_ITEMS]

    purchase_date = data.get("purchaseDate")
    purchase_date = purchase_date if isinstance(purchase_date, str) and _DATE_RE.match(purchase_date) else None

    return 200, {"items": normalize_and_filter(raw_items), "purchaseDate": purchase_date}
