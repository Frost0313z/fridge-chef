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


def test_exclude_prompt():
    """재추천일 때만 제외 목록이 프롬프트에 들어간다."""
    without = recommend.build_user_prompt("계란", "한 끼", "상관없음", False)
    assert "빼고" not in without, without

    with_exclude = recommend.build_user_prompt("계란", "한 끼", "상관없음", False, ["계란말이", "계란찜"])
    assert "계란말이, 계란찜" in with_exclude, with_exclude


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
        assert body["shoppingList"] == [
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
        assert body["shoppingList"] == [
            {"name": "돼지고기", "amount": "150g"},
            {"name": "계란", "amount": "2개"},
        ], body
    finally:
        mealplan.call_openai = original


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


def test_shopping_sums_across_meals():
    """AI가 못 하던 일 — 여러 끼니에 흩어진 같은 재료를 더한다."""
    plan = [
        {"ingredients": ["계란 2개", "대파 1/2대"]},
        {"ingredients": ["계란 3개"]},
        {"ingredients": ["계란 1알", "대파 1/2대"]},
    ]
    assert shopping.build_shopping_list(plan, []) == [
        {"name": "계란", "amount": "6개"},
        {"name": "대파", "amount": "1대"},
    ]


def test_shopping_subtracts_pantry():
    """냉장고에 있는 만큼만 뺀다. "조금이라도 있으면 넘어가는" 것이 원래의 버그였다."""
    plan = [{"ingredients": ["계란 6개", "우유 300ml"]}, {"ingredients": ["계란 4개"]}]
    assert shopping.build_shopping_list(plan, ["계란 4개", "우유 1l"]) == [
        {"name": "계란", "amount": "6개"},  # 10개 필요, 4개 보유
    ]  # 우유는 1리터가 있어 300ml는 덮인다


def test_shopping_without_pantry_quantity():
    """냉장고에 수량이 안 적혀 있으면 뺄 근거가 없다. 필요한 만큼을 그대로 올린다 —
    이미 있는 걸 또 사는 쪽이, 필요한 걸 안 사서 못 만드는 쪽보다 낫다."""
    plan = [{"ingredients": ["계란 6개"]}]
    assert shopping.build_shopping_list(plan, ["계란"]) == [{"name": "계란", "amount": "6개"}]


def test_shopping_without_plan_quantity():
    """수량 없이 저장된 옛 계획. 얼마나 부족한지 계산할 수 없으므로 냉장고에 있으면 두고,
    없으면 이름만 올린다. 여기서 수량을 지어내면 틀린 숫자를 믿게 만든다."""
    plan = [{"ingredients": ["두부", "애호박"]}]
    assert shopping.build_shopping_list(plan, ["두부 1모"]) == [{"name": "애호박", "amount": ""}]


def test_shopping_rounds_up():
    """0.5모가 필요해도 반 모는 못 산다. 살 수 있는 단위로 올린다."""
    plan = [{"ingredients": ["두부 1/4모"]}, {"ingredients": ["두부 1/4모"]}]
    assert shopping.build_shopping_list(plan, []) == [{"name": "두부", "amount": "1모"}]


def test_shopping_excludes_staples():
    """소금·밥처럼 사러 갈 일이 없는 것은 재료로 적혀 있어도 목록에서 뺀다."""
    plan = [{"ingredients": ["소금 1작은술", "밥 1공기", "고춧가루 1큰술", "계란 1개"]}]
    assert shopping.build_shopping_list(plan, []) == [{"name": "계란", "amount": "1개"}]


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


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  ok  {name}")
    print("all passed")
