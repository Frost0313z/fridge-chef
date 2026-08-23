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

echo "✓ $INDEX_FILE 확인됨 ($(du -h "$INDEX_FILE" | cut -f1)). 운영 배포를 시작합니다..."
vercel --prod "$@"

# 로컬에 파일이 있는 것과 그게 번들에 실린 것은 다르다 — 2026-08-23에 파일이 있는데도
# 인덱스 없이 배포돼 모든 요청이 조용히 AI 폴백으로 빠졌다(원인 미상). 에러도 안 나고
# 화면도 멀쩡해서 로그를 뒤지기 전까지 알 수 없다. 그래서 배포한 것이 실제로 매칭하는지
# 여기서 한 번 물어본다. "배포했다"와 "동작한다"는 다른 확인이다.
echo
echo "배포된 서비스가 실제로 매칭하는지 확인합니다..."
PROBE='{"ingredients":"돼지고기 300g, 김치 1/4포기, 두부 1모, 양파 1개, 계란 2개, 대파 1대, 마늘 5쪽"}'
RESPONSE=$(curl -s --max-time 30 -X POST "$PROD_URL/api/recommend"   -H "Content-Type: application/json" --data-binary "$PROBE" || true)

if printf '%s' "$RESPONSE" | grep -q '"source": *"matched"'; then
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
