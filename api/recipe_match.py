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
import sys

from shopping import find_owned

INDEX_PATH = os.path.join(os.path.dirname(__file__), "recipes_index.json")

# scripts/build_recipe_index.py의 FORMAT_VERSION과 같아야 한다. 인덱스는 .gitignore라
# 코드와 따로 움직이므로, 어긋난 파일을 그냥 읽으면 TypeError로 매 요청 500이 된다.
INDEX_FORMAT = 3

# 빈 인덱스. 파일이 없거나 못 읽거나 버전이 안 맞으면 이걸 쓰고 AI 생성으로 넘어간다.
EMPTY_INDEX = {"v": INDEX_FORMAT, "n": [], "p": [], "t": [], "b": [], "c": [], "a": [], "r": []}

RECIPE_URL = "https://www.10000recipe.com/recipe/{}"

# 화면의 "만들 분량"은 혼자 먹는 끼니 수이고, 데이터의 인분은 몇 명 몫인가다.
# 혼자 두 끼 먹을 양이면 2인분 한 번이 대체로 맞다 — 그 대응을 여기 적는다.
#
# 거르지 않고 "먼저 올리기"만 하는 이유는 코퍼스가 그렇게 생겼기 때문이다. 1인분은
# 전체의 15.4%뿐이라 걸러내면 85%를 버리고, 매칭이 자주 실패해 오히려 덜 믿을 만한
# AI 생성으로 넘어간다. 게다가 인분은 올린 사람이 스스로 적은 값이라 같은 김치찌개가
# 1인분으로도 4인분으로도 올라와 있다 — 요리 자체는 인분에 따라 바뀌지 않는다.
# 실측: 우선순위만 줘도 1~2인분 카드가 42% -> 75%가 되고 커버리지 손실은 없었다.
PORTION_PREFERENCE = {
    "한 끼": ("1인분", "2인분"),
    "두 끼": ("2인분", "3인분"),
    "3~4끼": ("3인분", "4인분", "5인분", "6인분이상"),
}


# 커버율 기준. 레시피 재료 중 사용자가 가진 것의 비율이 이 값을 넘어야 후보로 본다.
MIN_COVERAGE = 0.7

# 커버율만 보면 재료 2개짜리 레시피가 늘 이긴다("양파 1개, 소금" = 100%). 그런 건 요리라기보다
# 손질법에 가까워서 추천으로는 쓸모가 없다. 최소한의 재료 수를 요구한다.
MIN_INGREDIENTS = 3

_index = None
_inverted = None


def load_index():
    """한 번만 읽고 프로세스에 들고 있는다. 서버리스는 콜드 스타트에서만 이 비용을 낸다.

    역색인(재료명 -> 레시피 번호)이 매칭 속도를 정한다. 이게 없으면 요청마다 레시피
    233,283건을 전부 돌며 find_owned를 217만 번 부른다(재료 7개에 약 1.9초). 고유
    재료명은 6만여 종뿐이라 같은 이름을 평균 35번씩 다시 비교하는 셈이었다.

    그 역색인을 여기서 만들지 않고 **파일에서 그대로 받는다.** 결정적인 값이라 서버가
    뜰 때마다 다시 만들 이유가 없는데, 그 루프가 콜드 스타트의 절반을 먹고 있었다
    (709ms/1452ms). scripts/build_recipe_index.py의 pack()이 만들어 넣는다.

    파일이 없으면(로컬에서 파이프라인을 안 돌렸거나 배포에 안 실렸으면) 빈 목록이 되고,
    부르는 쪽은 지금까지 하던 대로 AI 생성으로 간다 — 매칭은 어디까지나 앞단이다.
    이 폴백 자체는 의도한 동작이라 그대로 두지만, 소리 없이 일어나면 "매칭이 왜 한 번도
    안 걸리지?"를 직접 두드려보기 전까지 아무도 모른다(실제로 배포 한 번이 이렇게 새고
    한동안 안 잡혔다). 그래서 로그 한 줄은 남긴다 — vercel logs에서 바로 보인다.
    """
    global _index, _inverted
    if _index is None:
        _index = _read_index()
        _inverted = _index["p"]
    return _index, _inverted


