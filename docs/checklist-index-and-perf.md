# 체크리스트 — 인덱스 배포 · 백업 · 매칭 최적화

작성 2026-08-23. 셋은 순서가 있다. 1번을 안 고치고 3번을 하면, 최적화가 됐는지
안 됐는지 확인할 방법 자체가 없다.

| | 항목 | 왜 지금 | 상태 |
|---|---|---|---|
| 1 | 프로덕션 인덱스 누락 | 지금 서비스가 반쪽이다 | ⬜ |
| 2 | 원본 CSV 백업 | 잃으면 인덱스를 만들 수조차 없다 | ⬜ |
| 3 | 매칭 최적화 | 콜드 4.7배 · 웜 2배 | ⬜ |

---

## 1. 프로덕션 인덱스 누락 — 지금 매칭이 하나도 안 걸린다

**증상.** 프로덕션(`fridge-chef-gamma.vercel.app`)이 매칭 결과가 아니라 AI 생성물을
돌려준다. 응답에 `steps`가 있고 `source`·`recipeUrl`이 없으면 AI 경로다.

```
2026-08-23 14:53 배포 로그
recipes_index.json not found at /var/task/api/recipes_index.json — falling back to AI-only
```

로컬에는 파일이 있다(53MB, 14:52 생성). 배포는 그 뒤였으니 타이밍 문제가 아니다.
**원인은 아직 모른다.** 아래는 진단 순서지 정답이 아니다.

- [ ] 로컬 파일 확인 — `ls -la api/recipes_index.json`
- [ ] 업로드 제외 규칙 확인 — `.vercelignore`에 걸리는지, `vercel.json`의
      `builds[0].config.includeFiles`(`api/**`)가 살아 있는지
- [ ] 프리뷰로 재현 — `vercel --yes --scope frost0313zs-projects` 후
      `/api/recommend` 응답에 `source: "matched"`가 오는지
- [ ] 프리뷰에서도 없으면 업로드 문제, 프리뷰는 되는데 프로덕션만 안 되면
      배포 시점·경로 문제 (프리뷰는 되던 이력이 있다 — `fap0ooauh`, `80vwmp9lo`)
- [ ] 원인을 잡은 뒤 프로덕션 재배포
- [ ] **확인** — 프로덕션 응답에 `"source": "matched"`와 `recipeUrl`이 있는지
      직접 호출해서 본다. 화면이 멀쩡한 것은 확인이 아니다.

**왜 두 번이나 놓쳤나.** 이 실패는 조용하다. 인덱스가 없으면 코드가 의도대로
AI 폴백으로 가고, 에러도 안 나고 화면도 멀쩡하다. `scripts/deploy.sh`는 파일이
**있는지**만 보지 **번들에 실렸는지**는 못 본다.

- [ ] 배포 후 매칭이 실제로 동작하는지 자동으로 확인하는 단계를 `deploy.sh`에 추가
      (배포된 URL에 `/api/recommend`를 한 번 던져 `source: "matched"` 확인)

---

## 2. 원본 CSV 백업 — 이 PC 한 곳에만 있다

`data/kadx-recipes/`와 루트의 CSV 4개(합 155MB)는 공개 저장소에 올리지 않기로 한
데이터다(라이선스 판단은 `.gitignore` 주석과 `docs/spec-recipe-match.md` 참고).
**공개 저장소에 못 올리는 것과 백업을 안 하는 것은 다른 얘기다.**

```
TB_RECIPE_SEARCH-220701.csv                     52.8 MB
TB_RECIPE_SEARCH-231130.csv                     77.8 MB
data/kadx-recipes/TB_RECIPE_SEARCH_241226.csv   11.1 MB
data/kadx-recipes/TB_RECIPE_SEARCH_251231.csv   13.4 MB
```

이걸 잃으면 인덱스를 **다시 만들 수조차 없다.** KADX에서 다시 받으면 되지만,
같은 스냅샷이 계속 제공된다는 보장은 없다.

- [ ] 외장 디스크나 개인 클라우드(공개되지 않는 곳)에 4개 파일 복사
- [ ] 복사본에서 실제로 열리는지 확인 — CP949로 첫 줄을 읽어본다
- [ ] 받은 경로·날짜를 `docs/spec-recipe-match.md`에 적어둔다 (다시 받아야 할 때를 위해)

### 지금 복구할 수 있는 것 / 없는 것

| 대상 | git | Vercel 롤백 | 비고 |
|---|---|---|---|
| 코드 | O | O | 전부 푸시됨 |
| `api/recipes_index.json` | X | O | 배포 번들에 포함되므로 코드와 **한 세트**로 돌아간다 |
| 원본 CSV | X | X | **여기뿐** |

