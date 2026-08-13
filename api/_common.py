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
        # 사용자에게 "API 키"를 말하면 자기가 뭘 잘못했나 찾게 된다. 원인이 우리 쪽이라는
        # 사실만 알리고, 무엇을 하면 되는지로 끝낸다. 개발자는 error 코드로 구분하면 된다.
        # 이 함수는 추천·식단·장보기가 함께 쓰므로 특정 화면 이름을 넣지 않는다.
        return None, (500, {"error": "server_misconfigured", "message": "지금은 AI가 답을 만들지 못해요. 사용자 잘못이 아니라 저희 쪽 문제예요. 조금 뒤에 다시 시도해주세요."})

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
        # "해석"은 개발자 말이다. 사용자가 알아야 할 것은 "AI가 답을 제대로 못 만들었고,
        # 한 번 더 하면 대개 된다"는 것뿐이다 — 실제로 이 오류는 재시도로 거의 풀린다.
        return None, (502, {"error": "bad_ai_response", "message": "AI가 답을 제대로 만들지 못했어요. 한 번 더 시도하면 대개 잘 나와요."})
