#!/usr/bin/env bash
# 운영 배포(vercel --prod) 전에 recipes_index.json이 있는지 확인한다.
#
# 이 파일은 .gitignore에 있다(KADX 원본 파생 데이터를 공개 저장소에 올리지 않는다는
# 라이선스 결정 — docs/spec-recipe-match.md 데이터 출처 절 참고). git에 없으니 로컬에서
# scripts/build_recipe_index.py로 직접 만들어야 하는데, Vercel CLI는 git이 아니라 로컬
# 폴더를 그대로 올리는 구조라 이 파일이 없는 채로 배포하면 무슨 일이 벌어지는지 알기 어렵다
# — recipe_match.load_index()가 빈 인덱스로 조용히 AI 전용 폴백에 빠지고, 에러도 안 나고
# 화면도 멀쩡하다. 실제로 2026-08-20에 이렇게 배포된 채로 한동안 몰랐다("배포했다"와
# "동작한다"가 달랐다). 그래서 문서로 경고하는 대신 배포 자체를 코드로 막는다.

set -euo pipefail
cd "$(dirname "$0")/.."

INDEX_FILE="api/recipes_index.json"
PROD_URL="https://fridge-chef-gamma.vercel.app"

if [ ! -f "$INDEX_FILE" ]; then
  echo "배포 중단: $INDEX_FILE 이 없습니다." >&2
  echo "이 상태로 vercel --prod를 돌리면 recipe-match가 조용히 AI 전용으로 빠집니다." >&2
  echo "" >&2
  echo "먼저:" >&2
  echo "  1. KADX에서 원본 CSV 4개를 받아 data/kadx-recipes/(+ 루트)에 둔다" >&2
  echo "     (docs/spec-recipe-match.md '데이터 출처 및 라이선스' 절 참고)" >&2
  echo "  2. python scripts/build_recipe_index.py 실행 → $INDEX_FILE 생성 확인" >&2
  exit 1
fi

# 파일이 있어도 낡았으면 소용없다. 빌더를 고치고 다시 안 돌리면 구조는 맞는데 내용만
# 옛것인 인덱스가 배포된다 — 2026-08-20에 cat(요리 종류) 필드를 추가하고 재빌드를 안 해서
# 카테고리 필터가 조용히 아무것도 못 찾았다. 런타임의 포맷 버전 검사는 "구조가 다름"만
# 잡지 이건 못 잡고, 배포 후 검증도 매칭 자체는 되니까 통과한다. 시각으로 비교한다.
BUILDER="scripts/build_recipe_index.py"
if [ "$BUILDER" -nt "$INDEX_FILE" ]; then
  echo "배포 중단: $BUILDER 가 $INDEX_FILE 보다 최신입니다." >&2
  echo "빌더를 고친 뒤 인덱스를 다시 만들지 않았습니다. 구조는 맞는데 내용이 옛것이라" >&2
  echo "런타임 버전 검사도 배포 후 검증도 이걸 못 잡습니다." >&2
  echo "" >&2
  echo "  python scripts/build_recipe_index.py" >&2
  exit 1
fi

echo "✓ $INDEX_FILE 확인됨 ($(du -h "$INDEX_FILE" | cut -f1)). 운영 배포를 시작합니다..."
vercel --prod "$@"

# 로컬에 파일이 있는 것과 그게 번들에 실린 것은 다르다 — 2026-08-23에 파일이 있는데도
# 인덱스 없이 배포돼 모든 요청이 조용히 AI 폴백으로 빠졌다(원인 미상). 에러도 안 나고
# 화면도 멀쩡해서 로그를 뒤지기 전까지 알 수 없다. 그래서 배포한 것이 실제로 매칭하는지
# 여기서 한 번 물어본다. "배포했다"와 "동작한다"는 다른 확인이다.
echo
echo "배포된 서비스가 실제로 매칭하는지 확인합니다..."
# 페이로드를 유니코드 escape로 두어 순수 ASCII로 만든다. Git Bash에서 한글이 든 셸
# 변수를 curl에 넘기면 cp949로 깨져 서버가 400을 돌려준다 — 그러면 멀쩡한 배포도
# 실패로 판정된다(이 검증을 처음 붙였을 때 실제로 그렇게 오탐이 났다). JSON은 escape를
# 그대로 받으므로 셸이 한글을 만질 일이 없어진다.
PROBE='{"ingredients":"\ub3fc\uc9c0\uace0\uae30 300g, \uae40\uce58 1/4\ud3ec\uae30, \ub450\ubd80 1\ubaa8, \uc591\ud30c 1\uac1c, \uacc4\ub780 2\uac1c, \ub300\ud30c 1\ub300, \ub9c8\ub298 5\ucabd"}'

# 배포 직후에는 별칭이 아직 새 배포로 안 넘어가 있을 수 있고 콜드 스타트도 몇 초 걸린다.
# 한 번 찔러 보고 단정하지 않는다.
MATCHED=""
for attempt in 1 2 3 4 5; do
  RESPONSE=$(curl -s --max-time 40 -X POST "$PROD_URL/api/recommend"     -H "Content-Type: application/json" --data-binary "$PROBE" || true)
  if printf '%s' "$RESPONSE" | grep -q '"source": *"matched"'; then
    MATCHED="yes"
    echo "  ${attempt}번째 시도에서 확인됨."
    break
  fi
  [ "$attempt" -lt 5 ] && sleep 6
done

if [ -n "$MATCHED" ]; then
  echo "✓ 매칭 동작 확인 — 실제 레시피가 나옵니다."
else
  echo "" >&2
  echo "경고: 배포는 됐지만 매칭이 안 걸립니다 — AI 전용으로 돌고 있습니다." >&2
  echo "인덱스가 번들에 안 실렸을 가능성이 큽니다. 확인:" >&2
  echo "  vercel logs $PROD_URL --scope frost0313zs-projects | grep recipes_index" >&2
  echo "  (\"not found\" 또는 \"unreadable\"이 보이면 그것이다)" >&2
  echo "" >&2
  echo "되돌리려면: vercel rollback <직전 배포 URL> --scope frost0313zs-projects" >&2
  exit 1
fi
