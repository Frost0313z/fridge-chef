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


def test_shopping_list_filter():
    """사러 갈 일이 없는 항목은 AI가 넣어도 서버가 뺀다."""
    out = mealplan.sanitize_shopping_list(
        [{"name": "밥"}, {"name": "소 금"}, {"name": "계란", "amount": "6개"}, {"name": ""}]
    )
    assert out == [{"name": "계란", "amount": "6개"}], out


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