def _read_index():
    """인덱스를 읽는다. 못 읽으면 빈 목록 — 부르는 쪽은 AI 생성으로 넘어간다.

    파일이 "없을" 때만 막고 "깨졌을" 때를 안 막으면 방향이 거꾸로가 된다. 46MB짜리를
    로컬에서 만들어 Vercel CLI가 통째로 올리는 구조라 잘린 파일이 실제로 생길 수 있는데,
    그러면 json.load가 던지고 매 요청이 500이 된다 — 사용자에게는 "잠시 후 다시
    시도해주세요"가 나가지만 스스로 낫지 않는 상태다. 파일이 없을 때처럼 폴백시키고
    로그로만 알린다. 서비스가 조금 나빠지는 것과 통째로 멈추는 것은 다르다.
    """
    if not os.path.exists(INDEX_PATH):
        print(f"recipes_index.json not found at {INDEX_PATH} — falling back to AI-only", file=sys.stderr)
        return EMPTY_INDEX
    try:
        with open(INDEX_PATH, encoding="utf-8") as fh:
            blob = json.load(fh)
    except (ValueError, OSError) as error:
        print(f"recipes_index.json unreadable ({error}) — falling back to AI-only", file=sys.stderr)
        return EMPTY_INDEX

    # 버전이 다르면 읽지 않는다. 인덱스는 .gitignore라 코드와 따로 움직여서, 코드만
    # 되돌리거나 인덱스만 옛것이 남는 일이 실제로 생긴다. 그냥 읽으면 TypeError가 나며
    # 매 요청 500이 되고 스스로 낫지 않는다 — 깨진 파일과 똑같이 취급하는 편이 낫다.
    if not isinstance(blob, dict) or blob.get("v") != INDEX_FORMAT:
        found = blob.get("v") if isinstance(blob, dict) else "old-array"
        print(
            f"recipes_index.json format mismatch (want v{INDEX_FORMAT}, found {found}) "
            "— rebuild with scripts/build_recipe_index.py; falling back to AI-only",
            file=sys.stderr,
        )
        return EMPTY_INDEX
    return blob


def vocab_with_min_occurrence(min_count):
    """등장 횟수가 min_count 이상인 재료명만 돌려준다.

    234,538개 레시피 원문에 사람들이 자유롭게 적어 넣은 재료명이라 "도리토스"처럼 우연히
    한두 번만 등장하는 비재료도 섞여 있다. pantry_import.py가 사진에서 뽑은 품목명을 이
    어휘와 대조할 때, 어휘에 있다는 사실만으로는 "진짜 자주 쓰이는 재료"를 보장 못 한다
    — docs/spec-pantry-photo-import.md 핵심 원칙 3.
    """
    index, postings = load_index()
    names = index["n"]
    return [names[nid] for nid, ids in enumerate(postings) if len(ids) >= min_count]


def score(hit, total):
    """커버율만으로 줄을 세우면 재료가 적을수록 유리하다 — 분모가 작으니 당연하다.
    그래서 "몇 %를 채웠나"에 "실제로 몇 개나 맞았나"를 곱한다.

        점수 = (hit / total) * hit

    재료 3개를 다 맞춘 레시피는 (3/3)*3 = 3점, 재료 8개 중 7개를 맞춘 레시피는
    (7/8)*7 = 6.1점이다. 커버율은 후자가 낮지만 냉장고를 더 많이 쓴다 —
    "있는 재료를 최대한 활용한다"는 이 서비스의 목적과 같은 방향이다."""
    return (hit / total) * hit if total else 0.0


