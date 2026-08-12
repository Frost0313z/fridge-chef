"""
두 AI 엔드포인트가 공유하는 OpenAI 호출과 오류 매핑.

이전에는 recommend.py와 mealplan.py가 각자 OpenAI를 호출하고 예외를 HTTP 상태로
매핑하는 코드를 똑같이 갖고 있었다. Vercel 진입점 구조를 바꾸면서 함께 합쳤다.
"""

import json
import os

from openai import OpenAI, APITimeoutError, APIStatusError, APIConnectionError

MODEL = "gpt-4o-mini"


def to_str_list(value):
    """AI가 배열 대신 문자열/숫자를 줘도 프론트의 .map()이 터지지 않도록 문자열 배열로 강제한다."""
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()]


def call_openai(system_prompt, user_prompt, timeout, temperature):
    """(data, error) 를 돌려준다. error는 (status, body) 이거나 None.

    사용자에게 보여줄 문구를 여기서 정한다 — 프론트는 message를 그대로 띄우기만 하면 된다.
    OpenAI 쪽 사정(어떤 예외인지)은 감추고, 사용자가 취할 행동만 원인별로 다르게 안내한다.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None, (500, {"error": "server_misconfigured", "message": "서버에 API 키가 설정되어 있지 않아요."})

    client = OpenAI(api_key=api_key, timeout=timeout)

    try:
        completion = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=temperature,
        )
        return json.loads(completion.choices[0].message.content), None
    except APITimeoutError:
        return None, (504, {"error": "timeout", "message": "AI 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요."})
    except APIConnectionError:
        return None, (502, {"error": "connection_error", "message": "AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요."})
    except APIStatusError:
        return None, (502, {"error": "upstream_error", "message": "AI 서비스에 일시적인 문제가 발생했어요. 잠시 후 다시 시도해주세요."})
    # TypeError는 AI가 거부 응답을 줘서 content가 None일 때 json.loads가 던진다.
    # 잡지 않으면 예외가 그대로 올라가 응답을 못 보내고, 프론트가 네트워크 오류로 오해한다.
    except (ValueError, TypeError, AttributeError, KeyError, IndexError):
        return None, (502, {"error": "bad_ai_response", "message": "AI 응답을 해석하지 못했어요. 다시 시도해주세요."})
