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
