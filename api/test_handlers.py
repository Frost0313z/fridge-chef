"""서버 쪽 자체 점검. 실행: python api/test_handlers.py

OpenAI를 실제로 부르지 않는다 — 클라이언트를 가짜로 바꿔치기해서 응답 처리만 확인한다.
프레임워크 없이 assert만 쓴다. 실패하면 그 자리에서 멈춘다.
"""

import json
import os
import sys
import threading
import urllib.request
import urllib.error
from http.server import HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("OPENAI_API_KEY", "test-key-not-used")

import _common  # noqa: E402
import index  # noqa: E402
import mealplan  # noqa: E402
import pantry_import  # noqa: E402
import recipe_match  # noqa: E402
import recommend  # noqa: E402
import shopping  # noqa: E402


def test_recipes_dedupe():
    """한 응답에 같은 요리가 두 번 와도 카드는 하나만 나가야 한다."""
    out = recommend.sanitize_recipes(
        [
            {"name": "김치볶음밥", "steps": ["볶는다"]},
            {"name": "김치 볶음밥", "steps": ["또 볶는다"]},  # 띄어쓰기만 다름
            {"name": "된장찌개"},
        ]
    )
    assert [r["name"] for r in out] == ["김치볶음밥", "된장찌개"], out


def test_recipes_schema():
    """이름 없는 항목은 버리고, 배열이 아닌 필드는 배열로 맞추고, 3개에서 끊는다."""
    out = recommend.sanitize_recipes(
        [
            {"name": ""},
            "문자열",
            {"name": "1", "ingredients": "계란", "steps": None},
            {"name": "2"},
            {"name": "3"},
            {"name": "4"},
        ]
    )
    assert [r["name"] for r in out] == ["1", "2", "3"], out
    assert out[0]["ingredients"] == ["계란"], out[0]
    assert out[0]["steps"] == [], out[0]
    assert recommend.sanitize_recipes("배열 아님") == []


def test_recipes_reject_unknown_ingredient():
    """사용자가 알려주지 않은 재료가 섞인 레시피는 통째로 버린다 — 이름과 재료 목록이
    어긋난 카드를 반쪽만 보여주는 것보다, 그 카드 자체를 안 보여주는 쪽이 낫다."""
    out = recommend.sanitize_recipes(
        [
            {"name": "계란찜", "ingredients": ["계란", "물", "소금"]},  # 전부 보유+기본 조미료
            {"name": "새우볶음밥", "ingredients": ["계란", "새우", "밥"]},  # 새우는 안 알려줌
        ],
        pantry_ingredients="계란 2개, 대파",
    )
    assert [r["name"] for r in out] == ["계란찜"], out


def test_recipes_allow_pantry_wording_gap():
    """"양파"라고 입력했는데 AI가 "양파채"라고 쓰는 것처럼, 표기가 완전히 같지 않아도
    포함 관계면(2글자 이상) 같은 재료로 본다(shopping.py의 find_owned와 같은 규칙)."""
    out = recommend.sanitize_recipes(
        [{"name": "제육볶음", "ingredients": ["양파채", "돼지고기"]}],
        pantry_ingredients="양파, 돼지고기 200g",
    )
    assert [r["name"] for r in out] == ["제육볶음"], out


def test_recipes_without_pantry_skips_check():
    """pantry_ingredients를 안 넘기면(기존 호출부 호환) 재료 검증을 하지 않는다."""
    out = recommend.sanitize_recipes([{"name": "아무거나", "ingredients": ["캐비아", "송로버섯"]}])
    assert [r["name"] for r in out] == ["아무거나"], out


def test_handle_filters_unknown_ingredient_recipes():
    """handle()이 실제로 pantry_ingredients를 넘겨주는지 끝까지 확인한다."""

    def fake_call(system, user, timeout, temperature):
        return {
            "recipes": [
                {"name": "계란볶음밥", "ingredients": ["계란", "밥"]},
                {"name": "랍스터파스타", "ingredients": ["랍스터", "생크림"]},
            ]
        }, None

    # 매칭을 비워 AI 경로가 확실히 돌게 한다. 안 그러면 이 테스트가 로컬에 있는 48MB
    # 인덱스를 읽고, 매칭이 걸리는 날에는 AI를 아예 안 불러 조용히 뜻이 바뀐다.
    _fake_index([])

    original, recommend.call_openai = recommend.call_openai, fake_call
    try:
        status, body = recommend.handle({"ingredients": "계란"})
        assert status == 200
        assert [r["name"] for r in body["recipes"]] == ["계란볶음밥"], body
    finally:
        recommend.call_openai = original


