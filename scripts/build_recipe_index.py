"""KADX 레시피 CSV → 매칭용 경량 JSON.

실행: python scripts/build_recipe_index.py

배포 전에 손으로 한 번 돌린다. 요청마다 하지 않는다 — 23만 건을 매번 파싱할 이유가 없다.

라이선스(CC BY-NC-ND) 때문에 여기서 거르는 것이 중요하다. 조리 소개글(CKG_IPDC)과
원제목(RCP_TTL)은 창작적 서술이라 **파이프라인에 아예 들이지 않는다** — 갖고 있지 않으면
실수로 AI 프롬프트나 화면으로 새어 나갈 수도 없다(스펙의 핵심 원칙 4).
내보내는 것은 사실 데이터(재료명·시간·인분·인기도)와 원본 링크를 만들 RCP_SNO뿐이다.
"""

import csv
import glob
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
from shopping import parse_line, normalize_name  # noqa: E402

csv.field_size_limit(10 ** 7)

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "api", "recipes_index.json")

# 네 스냅샷은 부분집합이 아니라 기간별 증분이다 — 251231은 231130과 한 건도 안 겹친다.
# 두 개만 쓰면 코퍼스의 79%를 버리게 되므로 전부 병합한다(스펙 실측 ⓐ).
# 뒤에 오는 파일이 이긴다 = 최신 스냅샷 우선.
SOURCES = [
    "TB_RECIPE_SEARCH-220701.csv",
    "TB_RECIPE_SEARCH-231130.csv",
    "data/kadx-recipes/TB_RECIPE_SEARCH_241226.csv",
    "data/kadx-recipes/TB_RECIPE_SEARCH_251231.csv",
]

# 원본은 "[재료] ...", "[비빔밥 고추장양념] ..." 처럼 대괄호로 그룹을 나눈다. 접두사 하나가
# 아니라 중간에도 나오고(표본의 44.2%), 이건 재료가 아니라 라벨이라 재료로 세면 커버율이
# 엉뚱해진다. 구분자로 바꿔서 통째로 걷어낸다 — "[주재료]두부"의 두부는 살아남는다.
GROUP_RE = re.compile(r"\[[^\]]*\]")


# 수량이 시작되는 자리는 첫 숫자다. 구형 스냅샷(병합 후 코퍼스의 79%)은 BEL 구분자 없이
# "돼지고기 1/3밥공기양"처럼 한 덩어리로 오는데, parse_line은 아는 단위만 떼므로 모르는
# 단위어가 이름에 눌러앉는다 — "돼지고기밥공기양", "물C", "가쓰오부시줌". 재료 슬롯의
# 12.8%가 이렇게 어긋나 있었다(측정: 231130 3만 행).
AMOUNT_RE = re.compile(r"[0-9]")

# 괄호 안은 수식어지 이름이 아니다. normalize_name이 괄호만 지우고 내용은 붙여버려서
# "간장(돼지고기양념용)"이 "간장돼지고기양념용"이 된다.
PAREN_RE = re.compile(r"\([^)]*\)")


def head_of(piece):
    """재료 한 조각에서 이름 쪽만 남긴다 — 첫 숫자 앞까지, 괄호 수식어는 뺀다."""
    m = AMOUNT_RE.search(piece)
    return PAREN_RE.sub(" ", piece[: m.start()] if m else piece)


def ingredient_names(raw):
    """CKG_MTRL_CN에서 재료 이름만 뽑는다.

    원본이 \\x07(BEL)로 이름·수량·단위를 이미 나눠놨다. 이걸 모르고 통째로 parse_line()에
    넣으면 이름이 '소고기\\x07 \\x07g\\x07'로 나와 매칭이 어긋난다(스펙 실측 ⓑ).
    그래서 \\x07로 먼저 자르고, 그러고도 이름 쪽에 수량이 붙어 있는 경우가 있어
    ("양파 1/2개") 이름만 한 번 더 head_of + parse_line에 통과시킨다.
    """
    names = []
    for piece in GROUP_RE.sub("|", raw or "").split("|"):
        parts = [p.strip() for p in piece.split("\x07") if p.strip()]
        if not parts:
            continue
        name = normalize_name(parse_line(head_of(parts[0]))[0])
        # 이름 자체가 숫자로 시작하면("2배 식초 2큰술") 잘라낸 머리가 빈다. 그 106건은
        # 버리는 것보다 예전처럼 두는 편이 낫다 — 고치는 3만여 건과 맞바꿀 이유가 없다.
        if not name:
            name = normalize_name(parse_line(parts[0])[0])
        # 닫히지 않은 대괄호가 남는 경우가 드물게 있다. 재료 이름에 괄호가 남을 일은 없다.
        if name and "[" not in name and "]" not in name:
            names.append(name)
    return names


def to_int(value):
    try:
        return int(str(value).strip() or 0)
    except ValueError:
        return 0


def main():
    merged = {}
    seen_rows = 0

    for rel in SOURCES:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            print(f"  건너뜀 (없음): {rel}")
            continue

        # 원본 인코딩은 CP949다. UTF-8로 열면 첫 줄부터 깨진다.
        with io.open(path, encoding="cp949", errors="replace", newline="") as fh:
            rows = list(csv.DictReader(fh))
        seen_rows += len(rows)

        kept = 0
        for row in rows:
            sno = (row.get("RCP_SNO") or "").strip()
            name = (row.get("CKG_NM") or "").strip()
            if not sno or not name:
                continue
            ings = ingredient_names(row.get("CKG_MTRL_CN"))
            if not ings:
                continue

            merged[sno] = {
                "id": to_int(sno),
                "name": name,
                "ing": ings,
                "time": (row.get("CKG_TIME_NM") or "").strip(),
                "inbun": (row.get("CKG_INBUN_NM") or "").strip(),
                # 후보가 여럿일 때 2차 정렬용. 추천수+스크랩수를 하나로 합쳐 들고 간다.
                "pop": to_int(row.get("RCMM_CNT")) + to_int(row.get("SRAP_CNT")),
            }
            kept += 1
        print(f"  {rel:<46} {len(rows):>7,}행 → {kept:>7,}건")

    recipes = sorted(merged.values(), key=lambda r: -r["pop"])
    with io.open(OUT, "w", encoding="utf-8", newline="") as fh:
        json.dump(recipes, fh, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT)
    print()
    print(f"  읽은 행 합계  : {seen_rows:,}")
    print(f"  중복 제거 후  : {len(recipes):,}건")
    print(f"  출력          : {os.path.relpath(OUT, ROOT)}  ({size / 1024 / 1024:.1f}MB)")


if __name__ == "__main__":
    main()
