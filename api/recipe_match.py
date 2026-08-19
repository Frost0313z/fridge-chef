"""실제 레시피 매칭 — AI를 부르기 전에 먼저 시도한다.

스펙: docs/spec-recipe-match.md

라이선스(CC BY-NC-ND) 경계가 이 파일의 설계를 정한다. 여기서 다루는 것은 재료명·시간·인분
같은 **사실 데이터**와 원본 링크를 만들 id뿐이다. 조리 소개글·조리 순서 원문은 인덱스에
애초에 들어 있지 않으므로(scripts/build_recipe_index.py에서 버린다) 여기서 새어 나갈 수 없다.
매칭된 레시피의 steps는 항상 빈 배열이고, 상세는 만개의레시피 링크로만 안내한다.
"""

import json
import os

from shopping import find_owned, normalize_name

INDEX_PATH = os.path.join(os.path.dirname(__file__), "recipes_index.json")

RECIPE_URL = "https://www.10000recipe.com/recipe/{}"

# 커버율 기준. 레시피 재료 중 사용자가 가진 것의 비율이 이 값을 넘어야 후보로 본다.
# 스펙에서 70%로 가정했고, 실제 조합으로 재본 뒤 조정한다.
MIN_COVERAGE = 0.7

# 커버율만 보면 재료 2개짜리 레시피가 늘 이긴다("양파 1개, 소금" = 100%). 그런 건 요리라기보다
# 손질법에 가까워서 추천으로는 쓸모가 없다. 최소한의 재료 수를 요구한다.
MIN_INGREDIENTS = 3

_index = None


def load_index():
    """한 번만 읽고 프로세스에 들고 있는다. 서버리스는 콜드 스타트에서만 이 비용을 낸다.

    파일이 없으면(로컬에서 파이프라인을 안 돌렸거나 배포에 안 실렸으면) None을 돌려주고,
    부르는 쪽은 지금까지 하던 대로 AI 생성으로 간다 — 매칭은 어디까지나 앞단이다.
    """
    global _index
    if _index is None:
        if not os.path.exists(INDEX_PATH):
            _index = []
        else:
            with open(INDEX_PATH, encoding="utf-8") as fh:
                _index = json.load(fh)
    return _index


def coverage(recipe_ings, owned_keys):
    """레시피 재료 중 사용자가 가진 것의 비율.

    "같은 재료인가" 판정은 shopping.find_owned를 그대로 쓴다 — 장보기·재료 검증(D-0r)과
    같은 함수다. 규칙을 세 번째로 갈라 쓰면 한 화면은 있다 하고 다른 화면은 없다 한다.
    """
    if not recipe_ings:
        return 0.0
    hit = sum(1 for ing in recipe_ings if find_owned(ing, owned_keys))
    return hit / len(recipe_ings)


def match(pantry_keys, limit=3):
    """냉장고 재료로 만들 수 있는 실제 레시피를 찾는다. 없으면 빈 배열."""
    if not pantry_keys:
        return []

    index = load_index()
    scored = []
    for recipe in index:
        ings = recipe.get("ing") or []
        if len(ings) < MIN_INGREDIENTS:
            continue
        rate = coverage(ings, pantry_keys)
        if rate >= MIN_COVERAGE:
            scored.append((rate, recipe.get("pop", 0), recipe))

    # 커버율이 먼저, 같으면 인기도(추천수+스크랩수)로 가른다.
    scored.sort(key=lambda x: (-x[0], -x[1]))

    return [to_response(r, rate) for rate, _, r in scored[:limit]]


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