def test_exclude_prompt():
    """재추천일 때만 제외 목록이 프롬프트에 들어간다."""
    without = recommend.build_user_prompt("계란", "한 끼", "상관없음", False)
    assert "빼고" not in without, without

    with_exclude = recommend.build_user_prompt("계란", "한 끼", "상관없음", False, ["계란말이", "계란찜"])
    assert "계란말이, 계란찜" in with_exclude, with_exclude


def test_healthy_is_disabled():
    """건강 관리 필터는 UI/UX와 함께 뺐다(2026-08-20) — healthy=True를 줘도 프롬프트에
    아무 영향이 없어야 한다. 되살릴 때 이 테스트부터 고쳐야 한다는 신호가 된다."""
    with_true = recommend.build_user_prompt("계란", "한 끼", "상관없음", True)
    without = recommend.build_user_prompt("계란", "한 끼", "상관없음", False)
    assert with_true == without, (with_true, without)
    assert "건강" not in with_true, with_true


def test_category_prompt():
    """요리 종류를 지정했을 때만 조건 문장이 들어간다. "상관없음"이면 생략한다."""
    without = recommend.build_user_prompt("계란", "한 끼", "상관없음", False, category="상관없음")
    assert "요리 종류" not in without, without

    with_category = recommend.build_user_prompt("계란", "한 끼", "상관없음", False, category="국/탕")
    assert "요리 종류: 국/탕에 해당하는 요리로 추천해줘" in with_category, with_category


def test_exclude_payload_is_guarded():
    """exclude가 배열이 아니거나 쓰레기가 섞여도 죽지 않는다."""
    seen = {}

    def fake_call(system, user, timeout, temperature):
        seen["user"] = user
        return {"recipes": [{"name": "계란밥"}]}, None

    original, recommend.call_openai = recommend.call_openai, fake_call
    try:
        status, _ = recommend.handle({"ingredients": "계란", "exclude": "배열 아님"})
        assert status == 200 and "빼고" not in seen["user"]

        recommend.handle({"ingredients": "계란", "exclude": [None, "", "계란말이"]})
        assert "계란말이" in seen["user"] and "None" not in seen["user"], seen["user"]
    finally:
        recommend.call_openai = original


def test_ai_returns_no_content():
    """AI가 거부해서 content가 None이면 json.loads가 TypeError를 던진다.
    잡지 못하면 응답 자체를 못 보내고 프론트가 네트워크 오류로 오해한다."""

    class FakeMessage:
        content = None

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = self

        @property
        def completions(self):
            return self

        def create(self, **kwargs):
            return type("R", (), {"choices": [type("C", (), {"message": FakeMessage})]})

    original, _common.OpenAI = _common.OpenAI, FakeClient
    try:
        data, error = _common.call_openai("s", "u", timeout=1, temperature=0)
        assert data is None
        status, body = error
        assert status == 502 and body["error"] == "bad_ai_response", error
    finally:
        _common.OpenAI = original


def test_plan_meals():
    """(날짜, 끼니) 한 자리에는 하나만. 모르는 끼니를 저녁으로 바꾸면 진짜 저녁을 밀어낸다."""
    out = mealplan.sanitize_plan(
        [
            {"day": "1일차", "meal": "아침", "menu": "토스트"},
            {"day": "1일차", "meal": "아침", "menu": "같은 자리"},
            {"day": "1일차", "meal": "브런치", "menu": "모르는 끼니"},
            {"day": "1일차", "meal": "저녁", "menu": "덮밥"},
        ],
        days=2,
    )
    assert [(i["meal"], i["menu"]) for i in out] == [("아침", "토스트"), ("저녁", "덮밥")], out


def test_plan_without_meal_is_dinner():
    """세 끼로 나누기 전에 저장된 계획에는 meal이 없다. 그때 계획한 것은 저녁이었다."""
    out = mealplan.sanitize_plan([{"day": f"{d}일차", "menu": f"{d}번"} for d in range(1, 8)], days=7)
    assert len(out) == 7 and {i["meal"] for i in out} == {"저녁"}, out


def test_plan_capped_by_days():
    """일수 × 3끼를 넘겨 오면 잘라낸다."""
    raw = [{"day": f"{d}일차", "meal": m, "menu": f"{d}{m}"} for d in range(1, 8) for m in mealplan.MEALS]
    assert len(mealplan.sanitize_plan(raw, days=2)) == 6


def test_plan_variety_instruction():
    """shoppingList를 응답에서 뺐더니 AI가 그걸 "살 것을 만들지 말라"로 읽어서,
    7일 21끼를 계란·양파·대파로만 채웠다(배포본 실측, 장보기 4종). 다양성 지시가
    사라지면 조용히 그 상태로 돌아가므로 여기서 붙잡는다."""
    assert "최소 15가지" in mealplan.SYSTEM_PROMPT, "재료 가짓수 하한이 빠졌다"
    assert "출력 형식에 대한 이야기일 뿐" in mealplan.SYSTEM_PROMPT, "필드를 빼는 것과 재료를 줄이는 것을 구분해야 한다"


