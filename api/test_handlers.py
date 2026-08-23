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
            {"name": "계란찜", "ingredients": ["계란", "물", "소금"]},  # 전부 실제 보유
            {"name": "새우볶음밥", "ingredients": ["계란", "새우", "밥"]},  # 새우는 안 알려줌
        ],
        pantry_ingredients="계란 2개, 대파, 물, 소금",
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
        status, body = recommend.handle({"ingredients": "계란, 밥"})
        assert status == 200
        assert [r["name"] for r in body["recipes"]] == ["계란볶음밥"], body
    finally:
        recommend.call_openai = original


def test_exclude_prompt():
    """재추천일 때만 제외 목록이 프롬프트에 들어간다."""
    without = recommend.build_user_prompt("계란", "한 끼", "상관없음")
    assert "빼고" not in without, without

    with_exclude = recommend.build_user_prompt("계란", "한 끼", "상관없음", ["계란말이", "계란찜"])
    assert "계란말이, 계란찜" in with_exclude, with_exclude


def test_category_prompt():
    """요리 종류를 지정했을 때만 조건 문장이 들어간다. "상관없음"이면 생략한다."""
    without = recommend.build_user_prompt("계란", "한 끼", "상관없음", category="상관없음")
    assert "요리 종류" not in without, without

    with_category = recommend.build_user_prompt("계란", "한 끼", "상관없음", category="국/탕")
    assert "요리 종류: 국/탕에 해당하는 요리로 추천해줘" in with_category, with_category


