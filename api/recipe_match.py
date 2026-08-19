"""실제 레시피 매칭 — AI를 부르기 전에 먼저 시도한다.

스펙: docs/spec-recipe-match.md

라이선스(CC BY-NC-ND) 경계가 이 파일의 설계를 정한다. 여기서 다루는 것은 재료명·시간·인분
같은 **사실 데이터**와 원본 링크를 만들 id뿐이다. 조리 소개글·조리 순서 원문은 인덱스에
애초에 들어 있지 않으므로(scripts/build_recipe_index.py에서 버린다) 여기서 새어 나갈 수 없다.
매칭된 레시피의 steps는 항상 빈 배열이고, 상세는 만개의레시피 링크로만 안내한다.
"""

import collections
import json
import os

from shopping import find_owned, normalize_name

INDEX_PATH = os.path.join(os.path.dirname(__file__), "recipes_index.json")

RECIPE_URL = "https://www.10000recipe.com/recipe/{}"

# 커버율 기준. 레시피 재료 중 사용자가 가진 것의 비율이 이 값을 넘어야 후보로 본다.
MIN_COVERAGE = 0.7

# 커버율만 보면 재료 2개짜리 레시피가 늘 이긴다("양파 1개, 소금" = 100%). 그런 건 요리라기보다
# 손질법에 가까워서 추천으로는 쓸모가 없다. 최소한의 재료 수를 요구한다.
MIN_INGREDIENTS = 3

_index = None
_inverted = None


def load_index():
    """한 번만 읽고 프로세스에 들고 있는다. 서버리스는 콜드 스타트에서만 이 비용을 낸다.

    같이 만드는 역색인(재료명 -> 레시피 번호)이 매칭 속도를 정한다. 이게 없으면 요청마다
    레시피 233,283건을 전부 돌며 find_owned를 217만 번 부른다(재료 7개에 약 1.9초).
    그런데 그 비교의 대상인 고유 재료명은 111,854종뿐이라, 같은 이름을 평균 19번씩 다시
    비교하고 있었다. 이름 기준으로 한 번만 판정하고 후보만 만지면 356ms가 된다.

    파일이 없으면(로컬에서 파이프라인을 안 돌렸거나 배포에 안 실렸으면) 빈 목록이 되고,
    부르는 쪽은 지금까지 하던 대로 AI 생성으로 간다 — 매칭은 어디까지나 앞단이다.
    """
    global _index, _inverted
    if _index is None:
        if os.path.exists(INDEX_PATH):
            with open(INDEX_PATH, encoding="utf-8") as fh:
                _index = json.load(fh)
        else:
            _index = []
        _inverted = collections.defaultdict(list)
        for i, recipe in enumerate(_index):
            for name in set(recipe.get("ing") or ()):
                _inverted[name].append(i)
    return _index, _inverted


def score(hit, total):
    """커버율만으로 줄을 세우면 재료가 적을수록 유리하다 — 분모가 작으니 당연하다.
    그래서 "몇 %를 채웠나"에 "실제로 몇 개나 맞았나"를 곱한다.

        점수 = (hit / total) * hit

    재료 3개를 다 맞춘 레시피는 (3/3)*3 = 3점, 재료 8개 중 7개를 맞춘 레시피는
    (7/8)*7 = 6.1점이다. 커버율은 후자가 낮지만 냉장고를 더 많이 쓴다 —
    "있는 재료를 최대한 활용한다"는 이 서비스의 목적과 같은 방향이다."""
    return (hit / total) * hit if total else 0.0


def match(pantry_keys, limit=3):
    """냉장고 재료로 만들 수 있는 실제 레시피를 찾는다. 없으면 빈 배열."""
    if not pantry_keys:
        return []

    index, inverted = load_index()

    # 재료명 사전을 냉장고와 한 번만 대조한다. find_owned는 양방향 부분 문자열이라
    # 어떤 색인도 못 타므로(그래서 SQLite도 답이 아니었다) 이 한 번은 어차피 남는다.
    hits = collections.Counter()
    for name, recipe_ids in inverted.items():
        if find_owned(name, pantry_keys):
            for i in recipe_ids:
                hits[i] += 1

    scored = []
    for i, hit in hits.items():
        recipe = index[i]
        total = len(recipe.get("ing") or ())
        if total < MIN_INGREDIENTS:
            continue
        rate = hit / total
        if rate >= MIN_COVERAGE:
            scored.append((score(hit, total), recipe.get("pop", 0), rate, recipe))

    # 점수가 먼저, 같으면 인기도(추천수+스크랩수)로 가른다.
    scored.sort(key=lambda x: (-x[0], -x[1]))

    # 같은 이름이 여러 장 뜨지 않게 거른다. 인덱스에는 RCP_SNO가 다른 별개 레시피로 남아
    # 있는 게 맞고("만능간장"이라는 이름의 서로 다른 레시피가 실제로 여럿 있다), 화면에
    # 같은 이름 카드가 세 장 뜨는 것만 막으면 된다. 판정은 추천 이력·즐겨찾기가 쓰는
    # dedupe_key와 같은 규칙이다 — "김치볶음밥"과 "김치 볶음밥"은 같은 요리다.
    # recommend가 이 모듈을 import하므로 위에서 되받으면 순환이 된다(recommend는 아직
    # dedupe_key를 정의하기 전이다). 쓰는 자리에서 늦게 가져온다 — 규칙은 여전히 한 곳이다.
    from recommend import dedupe_key

    out, seen = [], set()
    for _, _, rate, recipe in scored:
        key = dedupe_key(recipe.get("name", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(to_response(recipe, rate))
        if len(out) >= limit:
            break
    return out


def to_response(recipe, rate):
    """프론트가 받을 모양. steps가 빈 배열인 것이 이 응답의 핵심이다 — 원문을 재구성하지 않는다."""
    return {
        "name": recipe.get("name", ""),
        "source": "matched",
        "recipeUrl": RECIPE_URL.format(recipe.get("id")),
        "time": recipe.get("time", ""),
        "portion": recipe.get("inbun", ""),
        "ingredients": list(recipe.get("ing") or []),
        "steps": [],
        # 검색 링크 폴백용 — 원본이 삭제됐을 때 프론트가 쓸 수 있다.
        "searchKeyword": recipe.get("name", ""),
        "coverage": round(rate, 3),
    }


def pantry_keys_from(ingredients_str):
    """사용자 입력 문자열을 비교용 이름 목록으로. recommend.py의 _pantry_keys와 같은 규칙."""
    from shopping import parse_line

    keys = []
    for raw in (ingredients_str or "").split(","):
        raw = raw.strip()
        if not raw:
            continue
        name, _, _ = parse_line(raw)
        name = normalize_name(name)
        if name:
            keys.append(name)
    return keys