def test_ingredient_rules_are_shared():
    """식단을 짤 때와 빠진 재료를 채울 때가 같은 기준으로 재료를 적어야 한다.
    한쪽만 고치면 같은 요리인데 표기가 달라져 합산이 어긋난다."""
    assert mealplan.INGREDIENT_RULES in mealplan.SYSTEM_PROMPT
    assert mealplan.INGREDIENT_RULES in mealplan.INGREDIENT_SYSTEM_PROMPT
    # 수량을 안 적으면 서버가 뺄셈을 할 수 없다. 이 지시가 빠지면 조용히 다시 부정확해진다.
    assert "숫자를 붙이세요" in mealplan.INGREDIENT_RULES


def test_stale_ingredient_instruction():
    """오래 둔 재료를 먼저 쓰라는 지시가 두 프롬프트에 모두 있어야 한다.
    프론트가 "(13일 전에 넣음)"을 붙여 보내도 지시가 없으면 AI는 그냥 무시한다."""
    assert "전에 넣음" in recommend.SYSTEM_PROMPT, "레시피 추천 프롬프트에 지시 없음"
    assert "먼저 추천" in recommend.SYSTEM_PROMPT
    assert "전에 넣음" in mealplan.SYSTEM_PROMPT, "식단 프롬프트에 지시 없음"
    assert "1일차에 가까운" in mealplan.SYSTEM_PROMPT


def test_pantry_cap():
    """재료가 상한을 넘으면 앞에서 끊는다. 화면 안내가 이 숫자를 그대로 말하므로 값이 중요하다."""
    seen = {}

    def fake_call(system, user, timeout, temperature):
        seen["user"] = user
        return {"plan": [], "shoppingList": []}, None

    original, mealplan.call_openai = mealplan.call_openai, fake_call
    try:
        mealplan.handle({"days": 3, "pantry": [f"재료{i}" for i in range(40)]})
        assert "재료29" in seen["user"], "앞의 30개는 들어가야 한다"
        assert "재료30" not in seen["user"], "31번째부터는 잘려야 한다"
        assert mealplan.MAX_PANTRY == 30, "js/shared.js의 MEALPLAN_PANTRY_LIMIT과 같아야 한다"
    finally:
        mealplan.call_openai = original


def test_shopping_handler_needs_no_ai():
    """재료가 다 적혀 있으면 목록은 코드가 센다 — AI를 부를 일이 없다.
    계획이 비면 아무것도 하지 않는다."""
    status, body = mealplan.handle_shopping({"plan": [], "pantry": []})
    assert status == 400 and body["error"] == "empty_plan", body

    def must_not_call(system, user, timeout, temperature):
        raise AssertionError("재료가 다 있는데 AI를 불렀다")

    original, mealplan.call_openai = mealplan.call_openai, must_not_call
    try:
        status, body = mealplan.handle_shopping(
            {
                "plan": [
                    {"day": "1일차", "meal": "저녁", "menu": "덮밥",
                     "ingredients": ["계란 4개", "두부 1모", "밥 1공기"]}
                ],
                "pantry": ["계란 1개"],
            }
        )
        assert status == 200
        # 계란은 4개 필요한데 1개뿐이라 3개, 두부는 없으니 1모. "밥"은 사러 갈 일이 없다.
        assert brief(body["shoppingList"]) == [
            {"name": "계란", "amount": "3개"},
            {"name": "두부", "amount": "1모"},
        ], body
    finally:
        mealplan.call_openai = original


def test_manual_menu_ingredients_are_filled():
    """사용자가 빈 자리에 직접 넣은 메뉴는 재료가 없다. 그대로 두면 그 끼니가 통째로
    장보기에서 빠지므로, 그 메뉴만 AI에게 물어 채운 뒤 계산에 넣는다."""
    seen = {}

    def fake_call(system, user, timeout, temperature):
        seen["user"] = user
        return {"menus": [{"menu": "제육볶음", "ingredients": ["돼지고기 150g", "양파 1개"]}]}, None

    original, mealplan.call_openai = mealplan.call_openai, fake_call
    try:
        status, body = mealplan.handle_shopping(
            {
                "plan": [
                    {"day": "3일차", "meal": "저녁", "menu": "제육볶음", "ingredients": []},
                    {"day": "3일차", "meal": "점심", "menu": "덮밥", "ingredients": ["계란 2개"]},
                ],
                "pantry": ["양파 3개"],
            }
        )
        assert status == 200
        # 재료를 모르는 메뉴만 묻는다 — 이미 아는 "덮밥"까지 물으면 느려지고 답이 흔들린다.
        assert "제육볶음" in seen["user"] and "덮밥" not in seen["user"], seen["user"]
        # 양파는 냉장고에 3개가 있어 안 사도 된다. 채워 넣은 재료가 계산에 실제로 반영된다.
        assert brief(body["shoppingList"]) == [
            {"name": "돼지고기", "amount": "150g"},
            {"name": "계란", "amount": "2개"},
        ], body
    finally:
        mealplan.call_openai = original