def test_exclude_payload_is_guarded():
    """exclude가 배열이 아니거나 쓰레기가 섞여도 죽지 않는다."""
    seen = {}

    def fake_call(system, user, timeout, temperature):
        seen["user"] = user
        return {"recipes": [{"name": "계란밥"}]}, None

    # test_recipes_dedupe와 같은 이유로 매칭을 비운다 — 안 비우면 로컬에 있는 실제 인덱스를
    # 읽고, 매칭이 걸리는 날에는 AI를 아예 안 불러 이 테스트가 조용히 뜻을 잃는다.
    # (로컬 인덱스 내용에 따라 "계란" 하나로도 매칭이 걸릴 수 있다.)
    _fake_index([])

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
        # 계란은 4개 필요한데 1개뿐이라 3개, 두부와 밥은 없으니 그대로 장보기에 남는다.
        assert brief(body["shoppingList"]) == [
            {"name": "계란", "amount": "3개"},
            {"name": "두부", "amount": "1모"},
            {"name": "밥", "amount": "1공기"},
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
    assert builder.ingredient_pairs(신형) == [("돼지고기", "250g"), ("김치", "1/4포기")]

    구형 = "[재료] 물 1C| 파 1뿌리| 돼지고기 1/3밥공기양| 소금 적당량| 간장(돼지고기양념용) 2T"
    assert builder.ingredient_pairs(구형) == [
        ("물", "1C"), ("파", "1뿌리"), ("돼지고기", "1/3밥공기양"),
        ("소금", ""), ("간장", "2T"),
    ]

    # 이름이 숫자로 시작하면 자를 머리가 없다. 버리지 말고 예전 경로로 되돌린다.
    # 어디까지가 수량인지 가릴 수 없으므로 수량은 비운다.
    assert builder.ingredient_pairs("[재료] 2배 식초 2큰술") == [("배식초", "")]

    # 대괄호는 재료가 아니라 그룹 라벨이다. 라벨만 지우고 뒤에 붙은 재료는 살린다.
    assert builder.ingredient_pairs("[주재료]두부 1모") == [("두부", "1모")]


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


def test_shopping_includes_missing_staples():
    """기본 재료도 실제로 없으면 장보기 대상이다. 물과 뭉뚱그린 이름만 뺀다."""
    plan = [{"ingredients": ["물 1컵", "소금 1작은술", "고춧가루 1큰술", "계란 1개"]}]
    assert brief(shopping.build_shopping_list(plan, [])) == [
        {"name": "소금", "amount": "1작은술"},
        {"name": "고춧가루", "amount": "1큰술"},
        {"name": "계란", "amount": "1개"},
    ]


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
        pantry_ingredients="계란 2개, 밥, 물, 소금",
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
        pantry_ingredients="계란 2개, 밥, 물, 소금",
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
    파일 없이 매칭 로직만 보려고 메모리에 직접 채운다.

    받는 모양은 사람이 읽기 쉬운 dict 그대로 두고, 여기서 실제 파일과 같은 모양으로
    접는다 — 빌더의 pack()과 같은 규칙이다. 내부 표현이 바뀌어도 고칠 자리가 여기
    하나뿐이라, 호출하는 테스트 12곳은 손대지 않아도 된다."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
    import build_recipe_index as builder

    packed = builder.pack([
        {
            "id": r.get("id", 0),
            "name": r.get("name", ""),
            # 테스트는 이름만 적는다("김치"). 수량까지 쓰고 싶으면 쌍으로 적는다
            # (("김치", "1/4포기")). 둘 다 받아서 빌더가 기대하는 모양으로 접는다.
            "ing": [x if isinstance(x, tuple) else (x, "") for x in (r.get("ing") or ())],
            "time": r.get("time", ""),
            "inbun": r.get("inbun", ""),
            "cat": r.get("cat", ""),
            "pop": r.get("pop", 0),
        }
        for r in recipes
    ])
    recipe_match._index = packed
    recipe_match._inverted = packed["p"]


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
        assert index["r"] == [] and inverted == [], (index, inverted)
        assert "recipes_index.json not found" in captured.getvalue(), captured.getvalue()
    finally:
        recipe_match._index = original_index
        recipe_match._inverted = original_inverted
        recipe_match.INDEX_PATH = original_path


def test_load_index_survives_a_broken_file():
    """잘린 인덱스도 없는 것과 같게 다룬다.

    46MB짜리를 로컬에서 만들어 Vercel CLI가 통째로 올리는 구조라 잘린 파일이 실제로
    생길 수 있다. 파일 없음만 막고 깨진 것을 안 막으면 방향이 거꾸로가 된다 —
    없으면 서비스가 살고 깨지면 매 요청이 500이 되어 스스로 낫지도 않는다.
    """
    import contextlib
    import io
    import tempfile

    original_index = recipe_match._index
    original_inverted = recipe_match._inverted
    original_path = recipe_match.INDEX_PATH

    broken = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    broken.write('[{"id":1,"name":"김치찌개","ing":["김치","두부"')  # 덤프 중간에 끊긴 모양
    broken.close()

    recipe_match._index = None
    recipe_match._inverted = None
    recipe_match.INDEX_PATH = broken.name
    try:
        captured = io.StringIO()
        with contextlib.redirect_stderr(captured):
            index, inverted = recipe_match.load_index()
        assert index["r"] == [] and inverted == [], (index, inverted)
        assert "unreadable" in captured.getvalue(), captured.getvalue()
        # 부르는 쪽이 죽지 않고 빈 결과로 넘어가야 AI 생성 폴백이 살아난다.
        assert recipe_match.match(["김치", "두부"]) == []
    finally:
        os.remove(broken.name)
        recipe_match._index = original_index
        recipe_match._inverted = original_inverted
        recipe_match.INDEX_PATH = original_path


def test_recipe_index_is_written_atomically():
    """덤프 중간에 죽어도 예전 인덱스가 남아야 한다 — 잘린 파일을 남기면 위 테스트의
    상황을 우리가 직접 만드는 셈이다."""
    import json as _json
    import tempfile
    from unittest import mock

    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
    import build_recipe_index as builder

    with tempfile.TemporaryDirectory() as tmpdir:
        out = os.path.join(tmpdir, "recipes_index.json")
        with open(out, "w", encoding="utf-8") as fh:
            fh.write('[{"id":1,"name":"예전 인덱스"}]')

        original_out, original_sources = builder.OUT, builder.SOURCES
        builder.OUT, builder.SOURCES = out, []  # CSV는 읽지 않는다 — 쓰기만 본다
        try:
            with mock.patch.object(builder.json, "dump", side_effect=KeyboardInterrupt):
                try:
                    builder.main()
                except KeyboardInterrupt:
                    pass
            with open(out, encoding="utf-8") as fh:
                assert _json.load(fh) == [{"id": 1, "name": "예전 인덱스"}], "예전 인덱스가 덮여 썼다"
            assert not os.path.exists(out + ".tmp"), "임시 파일이 남았다"
        finally:
            builder.OUT, builder.SOURCES = original_out, original_sources


def test_load_index_refuses_a_different_format():
    """인덱스는 .gitignore라 코드와 따로 움직인다 — 코드만 되돌리거나 인덱스만 옛것이
    남는 일이 실제로 생긴다. 그냥 읽으면 TypeError로 매 요청 500이 되고 스스로 낫지
    않으므로, 깨진 파일과 똑같이 취급해 AI 폴백으로 보낸다."""
    import contextlib
    import io
    import tempfile

    original_index = recipe_match._index
    original_inverted = recipe_match._inverted
    original_path = recipe_match.INDEX_PATH

    # v1(레시피 dict를 그냥 늘어놓던 옛 포맷)
    old = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    old.write('[{"id":1,"name":"김치찌개","ing":["김치","두부","대파"]}]')
    old.close()

    recipe_match._index = None
    recipe_match._inverted = None
    recipe_match.INDEX_PATH = old.name
    try:
        captured = io.StringIO()
        with contextlib.redirect_stderr(captured):
            index, inverted = recipe_match.load_index()
        assert index["r"] == [] and inverted == [], (index, inverted)
        assert "format mismatch" in captured.getvalue(), captured.getvalue()
        # 부르는 쪽이 죽지 않고 빈 결과로 넘어가야 AI 생성 폴백이 산다.
        assert recipe_match.match(["김치", "두부", "대파"]) == []
    finally:
        os.remove(old.name)
        recipe_match._index = original_index
        recipe_match._inverted = original_inverted
        recipe_match.INDEX_PATH = original_path


def test_match_puts_ready_to_cook_first():
    """지금 장을 안 보고 만들 수 있는 것이 무엇보다 먼저다.

    점수(score)만 보면 "8개 중 7개를 맞춘 것"(6.1점)이 "3개를 다 맞춘 것"(3점)을 이기고,
    한동안 실제로 그렇게 정렬했다 — 냉장고를 더 많이 쓰는 쪽이 이 서비스의 목적에 맞다고
    봤기 때문이다. 그런데 그 결과가 "재료 하나만 사 오세요"인 카드가 매번 맨 위에 오는
    것이었다. 오늘 저녁을 해결하러 온 사람에게 장을 보라는 답은 배달앱으로 가는 길이고
    (기획서의 장벽 3), 그러면 서비스가 약속한 "있는 대로 오늘 한끼"가 깨진다.
    그래서 다 갖춘 쪽을 먼저 올린다. 점수 규칙은 아래 테스트처럼 그대로 살아 있다."""
    _fake_index([
        {"id": 1, "name": "간단한것", "ing": ["김치", "밥", "참기름"], "pop": 999},
        {"id": 2, "name": "제대로된것",
         "ing": ["김치", "밥", "참기름", "두부", "대파", "계란", "양파", "당근"], "pop": 0},
    ])
    # 당근이 없어서 "제대로된것"은 87.5%다 — 만들려면 사러 나가야 한다.
    out = recipe_match.match(["김치", "밥", "참기름", "두부", "대파", "계란", "양파"])
    assert [r["name"] for r in out] == ["간단한것", "제대로된것"], out


def test_match_prefers_using_more_of_the_fridge():
    """커버율만 보면 재료 적은 레시피가 늘 이긴다. score=(hit/total)*hit이 그걸 뒤집는다 —
    3개를 다 맞춘 것(3점)보다 8개 중 7개를 맞춘 것(6.1점)이 냉장고를 더 쓴다.

    위 테스트가 "지금 바로 되는 것"을 앞으로 뺐으므로, 이 규칙은 같은 그룹 안에서 작동한다.
    여기서는 둘 다 100%라 둘 다 지금 만들 수 있고, 그때 냉장고를 더 쓰는 쪽이 이긴다."""
    _fake_index([
        {"id": 1, "name": "간단한것", "ing": ["김치", "밥", "참기름"], "pop": 999},
        {"id": 2, "name": "제대로된것",
         "ing": ["김치", "밥", "참기름", "두부", "대파", "계란", "양파", "당근"], "pop": 0},
    ])
    out = recipe_match.match(["김치", "밥", "참기름", "두부", "대파", "계란", "양파", "당근"])
    assert [r["name"] for r in out] == ["제대로된것", "간단한것"], out


def test_match_ready_mode_returns_only_what_can_be_cooked_now():
    """"지금 있는 걸로 해먹기"는 추가 구매가 필요한 것을 아예 내보내지 않는다.
    한 장이라도 섞이면 버튼이 한 약속이 깨진다."""
    _fake_index([
        {"id": 1, "name": "바로되는것", "ing": ["김치", "밥", "참기름"], "pop": 0},
        {"id": 2, "name": "사야되는것", "ing": ["김치", "밥", "참기름", "참치"], "pop": 999},
    ])
    out = recipe_match.match(["김치", "밥", "참기름"], mode="ready")
    assert [r["name"] for r in out] == ["바로되는것"], out
    # 인기도가 높아도(pop 999) 사야 하는 것은 못 들어온다.
    assert all(r["coverage"] >= 1.0 for r in out), out


def test_match_only_counts_registered_basic_ingredients():
    """기본 재료도 실제로 등록한 것만 보유로 센다."""
    _fake_index([
        {"id": 1, "name": "두부조림", "ing": ["두부", "대파", "소금", "간장", "설탕"], "pop": 0},
    ])
    assert recipe_match.match(["두부", "대파"], mode="ready") == []
    out = recipe_match.match(["두부", "대파", "소금", "간장", "설탕"], mode="ready")
    assert [r["name"] for r in out] == ["두부조림"], out


def test_match_shopping_mode_puts_the_cheapest_trip_first():
    """"사서 해먹기"는 반대로 지금 되는 것을 빼고, 적게 사도 되는 것부터 올린다.
    이 버튼을 누른 사람은 이미 사기로 정했으므로 질문이 "얼마나 사야 하나"로 바뀐다."""
    _fake_index([
        {"id": 1, "name": "바로되는것", "ing": ["김치", "밥", "참기름"], "pop": 999},
        {"id": 2, "name": "세개사야함",
         "ing": ["김치", "밥", "참기름", "참치", "치즈", "김", "깻잎", "당근", "무", "파"], "pop": 999},
        {"id": 3, "name": "하나만사면됨", "ing": ["김치", "밥", "참기름", "참치"], "pop": 0},
    ])
    out = recipe_match.match(["김치", "밥", "참기름"], limit=5, mode="shopping")
    names = [r["name"] for r in out]
    assert "바로되는것" not in names, out
    # 인기도가 낮아도 적게 사도 되는 쪽이 먼저다.
    assert names[0] == "하나만사면됨", out


def test_shopping_mode_never_calls_ai():
    """코퍼스에 없으면 없다고 말한다. SYSTEM_PROMPT는 "알려주지 않은 재료를 추가하지
    말라"고 지시하므로, 이 모드가 원하는 답을 AI에게 시킬 수 없다 — 부르면 엉뚱한 것이 온다."""
    def fake_call(*args, **kwargs):
        raise AssertionError("사서 해먹기에서 AI를 부르면 안 된다")

    _fake_index([])
    original, recommend.call_openai = recommend.call_openai, fake_call
    try:
        status, body = recommend.handle({"ingredients": "계란", "mode": "shopping"})
        assert status == 200 and body["recipes"] == [], body
    finally:
        recommend.call_openai = original


def test_ready_mode_does_not_revive_recipes_that_need_shopping():
    """재료 검증에 걸린 레시피를 되살리는 폴백은 "지금 있는 걸로"에서는 거짓말이 된다.
    사야 할 게 없다고 약속한 자리에 "사야 해요" 카드를 내미는 셈이기 때문이다.
    대신 빈 결과로 두고, 화면이 다른 버튼을 권한다(js/copy.js emptyReadyMode)."""
    raw = [{"name": "랍스터파스타", "ingredients": ["랍스터", "생크림"], "steps": []}]
    # 평소에는 전부 걸렸을 때 그대로 되살린다(B7 막다른 길 방지).
    assert recommend.sanitize_recipes(raw, "계란")
    # strict에서는 되살리지 않는다.
    assert recommend.sanitize_recipes(raw, "계란", strict=True) == []


def test_find_owned_does_not_count_a_product_as_its_ingredient():
    """부분 문자열이 겹쳐도 한쪽만 완제품이면 다른 물건이다.

    "김치"를 가졌다고 "김치만두"까지 가진 것이 되면, 화면은 다 있다고 하는데 실제로는
    만들 수 없다 — 이 서비스에서 가장 비싼 종류의 거짓말이다. 실측으로는 흔한 재료 10종에
    이런 이름이 243종 걸렸다(shopping.PRODUCT_SUFFIXES 주석 참고)."""
    assert shopping.find_owned("김치만두", ["김치"]) is None
    assert shopping.find_owned("불고기양념장", ["고기"]) is None
    assert shopping.find_owned("서울우유고다치즈", ["우유"]) is None
    assert shopping.find_owned("마파두부소스", ["두부"]) is None

    # 같은 재료를 다르게 적은 것은 그대로 인정해야 한다 — 규칙이 과하면 반대로 틀린다.
    assert shopping.find_owned("다진대파", ["대파"]) == "대파"
    assert shopping.find_owned("삶은계란", ["계란"]) == "계란"
    assert shopping.find_owned("배추김치", ["김치"]) == "김치"
    # 둘 다 같은 완제품 계열이면 같은 물건으로 본다.
    assert shopping.find_owned("모짜렐라치즈", ["치즈"]) == "치즈"
    # "둘 중 아무거나" 표기는 접미어로 읽지 않는다.
    assert shopping.find_owned("우유또는생크림", ["우유"]) == "우유"


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


def test_match_prefers_the_portion_the_user_picked():
    """"한 끼"를 고르면 1~2인분이 먼저 온다. 점수가 낮아도 먼저다 —
    점수는 우리가 매긴 값이고 분량은 사용자가 말한 값이다."""
    _fake_index([
        # 점수가 더 높다(재료 4개를 다 씀). 하지만 6인분이다.
        {"id": 1, "name": "대용량찌개", "ing": ["김치", "두부", "대파", "계란"],
         "pop": 100, "inbun": "6인분이상"},
        # 점수는 낮지만(재료 3개) 혼자 먹기에 맞다.
        {"id": 2, "name": "김치두부", "ing": ["김치", "두부", "대파"],
         "pop": 1, "inbun": "1인분"},
    ])
    names = [r["name"] for r in recipe_match.match(["김치", "두부", "대파", "계란"], portion="한 끼")]
    assert names[0] == "김치두부", names

    # 분량을 안 주면 예전처럼 점수 순이다.
    names = [r["name"] for r in recipe_match.match(["김치", "두부", "대파", "계란"])]
    assert names[0] == "대용량찌개", names


def test_match_never_drops_a_recipe_for_its_portion():
    """우선순위지 필터가 아니다. 1인분은 코퍼스의 15.4%뿐이라 걸러내면 85%를 버리고,
    매칭이 자주 실패해 오히려 덜 믿을 만한 AI 생성으로 넘어간다."""
    _fake_index([
        {"id": 1, "name": "대용량찌개", "ing": ["김치", "두부", "대파"], "pop": 1, "inbun": "6인분이상"},
    ])
    names = [r["name"] for r in recipe_match.match(["김치", "두부", "대파"], portion="한 끼")]
    assert names == ["대용량찌개"], names


def test_matched_recipe_reports_its_portion():
    """원본에 적힌 인분을 그대로 내려보낸다. 화면이 "4인분 기준이에요"를 띄우는 근거다 —
    말해주지 않으면 한 끼를 고른 사람이 4인분 양을 그대로 만든다."""
    _fake_index([
        {"id": 7, "name": "김치찌개", "ing": ["김치", "두부", "대파"], "pop": 1, "inbun": "4인분"},
    ])
    out = recipe_match.match(["김치", "두부", "대파"])
    assert out[0]["portion"] == "4인분", out[0]


def test_matched_recipe_carries_amounts():
    """수량을 화면까지 실어 보낸다. 이름만 주던 동안에는 "4인분 기준"이라고 말해줘도
    얼마를 넣어야 할지 알 수 없었고, 장보기 합산도 수량을 몰라 할 수 없었다.

    모양은 AI가 만든 레시피와 같게 둔다 — 화면(splitIngredient)과 장보기(parse_line)가
    이미 그 모양을 읽으므로 받는 쪽은 고칠 게 없다."""
    _fake_index([
        {"id": 1, "name": "김치찌개", "pop": 1,
         "ing": [("돼지고기", "250g"), ("김치", "1/4포기"), ("소금", "")]},
    ])
    out = recipe_match.match(["돼지고기", "김치", "소금"])
    assert out[0]["ingredients"] == ["돼지고기 250g", "김치 1/4포기", "소금"], out[0]

    # 수량은 매칭에 끼어들지 않는다 — 이름만 본다.
    assert out[0]["coverage"] == 1.0, out[0]


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
