"""
POST /api/mealplan
재료함(보유 재료)을 최대한 활용해 여러 날짜의 저녁 식단을 계획하는 Vercel Serverless Function.

요청 바디: {"days": int, "portion": str, "healthy": bool, "pantry": [str]}
응답(200): {"plan": [{"day": str, "menu": str, "searchKeyword": str, "ingredients": [str]}]}
응답(4xx/5xx): {"error": str, "message": str}
"""

from http.server import BaseHTTPRequestHandler
import json
import os

from openai import OpenAI, APITimeoutError, APIStatusError, APIConnectionError

SYSTEM_PROMPT = """당신은 자취생을 위한 일주일 저녁 식단을 계획해주는 도우미입니다.
사용자가 이미 냉장고에 가진 재료를 최대한 활용해서, 날짜별로 서로 다른 요리를 계획하세요.
가진 재료만으로 부족하면 새로 사야 할 재료를 자유롭게 추가해도 됩니다 (장보기 리스트를 만드는 것이 목적입니다).
같은 요리가 계획 기간 내에 반복되지 않게 다양하게 구성하세요.

사용자는 혼자 사는 자취생입니다. 이건 선택 사항이 아니라 항상 참인 전제입니다.
설거지가 적고 조리 과정이 간단한 요리를 우선하고, 특수한 조리도구가 필요한 요리는 피하세요.

searchKeyword는 레시피 사이트에서 검색할 때 쓰는 값입니다. 수식어를 빼고 널리 쓰이는 짧은 요리 이름만
적으세요 (예: menu가 "냉장고털이 두부 계란 덮밥"이면 searchKeyword는 "두부덮밥"). 검색어가 길면
엉뚱한 결과가 나오므로 되도록 두 단어를 넘기지 마세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 문장을 추가하지 마세요.
{
  "plan": [
    {"day": "1일차", "menu": "요리 이름", "searchKeyword": "검색용 짧은 요리 이름", "ingredients": ["재료1", "재료2"]}
  ]
}"""

# 타겟이 1인 가구 자취생으로 고정돼 있어 "가족 식사"는 모순이고 "자취생 간단요리"는
# 선택지가 아니라 기본값이다(SYSTEM_PROMPT로 승격). 세대 구성과 무관한 축 하나만 남긴다.
HEALTHY_HINT = "건강 관리를 신경 쓰는 중이야. 기름지거나 자극적인 조리법은 피하고 칼로리가 낮은 쪽으로 계획해줘."


MAX_DAYS = 7


def to_str_list(value):
    """AI가 배열 대신 문자열/숫자를 줘도 프론트의 .map()이 터지지 않도록 문자열 배열로 강제한다."""
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()]


def sanitize_plan(raw):
    """response_format으로 JSON은 보장되지만 '스키마'까지 보장되지는 않는다.
    메뉴 없는 항목은 버리고, 나머지 필드는 프론트가 기대하는 타입으로 맞춰서 내보낸다."""
    if not isinstance(raw, list):
        return []

    plan = []
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            continue
        menu = str(item.get("menu") or "").strip()
        if not menu:
            continue
        plan.append(
            {
                "day": str(item.get("day") or f"{index}일차").strip(),
                "menu": menu,
                # 비면 프론트가 menu로 대체한다. 옛 저장 데이터에도 이 필드가 없다.
                "searchKeyword": str(item.get("searchKeyword") or "").strip(),
                "ingredients": to_str_list(item.get("ingredients")),
            }
        )
    return plan[:MAX_DAYS]


def build_user_prompt(days, portion, healthy, pantry):
    lines = [
        f"계획할 일수: {days}일치 저녁",
        # 혼자 먹는다는 전제이므로 "몇 인분"이 아니라 "한 끼당 몇 끼 분량"으로 전달한다.
        f"한 끼당 만들 분량: 혼자 먹을 {portion} 분량 (남으면 다음 끼니에 먹음)",
    ]
    if pantry:
        lines.append(f"이미 냉장고에 있는 재료: {', '.join(pantry)}")
    if healthy:
        lines.append(HEALTHY_HINT)
    lines.append("위 조건에 맞는 저녁 식단을 계획해줘.")
    return "\n".join(lines)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw_body or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "invalid_request", "message": "요청 형식이 올바르지 않아요."})
            return

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
        pantry = [str(p).strip() for p in pantry if str(p).strip()][:30]

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            self._send_json(500, {"error": "server_misconfigured", "message": "서버에 API 키가 설정되어 있지 않아요."})
            return

        client = OpenAI(api_key=api_key, timeout=20.0)

        try:
            completion = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": build_user_prompt(days, portion, healthy, pantry)},
                ],
                response_format={"type": "json_object"},
                temperature=0.8,
            )
            data = json.loads(completion.choices[0].message.content)
        except APITimeoutError:
            self._send_json(504, {"error": "timeout", "message": "AI 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요."})
            return
        except APIConnectionError:
            self._send_json(502, {"error": "connection_error", "message": "AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요."})
            return
        except APIStatusError:
            self._send_json(502, {"error": "upstream_error", "message": "AI 서비스에 일시적인 문제가 발생했어요. 잠시 후 다시 시도해주세요."})
            return
        except (ValueError, json.JSONDecodeError, KeyError, IndexError):
            self._send_json(502, {"error": "bad_ai_response", "message": "AI 응답을 해석하지 못했어요. 다시 시도해주세요."})
            return

        raw_plan = data.get("plan") if isinstance(data, dict) else None
        self._send_json(200, {"plan": sanitize_plan(raw_plan)})

    def _send_json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