def brief(items):
    """이름과 살 양만 뽑는다. 근거 필드(need/have/uses)까지 매번 적으면 무엇을 확인하는
    테스트인지가 안 읽힌다 — 근거는 test_shopping_shows_why가 따로 본다."""
    return [{"name": i["name"], "amount": i["amount"]} for i in items]


def test_shopping_shows_why():
    """목록의 각 줄은 "왜 이 수량인지"를 함께 들고 나와야 한다.
    숫자만 던지면 사용자는 맞는지 틀리는지 판단할 방법이 없다."""
    plan = [
        {"day": "1일차", "meal": "아침", "menu": "계란 스크램블", "ingredients": ["계란 2개"]},
        {"day": "1일차", "meal": "저녁", "menu": "계란국", "ingredients": ["계란 3개"]},
    ]
    [egg] = shopping.build_shopping_list(plan, ["계란 1개"])
    assert egg["amount"] == "4개" and egg["need"] == "5개" and egg["have"] == "1개"
    assert egg["subtracted"] is True
    assert egg["uses"] == [
        {"day": "1일차", "meal": "아침", "menu": "계란 스크램블", "amount": "2개"},
        {"day": "1일차", "meal": "저녁", "menu": "계란국", "amount": "3개"},
    ], egg["uses"]


def test_shopping_says_it_could_not_subtract():
    """"냉장고에 있는데 왜 또 사라고 하지?"는 근거를 봐야 풀린다.
    단위가 달라 못 뺐다는 사실을 화면이 말할 수 있도록 구분해서 내보낸다."""
    plan = [{"day": "1일차", "meal": "저녁", "menu": "제육", "ingredients": ["돼지고기 150g"]}]
    [pork] = shopping.build_shopping_list(plan, ["돼지고기 1팩"])
    assert pork["amount"] == "150g", pork
    assert pork["have"] == "1팩", "냉장고에 있다는 사실 자체는 알려야 한다"
    assert pork["subtracted"] is False, "뺀 것처럼 보이면 안 된다"


def test_parse_line():
    """재료 한 줄에서 이름·수량·단위를 뽑는다. 못 읽으면 "없다"가 아니라 "모른다"로 둔다."""
    assert shopping.parse_line("계란 2개") == ("계란", 2.0, "개")
    assert shopping.parse_line("대파 1/2대") == ("대파", 0.5, "대")
    assert shopping.parse_line("돼지고기 1.5kg") == ("돼지고기", 1500.0, "g")  # 작은 단위로 맞춘다
    assert shopping.parse_line("계란 3알") == ("계란", 3.0, "개")  # 알과 개는 같은 것을 센다
    assert shopping.parse_line("두부(1모)") == ("두부", 1.0, "모")
    assert shopping.parse_line("김치 조금") == ("김치", None, "")
    assert shopping.parse_line("두부") == ("두부", None, "")
    # 냉장고 재료에 붙어 오는 "(13일 전에 넣음)"은 수량이 아니다. 13을 수량으로 읽으면 안 된다.
    assert shopping.parse_line("양파 2개 (13일 전에 넣음)") == ("양파", 2.0, "개")
    # 레시피 데이터에 4천 번 넘게 나오는 표현. 안 떼면 "소금적당량"이 별개 재료가 된다.
    assert shopping.parse_line("소금 적당량") == ("소금", None, "")
    assert shopping.parse_line("설탕 취향껏") == ("설탕", None, "")
    # 단위 목록에 없는 세는 말도 이름에 남으면 안 된다 — "김치포기"는 레시피의 "김치"와
    # 못 만난다. 수량은 읽되(1/4) 단위는 모르는 채로 두는 것이 맞다.
    assert shopping.parse_line("김치 1/4포기") == ("김치", 0.25, "")
    assert shopping.parse_line("시금치 1줌") == ("시금치", 1.0, "")
    # 이름이 숫자로 시작하면 자를 머리가 없다. 통째로 잃지 말고 예전대로 읽는다.
    assert shopping.parse_line("1++한우 200g")[0] == "++한우"