def match(pantry_keys, limit=3, category=None, portion=None):
    """냉장고 재료로 만들 수 있는 실제 레시피를 찾는다. 없으면 빈 배열.

    category가 주어지면(값이 있고 "상관없음"이 아니면) CKG_KND_ACTO_NM(cat)이 정확히
    같은 레시피만 후보로 남긴다. 큐레이션한 13개 밖의 원본 값(기타·과자 등)은 UI에
    선택지로 없으므로 여기로 들어올 일이 없다 — 걸러도 정확히 일치해야 하므로 별도
    화이트리스트 검증은 하지 않는다.

    portion이 주어지면 그 끼니 수에 어울리는 인분을 **먼저 올린다**(거르지는 않는다).
    이게 없으면 "한 끼"를 고른 사람에게 6인분짜리가 그대로 나가고, 화면은 그걸
    말해주지도 않는다 — 선택이 조용히 무시되는 셈이다(healthy를 뺀 것과 같은 이유)."""
    if not pantry_keys:
        return []

    index, postings = load_index()
    names, rows = index["n"], index["r"]
    inbuns, cats = index["b"], index["c"]

    # 재료명 사전을 냉장고와 한 번만 대조한다. find_owned는 양방향 부분 문자열이라
    # 어떤 색인도 못 타므로(그래서 SQLite도 답이 아니었다) 이 한 번은 어차피 남는다.
    hits = collections.Counter()
    for nid, name in enumerate(names):
        if find_owned(name, pantry_keys):
            for i in postings[nid]:
                hits[i] += 1

    wanted = PORTION_PREFERENCE.get(portion, ())

    filter_cat = category if category and category != "상관없음" else None

    scored = []
    for i, hit in hits.items():
        row = rows[i]
        if filter_cat and cats[row[4]] != filter_cat:
            continue
        # 재료 id는 빌드 때 이미 중복을 없앴으므로 길이가 곧 분모다. 예전에는 후보마다
        # set()을 새로 만들었는데, 후보가 16만 건이라 그것만 156ms였다.
        total = len(row[6])
        if total < MIN_INGREDIENTS:
            continue
        rate = hit / total
        if rate >= MIN_COVERAGE:
            fits = 1 if inbuns[row[3]] in wanted else 0
            scored.append((fits, score(hit, total), row[5], rate, i))

    # 분량이 맞는 것이 먼저, 그 안에서 점수, 같으면 인기도(추천수+스크랩수)로 가른다.
    # 분량을 점수보다 앞에 두는 것은 이게 사용자가 직접 고른 조건이기 때문이다 —
    # 점수는 우리가 매긴 값이고, 분량은 사용자가 말한 값이다.
    scored.sort(key=lambda x: (-x[0], -x[1], -x[2]))

    # 같은 이름이 여러 장 뜨지 않게 거른다. 인덱스에는 RCP_SNO가 다른 별개 레시피로 남아
    # 있는 게 맞고("만능간장"이라는 이름의 서로 다른 레시피가 실제로 여럿 있다), 화면에
    # 같은 이름 카드가 세 장 뜨는 것만 막으면 된다. 판정은 추천 이력·즐겨찾기가 쓰는
    # dedupe_key와 같은 규칙이다 — "김치볶음밥"과 "김치 볶음밥"은 같은 요리다.
    # recommend가 이 모듈을 import하므로 위에서 되받으면 순환이 된다(recommend는 아직
    # dedupe_key를 정의하기 전이다). 쓰는 자리에서 늦게 가져온다 — 규칙은 여전히 한 곳이다.
    from recommend import dedupe_key

    out, seen = [], set()
    for _, _, _, rate, i in scored:
        row = rows[i]
        key = dedupe_key(row[1])
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(to_response(index, row, rate))
        if len(out) >= limit:
            break
    return out


def _with_amount(name, amount):
    return f"{name} {amount}" if amount else name


def to_response(index, row, rate):
    """프론트가 받을 모양. steps가 빈 배열인 것이 이 응답의 핵심이다 — 원문을 재구성하지 않는다.

    파일에는 재료·시간·인분이 정수 id로 들어 있다. 이름으로 되돌리는 것은 화면에 나갈
    최대 3건뿐이라 값이 싸다 — 23만 건을 미리 풀어두는 것과는 비용이 다르다."""
    names, amounts = index["n"], index["a"]
    return {
        "name": row[1],
        "source": "matched",
        "recipeUrl": RECIPE_URL.format(row[0]),
        "time": index["t"][row[2]],
        "portion": index["b"][row[3]],
        # "돼지고기 250g" — AI가 만든 레시피와 같은 모양이다. 화면·장보기가 이미 그
        # 모양을 파싱하므로(js/shared.js의 splitIngredient) 받는 쪽은 고칠 게 없다.
        "ingredients": [_with_amount(names[nid], amounts[aid])
                        for nid, aid in zip(row[6], row[7])],
        "steps": [],
        # 검색 링크 폴백용 — 원본이 삭제됐을 때 프론트가 쓸 수 있다.
        "searchKeyword": row[1],
        "coverage": round(rate, 3),
    }