`vercel rollback <url>`을 쓸 수 있고 프로덕션 배포가 7개 이상 남아 있다.
코드와 인덱스가 어긋날 걱정이 없는 쪽은 git이 아니라 이쪽이다.

---

## 3. 매칭 최적화 — 콜드 1,452ms → 633ms, 웜 243ms → 130ms

측정으로 확인한 것만 적는다.

**무엇을 바꾸나**

- 역색인을 요청 프로세스마다 다시 만들지 않고 **빌드 때 만들어 파일에 넣는다**
  (콜드의 709ms가 통째로 사라진다)
- 재료명을 정수 id로 (고유 62,150종이 217만 칸에 평균 35번 중복)
- 레시피별 재료 개수를 빌드 때 미리 세어둔다 (웜 채점 156ms → 41ms, 결과 동일)

**측정치**

```
              파일      콜드      웜(채점)
현재         50.6MB   1,452ms      156ms
신규(단일)   31.7MB     633ms       41ms
메모리       324MB -> 207MB   (Vercel 한도 1024MB)
```

매칭 코어와 표시용을 두 파일로 나누면 콜드 307ms까지 가지만, 파일 둘이 서로
어긋날 경우의 수가 하나 늘어난다. **단일 파일을 권한다** — 1번 같은 사고를 한 번
더 만들 이유가 없다.

**부작용 점검 (확인 완료)**

- 추천 결과: 냉장고 조합 7개로 대조, 7/7 순서까지 동일
- 메모리: 324MB → 207MB (개선)
- 손대야 하는 곳: `vocab_with_min_occurrence`(id→이름), `to_response`의
  `ingredients`, 테스트의 `_fake_index` 헬퍼 한 곳
  (`_fake_index` 호출부 12곳은 안 건드려도 된다)

**전제조건 — 이거 없이 하지 말 것**

구조가 바뀌므로 코드와 인덱스 버전이 어긋나면 **매 요청 500이고 스스로 낫지 않는다.**
실측한 예외는 아래 둘이고, 지금 `_read_index`의 `except (ValueError, OSError)`에
**둘 다 안 걸린다.**

```
새 코드 + 옛 인덱스   TypeError: list indices must be integers or slices, not str
옛 코드 + 새 인덱스   AttributeError: 'str' object has no attribute 'get'
```

- [ ] 인덱스 파일에 포맷 버전을 넣는다
- [ ] `_read_index`에서 버전이 안 맞으면 **손상 파일과 똑같이 취급** (AI 폴백 + 로그).
      이미 만들어 둔 폴백 경로를 그대로 쓴다
- [ ] `deploy.sh`에 인덱스 mtime과 `build_recipe_index.py` mtime 비교를 추가
      (포맷 버전은 "구조가 다름"은 잡지만 "구조는 같은데 내용이 낡음"은 못 잡는다 —
      `cat` 필드 사건이 정확히 그것이었다)

**본 작업**

- [ ] `scripts/build_recipe_index.py` — 정수 id · 역색인 · 재료 개수 · 포맷 버전 출력
- [ ] `api/recipe_match.py` — `_read_index` 버전 검사, `load_index` 구축 루프 제거,
      `match` 채점에 미리 센 개수 사용, `to_response` id→이름
- [ ] `api/pantry_import.py` 경로 — `vocab_with_min_occurrence`가 이름을 돌려주는지
      (문자열이 아니면 사진 등록이 조용히 아무것도 못 찾는다. 테스트 5개가 덮고 있다)
- [ ] 테스트 — `_fake_index` 헬퍼 갱신, 버전 불일치 케이스 추가
- [ ] **확인** — `python api/test_handlers.py`, `node js/test_amounts.js`,
      인덱스 재빌드 후 추천 결과가 이전과 같은지 대조, 프리뷰에서 콜드 실측

---

## 안 하기로 한 것

- **폰트 292KB 줄이기.** 전송량 656KB 중 617KB가 웹폰트고 그중 `MaruBuri-Bold.woff2`가
  292KB다(h1·`.brand`에만 쓰는데 한글 전체 글리프를 받는다). 줄이려면 서브셋 폰트를
  만들어 자체 호스팅해야 하는데 `fonttools` 실행이 필요하다 — 이 프로젝트의
  "빌드 스텝 없음" 원칙과 부딪힌다. 성능이 아니라 판단의 문제라 따로 정한다.
- **프론트 코드 최적화.** 자체 CSS+JS는 gzip 후 40KB 남짓이고 `loadPantry()`도
  렌더당 한 번씩만 부른다. 짜낼 게 없다.
- **`js/test_amounts.js`가 프로덕션에 배포되는 것**(`GET /js/test_amounts.js` → 200).
  `vercel.json`의 `js/**` 글롭 때문이다. 사용자 대역폭은 안 쓰지만 테스트 코드가
  공개된다. 급하지 않아 뒤로 미룬다.