def test_recipe_index_reads_both_snapshot_formats():
    """코퍼스에 형식이 두 가지다. 구형(79%)은 구분자가 없어 단위어가 이름에 눌러앉았다.

    이게 어긋나면 "물C"·"가쓰오부시줌"이 화면과 장보기 목록에 그대로 나가고,
    한 글자 재료(물·밥·파)는 find_owned의 2글자 가드에 걸려 매칭에서도 빠진다.
    """
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
    import build_recipe_index as builder

    bel = chr(7)
    신형 = "[재료] 돼지고기{b}250{b}g{b}| 김치{b}1/4{b}포기{b}".format(b=bel)
    assert builder.ingredient_names(신형) == ["돼지고기", "김치"]

    구형 = "[재료] 물 1C| 파 1뿌리| 돼지고기 1/3밥공기양| 소금 적당량| 간장(돼지고기양념용) 2T"
    assert builder.ingredient_names(구형) == ["물", "파", "돼지고기", "소금", "간장"]

    # 이름이 숫자로 시작하면 자를 머리가 없다. 버리지 말고 예전 경로로 되돌린다.
    assert builder.ingredient_names("[재료] 2배 식초 2큰술") == ["배식초"]

    # 대괄호는 재료가 아니라 그룹 라벨이다. 라벨만 지우고 뒤에 붙은 재료는 살린다.
    assert builder.ingredient_names("[주재료]두부 1모") == ["두부"]


def test_shopping_sums_across_meals():
    """AI가 못 하던 일 — 여러 끼니에 흩어진 같은 재료를 더한다."""
    plan = [
        {"ingredients": ["계란 2개", "대파 1/2대"]},
        {"ingredients": ["계란 3개"]},
        {"ingredients": ["계란 1알", "대파 1/2대"]},
    ]
    assert brief(shopping.build_shopping_list(plan, [])) == [
        {"name": "계란", "amount": "6개"},
        {"name": "대파", "amount": "1대"},
    ]


def test_shopping_subtracts_pantry():
    """냉장고에 있는 만큼만 뺀다. "조금이라도 있으면 넘어가는" 것이 원래의 버그였다."""
    plan = [{"ingredients": ["계란 6개", "우유 300ml"]}, {"ingredients": ["계란 4개"]}]
    assert brief(shopping.build_shopping_list(plan, ["계란 4개", "우유 1l"])) == [
        {"name": "계란", "amount": "6개"},  # 10개 필요, 4개 보유
    ]  # 우유는 1리터가 있어 300ml는 덮인다


def test_shopping_without_pantry_quantity():
    """냉장고에 수량이 안 적혀 있으면 뺄 근거가 없다. 필요한 만큼을 그대로 올린다 —
    이미 있는 걸 또 사는 쪽이, 필요한 걸 안 사서 못 만드는 쪽보다 낫다."""
    plan = [{"ingredients": ["계란 6개"]}]
    assert brief(shopping.build_shopping_list(plan, ["계란"])) == [{"name": "계란", "amount": "6개"}]


def test_shopping_without_plan_quantity():
    """수량 없이 저장된 옛 계획. 얼마나 부족한지 계산할 수 없으므로 냉장고에 있으면 두고,
    없으면 이름만 올린다. 여기서 수량을 지어내면 틀린 숫자를 믿게 만든다."""
    plan = [{"ingredients": ["두부", "애호박"]}]
    assert brief(shopping.build_shopping_list(plan, ["두부 1모"])) == [{"name": "애호박", "amount": ""}]


def test_shopping_rounds_up():
    """0.5모가 필요해도 반 모는 못 산다. 살 수 있는 단위로 올린다."""
    plan = [{"ingredients": ["두부 1/4모"]}, {"ingredients": ["두부 1/4모"]}]
    assert brief(shopping.build_shopping_list(plan, [])) == [{"name": "두부", "amount": "1모"}]


def test_shopping_excludes_staples():
    """소금·밥처럼 사러 갈 일이 없는 것은 재료로 적혀 있어도 목록에서 뺀다."""
    plan = [{"ingredients": ["소금 1작은술", "밥 1공기", "고춧가루 1큰술", "계란 1개"]}]
    assert brief(shopping.build_shopping_list(plan, [])) == [{"name": "계란", "amount": "1개"}]


def test_shopping_full_week_regression():
    """AI가 틀렸던 그 상황 — 7일치 21끼. 계란은 냉장고에 4개뿐이라 반드시 목록에 남아야 한다.
    계획이 커질수록 틀리던 것이 이 함수를 만든 이유이므로, 규모 그대로 확인한다."""
    plan = [{"ingredients": ["계란 2개", "양파 1/2개", "대파 1/2대"]} for _ in range(21)]
    out = {i["name"]: i["amount"] for i in shopping.build_shopping_list(plan, ["계란 4개", "양파 2개", "대파 1대"])}
    assert out == {"계란": "38개", "양파": "9개", "대파": "10대"}, out


