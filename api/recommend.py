"""
POST /api/recommend
입력한 재료로 AI가 만들 수 있는 요리를 추천하는 Vercel Serverless Function.

요청 바디: {"ingredients": str, "headcount": str, "timeLimit": str, "situation": str}
응답(200): {"recipes": [{"name": str, "searchKeyword": str, "time": str, "ingredients": [str], "steps": [str]}]}
응답(4xx/5xx): {"error": str, "message": str}  # message는 화면에 그대로 표시할 한국어 안내문
"""

from http.server import BaseHTTPRequestHandler
import json
import os

from openai import OpenAI, APITimeoutError, APIStatusError, APIConnectionError

SYSTEM_PROMPT = """당신은 냉장고에 있는 재료로 만들 수 있는 한식/양식/중식 요리를 추천하는 요리 도우미입니다.
사용자가 알려준 재료를 최대한 활용하는 요리 1~3개를 추천하세요.
소금, 후추, 식용유, 물처럼 대부분의 가정에 있는 기본 조미료는 목록에 없어도 사용할 수 있다고 가정합니다.
사용자가 알려주지 않은 값비싸거나 특수한 재료를 임의로 추가하지 마세요.

searchKeyword는 레시피 사이트에서 검색할 때 쓰는 값입니다. 수식어를 빼고 널리 쓰이는 짧은 요리 이름만
적으세요 (예: name이 "냉장고털이 두부 계란 덮밥"이면 searchKeyword는 "두부덮밥"). 검색어가 길면
엉뚱한 결과가 나오므로 되도록 두 단어를 넘기지 마세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 문장을 추가하지 마세요.
{
  "recipes": [
    {
      "name": "요리 이름",
      "searchKeyword": "검색용 짧은 요리 이름",
      "time": "예상 조리 시간 (예: 15분)",
      "ingredients": ["재료1", "재료2"],
      "steps": ["조리 순서 1", "조리 순서 2"]
    }
  ]
}"""


SITUATION_HINTS = {
    "자취생 간단요리": "혼자 사는 자취생 상황이야. 설거지가 적고 조리가 간단한 요리 위주로 추천해줘.",
    "가족 식사": "여러 식구가 함께 먹을 가족 식사 상황이야. 자극적이지 않고 다양한 연령대가 무난하게 먹을 수 있는 요리로 추천해줘.",
    "다이어트/건강식": "다이어트나 건강 관리를 하는 상황이야. 기름지거나 자극적인 조리법은 피하고 칼로리가 낮은 요리로 추천해줘.",
}


MAX_RECIPES = 3


def to_str_list(value):
    """AI가 배열 대신 문자열/숫자를 줘도 프론트의 .map()이 터지지 않도록 문자열 배열로 강제한다."""
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()]


def sanitize_recipes(raw):
    """response_format으로 JSON은 보장되지만 '스키마'까지 보장되지는 않는다.
    이름 없는 항목은 버리고, 나머지 필드는 프론트가 기대하는 타입으로 맞춰서 내보낸다."""
    if not isinstance(raw, list):
        return []

    recipes = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        recipes.append(
            {
                "name": name,
                # 비면 프론트가 name으로 대체한다. 옛 이력 데이터에도 이 필드가 없다.
                "searchKeyword": str(item.get("searchKeyword") or "").strip(),
                "time": str(item.get("time") or "").strip(),
                "ingredients": to_str_list(item.get("ingredients")),
                "steps": to_str_list(item.get("steps")),
            }
        )
    return recipes[:MAX_RECIPES]


def build_user_prompt(ingredients, headcount, time_limit, situation):
    lines = [
        f"보유 재료: {ingredients}",
        f"인원수: {headcount}",
        f"희망 조리 시간: {time_limit}",
    ]
    hint = SITUATION_HINTS.get(situation)
    if hint:
        lines.append(f"상황: {hint}")
    lines.append("위 조건에 맞는 요리를 추천해줘.")
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

        ingredients = (payload.get("ingredients") or "").strip()
        if not ingredients:
            self._send_json(400, {"error": "empty_input", "message": "재료를 1개 이상 입력해주세요."})
            return

        headcount = (payload.get("headcount") or "1인분").strip()
        time_limit = (payload.get("timeLimit") or "상관없음").strip()
        situation = (payload.get("situation") or "기본").strip()

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            self._send_json(500, {"error": "server_misconfigured", "message": "서버에 API 키가 설정되어 있지 않아요."})
            return

        client = OpenAI(api_key=api_key, timeout=15.0)

        try:
            completion = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": build_user_prompt(ingredients, headcount, time_limit, situation)},
                ],
                response_format={"type": "json_object"},
                temperature=0.7,
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

        raw_recipes = data.get("recipes") if isinstance(data, dict) else None
        self._send_json(200, {"recipes": sanitize_recipes(raw_recipes)})

    def _send_json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
