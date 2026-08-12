"""
/api 진입점 — 요청을 받아 기능 모듈로 넘긴다.

Vercel의 Python 런타임은 프로젝트당 하나의 진입점을 기본 위치(api/index.py 등)에서 찾는다.
파일마다 별도 함수로 두면 "No python entrypoint found in default locations"로 빌드가 거부되므로,
여기서 HTTP를 한 번만 처리하고 경로에 따라 recommend / mealplan 으로 넘긴다.

기능별 모듈은 그대로 분리돼 있고 각자 handle(payload) -> (status, body) 만 제공한다.
덕분에 응답 전송과 예외 매핑이 한 곳에만 존재한다 (이전에는 두 파일에 중복돼 있었다).

  GET  /api            헬스체크
  POST /api/recommend  재료 기반 요리 추천
  POST /api/mealplan   며칠치 저녁 식단 계획
"""

import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# 같은 폴더의 기능 모듈을 이름으로 import 할 수 있게 한다.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mealplan  # noqa: E402
import recommend  # noqa: E402

ROUTES = {
    "recommend": recommend.handle,
    "mealplan": mealplan.handle,
    # 사용자가 식단을 고친 뒤 장보기 목록만 다시 뽑는다. 계획은 새로 만들지 않는다.
    "shopping": mealplan.handle_shopping,
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._send(200, {"ok": True, "service": "fridge-chef"})

    def do_POST(self):
        run = ROUTES.get(self._route())
        if not run:
            self._send(404, {"error": "not_found", "message": "요청한 기능을 찾을 수 없어요."})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw_body or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send(400, {"error": "invalid_request", "message": "요청 형식이 올바르지 않아요."})
            return

        if not isinstance(payload, dict):
            self._send(400, {"error": "invalid_request", "message": "요청 형식이 올바르지 않아요."})
            return

        # 여기서 막지 않으면 예외가 그대로 올라가 응답 자체를 못 보낸다.
        # 프론트는 그걸 네트워크 장애로 읽어서 "연결을 확인하세요"라는 엉뚱한 안내를 띄운다.
        try:
            status, body = run(payload)
        except Exception:
            traceback.print_exc()  # Vercel 런타임 로그(vercel logs)에 남는다
            status, body = 500, {"error": "internal_error", "message": "처리 중 문제가 생겼어요. 잠시 후 다시 시도해주세요."}

        self._send(status, body)

    def _route(self):
        """어떤 기능을 부르는지 알아낸다.

        vercel.json이 /api/recommend 를 /api/index.py?route=recommend 로 넘긴다.
        """
        return parse_qs(urlparse(self.path).query).get("route", [""])[0].strip()

    def _send(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