def test_handler_returns_500_on_crash():
    """기능 모듈이 예외를 던져도 HTTP 응답은 나가야 한다 (연결이 끊기면 안 된다)."""

    def boom(payload):
        raise RuntimeError("의도한 폭발")

    index.ROUTES["boom"] = boom
    server = HTTPServer(("127.0.0.1", 0), index.handler)
    threading.Thread(target=server.handle_request, daemon=True).start()
    port = server.server_address[1]

    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/index.py?route=boom",
        data=b"{}",
        headers={"Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(request, timeout=5)
        raise AssertionError("500이 나와야 한다")
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        assert e.code == 500, e.code
        assert body["message"] == "처리 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.", body
    finally:
        server.server_close()
        index.ROUTES.pop("boom", None)


def test_recipes_keep_one_letter_staples_with_amount():
    """"물 1컵"처럼 한 글자 재료에 수량이 붙어도 알아본다. 레시피 쪽 재료도 parse_line으로
    수량을 떼고 비교하기 때문이다 — 안 떼면 find_owned의 한 글자 방어에 걸려 물·밥·쌀이
    들어간 레시피가 전부 버려진다(찌개·국·찜이 다 여기 해당한다)."""
    out = recommend.sanitize_recipes(
        [{"name": "계란찜", "ingredients": ["계란 2개", "물 1컵", "소금 약간"]}],
        pantry_ingredients="계란 2개, 밥",
    )
    assert [r["name"] for r in out] == ["계란찜"], out


def test_recipes_keep_only_the_clean_ones():
    """섞여 들어오면 통과한 것만 남는다 — 되살리기는 전부 걸렸을 때만이다."""
    out = recommend.sanitize_recipes(
        [
            {"name": "계란찜", "ingredients": ["계란 2개", "물 1컵", "소금"]},
            {"name": "새우볶음밥", "ingredients": ["계란", "새우 100g", "밥"]},
            {"name": "랍스터파스타", "ingredients": ["랍스터 1마리", "생크림 200ml"]},
        ],
        pantry_ingredients="계란 2개, 밥",
    )
    assert [r["name"] for r in out] == ["계란찜"], out


def test_recipes_never_return_empty_because_of_the_check():
    """전부 걸리면 거른 것을 그대로 돌려준다. 이 검증은 이름을 글자로 맞춰보는 것이라
    "달걀"과 "계란"처럼 같은 것을 다르게 적으면 못 알아보는데, 그때 빈 손으로 돌려보내면
    화면이 "재료를 다르게 입력해보세요"라고 엉뚱하게 말하며 막다른 길이 된다(B7).
    카드는 없는 재료에 "사야 해요"를 이미 붙이므로 사용자가 속지도 않는다."""
    out = recommend.sanitize_recipes(
        [
            {"name": "새우볶음밥", "ingredients": ["새우 100g"]},
            {"name": "랍스터파스타", "ingredients": ["랍스터 1마리"]},
        ],
        pantry_ingredients="계란 2개",
    )
    assert [r["name"] for r in out] == ["새우볶음밥", "랍스터파스타"], out


def test_recipes_dedupe_applies_to_dropped_too():
    """되살리는 쪽에도 중복 제거가 걸린다 — 같은 요리가 카드 두 장으로 뜨면 고장으로 보인다."""
    out = recommend.sanitize_recipes(
        [
            {"name": "새우볶음밥", "ingredients": ["새우 100g"]},
            {"name": "새우 볶음밥", "ingredients": ["새우 200g"]},
        ],
        pantry_ingredients="계란",
    )
    assert [r["name"] for r in out] == ["새우볶음밥"], out


def _fake_index(recipes):
    """실제 인덱스 파일(api/recipes_index.json)은 용량 때문에 저장소에 없다.
    역색인까지 직접 채워서 파일 없이 매칭 로직만 본다."""
    import collections

    recipe_match._index = recipes
    recipe_match._inverted = collections.defaultdict(list)
    for i, r in enumerate(recipes):
        for n in set(r["ing"]):
            recipe_match._inverted[n].append(i)


def test_load_index_logs_when_missing():
    """인덱스 파일이 없으면 AI 전용 폴백은 그대로 두되, vercel logs에서 보이는 흔적을
    남긴다 — 2026-08-20에 이 흔적이 없어서 배포가 조용히 새는 걸 한참 몰랐다."""
    import contextlib
    import io

    original_index = recipe_match._index
    original_inverted = recipe_match._inverted
    original_path = recipe_match.INDEX_PATH
    recipe_match._index = None
    recipe_match._inverted = None
    recipe_match.INDEX_PATH = "definitely/does/not/exist.json"
    try:
        captured = io.StringIO()
        with contextlib.redirect_stderr(captured):
            index, inverted = recipe_match.load_index()
        assert index == [] and dict(inverted) == {}, (index, inverted)
        assert "recipes_index.json not found" in captured.getvalue(), captured.getvalue()
    finally:
        recipe_match._index = original_index
        recipe_match._inverted = original_inverted
        recipe_match.INDEX_PATH = original_path


def test_match_prefers_using_more_of_the_fridge():
    """커버율만 보면 재료 적은 레시피가 늘 이긴다. score=(hit/total)*hit이 그걸 뒤집는다 —
    3개를 다 맞춘 것(3점)보다 8개 중 7개를 맞춘 것(6.1점)이 냉장고를 더 쓴다."""
    _fake_index([
        {"id": 1, "name": "간단한것", "ing": ["김치", "밥", "참기름"], "pop": 999},
        {"id": 2, "name": "제대로된것",
         "ing": ["김치", "밥", "참기름", "두부", "대파", "계란", "양파", "당근"], "pop": 0},
    ])
    out = recipe_match.match(["김치", "밥", "참기름", "두부", "대파", "계란", "양파"])
    assert [r["name"] for r in out] == ["제대로된것", "간단한것"], out


def test_match_filters_by_category():
    """요리 종류를 지정하면 cat이 정확히 일치하는 레시피만 남는다. "상관없음"이거나
    비어 있으면 지금처럼 전체가 후보다."""
    _fake_index([
        {"id": 1, "name": "김치찌개", "ing": ["김치", "돼지고기", "두부"], "cat": "찌개", "pop": 0},
        {"id": 2, "name": "김치볶음밥", "ing": ["김치", "밥", "참기름"], "cat": "밥/죽/떡", "pop": 0},
    ])
    pantry = ["김치", "돼지고기", "두부", "밥", "참기름"]

    out = recipe_match.match(pantry, category="찌개")
    assert [r["name"] for r in out] == ["김치찌개"], out

    out = recipe_match.match(pantry, category="상관없음")
    assert {r["name"] for r in out} == {"김치찌개", "김치볶음밥"}, out

    out = recipe_match.match(pantry)
    assert {r["name"] for r in out} == {"김치찌개", "김치볶음밥"}, out


def test_match_counts_duplicate_ingredients_once():
    """재료 그룹이 겹치면([재료]+[양념] 양쪽에 소금·마늘 등) ing 리스트에 같은 이름이
    여러 번 들어간다. 분모를 원본 길이로 세면 사용자가 고유 재료를 다 갖고 있어도
    커버율이 실제보다 낮게 나와 잘못 걸러진다."""
    _fake_index([
        {"id": 1, "name": "겹치는재료요리", "ing": ["계란", "계란", "대파", "두부", "두부"], "pop": 0},
    ])
    out = recipe_match.match(["계란", "대파", "두부"])
    assert [r["name"] for r in out] == ["겹치는재료요리"], out
    assert out[0]["coverage"] == 1.0, out


def test_match_drops_duplicate_names():
    """RCP_SNO가 달라도 화면에 같은 이름 카드가 두 장 뜨면 고장으로 보인다.
    인덱스에서는 합치지 않고(진짜 다른 레시피다) 응답에서만 거른다."""
    _fake_index([
        {"id": 1, "name": "만능간장", "ing": ["간장", "설탕", "물"], "pop": 10},
        {"id": 2, "name": "만능 간장", "ing": ["간장", "설탕", "마늘"], "pop": 5},
        {"id": 3, "name": "다른요리", "ing": ["간장", "설탕", "물"], "pop": 1},
    ])
    out = recipe_match.match(["간장", "설탕", "물", "마늘"])
    assert [r["name"] for r in out] == ["만능간장", "다른요리"], out


def test_matched_recipe_never_carries_steps():
    """조리 순서 원문을 우리 응답에 싣지 않는다 — 데이터 라이선스의 ND 조건이라
    문구 문제가 아니라 지켜야 하는 경계다(docs/spec-recipe-match.md)."""
    _fake_index([{"id": 7016813, "name": "떡국", "ing": ["떡국떡", "소고기", "계란"], "pop": 1}])
    out = recipe_match.match(["떡국떡", "소고기", "계란"])
    assert out[0]["steps"] == [], out
    assert out[0]["recipeUrl"] == "https://www.10000recipe.com/recipe/7016813", out
    assert out[0]["source"] == "matched", out


def test_pantry_import_requires_image():
    """이미지가 없거나 data URL 형식이 아니면 AI를 부르지 않고 바로 400."""
    status, body = pantry_import.handle({})
    assert status == 400 and body["error"] == "empty_input", body

    status, body = pantry_import.handle({"image": "그냥 문자열"})
    assert status == 400 and body["error"] == "empty_input", body


def test_pantry_import_filters_by_vocab_and_occurrence():
    """어휘에 없는 이름(마들렌)과 문턱값 미만으로만 등장하는 이름(도리토스, 1회)은 버리고,
    걸리는 이름은 어휘의 정규화된 형태로 치환한다."""
    _fake_index(
        [{"id": i, "name": f"r{i}", "ing": ["닭가슴살", "우유"]} for i in range(5)]
        + [{"id": 99, "name": "나쵸", "ing": ["도리토스"]}]
    )
    out = pantry_import.normalize_and_filter(
        ["로켓프레시 한끼통살 닭가슴살 볼 5종 믹스세트(냉동)", "우유", "도리토스", "마들렌"]
    )
    assert out == ["닭가슴살", "우유"], out


def test_pantry_import_dedupes_matches():
    """서로 다른 원문이 같은 어휘로 정규화되면 한 번만 남는다."""
    _fake_index([{"id": i, "name": f"r{i}", "ing": ["계란"]} for i in range(5)])
    out = pantry_import.normalize_and_filter(["계란 1판", "계란후라이용 계란"])
    assert out == ["계란"], out


def test_pantry_import_end_to_end():
    """handle()이 비전 호출 결과를 실제로 어휘 대조까지 통과시키는지 끝까지 확인한다."""
    _fake_index(
        [{"id": i, "name": f"r{i}", "ing": ["닭가슴살", "우유"]} for i in range(5)]
        + [{"id": 99, "name": "나쵸", "ing": ["도리토스"]}]
    )

    def fake_call(system, user, timeout, temperature, image_data_url=None):
        assert image_data_url == "data:image/png;base64,xxx", image_data_url
        return {
            "items": ["로켓프레시 닭가슴살 볼 믹스세트", "우유", "도리토스", "마들렌"],
            "purchaseDate": "2026-08-19",
        }, None

    original, pantry_import.call_openai = pantry_import.call_openai, fake_call
    try:
        status, body = pantry_import.handle({"image": "data:image/png;base64,xxx"})
        assert status == 200
        assert body["items"] == ["닭가슴살", "우유"], body
        assert body["purchaseDate"] == "2026-08-19", body
    finally:
        pantry_import.call_openai = original


def test_pantry_import_bad_date_becomes_null():
    """AI가 형식에 안 맞는 날짜(또는 아예 없음)를 주면 조용히 null로 내려보낸다 —
    엉뚱한 문자열을 그대로 addedAt에 심으면 냉장고 화면이 깨진다."""
    _fake_index([])

    def fake_call(system, user, timeout, temperature, image_data_url=None):
        return {"items": [], "purchaseDate": "모르겠음"}, None

    original, pantry_import.call_openai = pantry_import.call_openai, fake_call
    try:
        _, body = pantry_import.handle({"image": "data:image/png;base64,xxx"})
        assert body["purchaseDate"] is None, body
    finally:
        pantry_import.call_openai = original


def test_pantry_import_propagates_ai_error():
    """call_openai가 오류를 돌려주면 그대로 응답한다 — 여기서 다시 감싸지 않는다."""
    _fake_index([])

    def fake_call(system, user, timeout, temperature, image_data_url=None):
        return None, (504, {"error": "timeout", "message": "지연"})

    original, pantry_import.call_openai = pantry_import.call_openai, fake_call
    try:
        status, body = pantry_import.handle({"image": "data:image/png;base64,xxx"})
        assert status == 504 and body["error"] == "timeout", body
    finally:
        pantry_import.call_openai = original


def test_call_openai_adds_image_part_when_given():
    """image_data_url을 주면 user 메시지가 텍스트+이미지 배열로 바뀐다. 안 주면(기존 호출부)
    지금처럼 문자열 그대로라 recommend.py·mealplan.py는 손댈 필요가 없다."""
    seen = {}

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = self

        @property
        def completions(self):
            return self

        def create(self, **kwargs):
            seen["messages"] = kwargs["messages"]
            content = json.dumps({"ok": True})
            return type("R", (), {"choices": [type("C", (), {"message": type("M", (), {"content": content})})]})

    original, _common.OpenAI = _common.OpenAI, FakeClient
    try:
        _common.call_openai("s", "u", timeout=1, temperature=0)
        assert seen["messages"][1]["content"] == "u", seen

        _common.call_openai("s", "u", timeout=1, temperature=0, image_data_url="data:image/png;base64,xxx")
        parts = seen["messages"][1]["content"]
        assert parts == [
            {"type": "text", "text": "u"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,xxx"}},
        ], parts
    finally:
        _common.OpenAI = original


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  ok  {name}")
    print("all passed")
