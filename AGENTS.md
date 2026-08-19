# AGENTS.md

에이전트(Codex, Claude Code 등)가 이 저장소에서 작업할 때 읽는 파일이다.

**먼저 읽을 것**

| 파일 | 무엇이 있나 |
|---|---|
| `CLAUDE.md` | 브랜드·보이스·디자인 시스템. 문구와 색을 건드리면 여기가 기준이다. |
| `README.md` | 로컬 실행, 배포, 프로젝트 구조, 설계 노트. |
| `docs/spec-recipe-match.md` | 레시피 매칭 스펙과 KADX 데이터 취급 규칙. |

이 파일은 그 셋에 없는 것만 적는다 — 옮겨 적으면 곧 어긋나기 때문이다.

---

## 명령어

```bash
python api/test_handlers.py        # 서버 쪽 자체 점검 (프레임워크 없음, assert만)
node js/test_amounts.js            # 화면 쪽 자체 점검 (수량 계산·저장소)

python -m http.server 8000         # 화면만 확인 (AI 기능은 안 됨)
vercel dev                         # 프론트+백엔드 동시 (.env에 OPENAI_API_KEY 필요)

vercel --yes --scope frost0313zs-projects           # 프리뷰 배포
vercel --prod --yes --scope frost0313zs-projects    # 운영 배포
```

**코드를 고쳤으면 두 점검을 모두 돌린다.** 하나만 도는 변경은 거의 없다 — 수량·재료
이름 규칙이 파이썬과 자바스크립트 양쪽에 같이 있기 때문이다(아래 "쌍으로 고칠 것").

---

## 배포에서 걸려 넘어지는 자리

- **GitHub 푸시로 배포되지 않는다.** `vercel` 명령을 따로 실행해야 한다.
- **`vercel.json`의 `builds`는 화이트리스트다.** 여기 없는 경로는 배포에 아예 안 실린다
  (`docs/`는 운영에서 404다). 새 정적 폴더를 만들면 `builds`에도 추가해야 한다.
- **Vercel CLI는 `.gitignore`를 보지 않는다.** 로컬 폴더를 통째로 올린다. 커밋하지
  않는 큰 파일은 `.vercelignore`로 따로 막는다 — 원본 CSV가 올라가 함수 번들이
  상한 225MB를 넘겨 배포가 실패한 적이 있다.
- 반대로, **커밋하지 않아도 로컬에 있으면 배포에는 실린다.** `api/recipes_index.json`이
  이 방식으로 올라간다.

---

## 레시피 인덱스 (`api/recipes_index.json`)

git에 없다. 새로 받은 저장소에는 **파일이 없는 게 정상**이다.

```bash
python scripts/build_recipe_index.py     # data/kadx-recipes/*.csv -> api/recipes_index.json
```

- 원본 CSV 인코딩은 **CP949(EUC-KR)**다. UTF-8로 열면 첫 줄부터 깨진다.
- 원본은 `data/kadx-recipes/`에 있고 git에 올리지 않는다(이유는 `.gitignore` 주석).
- 파일이 없으면 매칭이 빈 결과를 내고 기존대로 AI 생성으로 넘어간다 — 죽지 않는다.
- **파싱 규칙을 고쳤으면 반드시 다시 빌드한다.** 안 그러면 코드와 코퍼스가 어긋난 채로 돈다.

`api/test_handlers.py`의 매칭 테스트는 `_fake_index()`로 인덱스를 가짜로 채운다.
실제 46MB 파일 없이도 돌아야 하기 때문이다 — 새 매칭 테스트도 같은 방식으로 쓴다.

---

## KADX 데이터 — 지켜야 하는 경계

레시피 데이터는 **CC BY-NC-ND**다. ND(변경 금지)가 이 프로젝트의 설계를 정한다.

**쓸 수 있는 것** — 재료명, 조리 시간, 인분, 추천·스크랩 수, `RCP_SNO`.
사실 데이터와 원본을 가리킬 id뿐이다.

**쓰면 안 되는 것** — 조리 소개글(`CKG_IPDC`), 원제목(`RCP_TTL`), 조리 순서 원문.
화면에 재구성해서 보여주는 것도, AI 프롬프트에 넣는 것도 안 된다.

그래서 이렇게 되어 있다. 고칠 때 깨뜨리지 말 것:

- `scripts/build_recipe_index.py`가 `CKG_IPDC`·`RCP_TTL`을 **인덱스에 아예 넣지 않는다.**
  갖고 있지 않으면 실수로 새어 나갈 수도 없다.
- `recipe_match.to_response()`는 `steps`를 **항상 빈 배열로** 돌려준다.
- 상세는 `https://www.10000recipe.com/recipe/{RCP_SNO}` 링크로만 안내하고,
  화면에 출처(만개의레시피)를 표기한다. BY 조건이다.

매칭된 레시피에 `steps`를 채우고 싶어지면, 그건 라이선스 위반이다.

---

## 쌍으로 고칠 것

같은 규칙이 두 곳에 있다. **한쪽만 고치면 화면이 수량으로 지운 글자를 서버는 이름으로
읽어 같은 재료가 둘로 갈라진다.** 실제로 이것 때문에 같은 냉장고인데 입력 방식만 달라도
추천 1등이 바뀐 적이 있다.

| 파이썬 (`api/shopping.py`) | 자바스크립트 (`js/shared.js`) |
|---|---|
| `_UNITS` | `AMOUNT_UNITS` |
| `_VAGUE_RE` | `VAGUE_AMOUNT_PATTERN` |
| `parse_line()` 이름 추출 | `stripAmounts()` / `splitIngredient()` |
| `normalize_name()` | `normalizeIngredient()` |

**재료 이름은 첫 숫자 앞까지다.** 단위 목록에 없는 세는 말이 이름에 눌러앉으면
("김치 1/4포기" → "김치포기") 매칭이 어긋난다. 단위 목록은 장보기 합산에 여전히
필요하지만(`개`와 `알`이 같은 것을 센다), **이름을 자르는 데 쓰지 않는다.**
새 단위를 만나면 목록을 늘리기 전에 이 규칙으로 해결되는지 먼저 본다.

---

## 코드 관례

- **모든 UI 문구는 `js/copy.js`의 전역 `COPY`에서 가져온다.** HTML/JS에 하드코딩하지 않는다.
- **모든 색·간격은 `css/tokens.css`의 시맨틱 변수를 쓴다.** hex나 임의 px를 직접 쓰지 않는다.
- 모듈 번들러가 없다. `<script>` 순서가 곧 의존성이다 — `copy.js`가 항상 먼저다.
- `api/recommend.py`가 `recipe_match`를 import하므로, `recipe_match`에서 `recommend`를
  모듈 최상단에서 되받으면 순환 import가 된다. 쓰는 자리에서 늦게 가져온다.
- 파일이 CRLF다. 스크립트로 일괄 치환할 때 줄바꿈을 섞지 않는다.
- 사용자 데이터는 전부 localStorage다(`fridge-chef-*`). 계정도 서버 DB도 없다.

## 검증과 기록

- 비자명한 로직에는 **돌아가는 점검 하나**를 남긴다. 기존 두 점검 파일에 assert로 붙인다.
- 화면을 확인했으면 스크린샷을 `docs/qa-screenshots/`에 파일로 남긴다
  (`{페이지}-{뷰포트}-{설명}.png`). 대화에 이미지로만 보여주고 끝내지 않는다.
- 커밋 메시지는 영문 태그 + 한국어 본문: `feat:` / `fix:` / `docs:` / `perf:` / `refactor:`.
  **무엇을 바꿨는지보다 왜 바꿨는지를 적는다** — 기존 히스토리가 그 형식이다.
- 사용자에게 보여지는 응답은 한국어로 쓴다.

## 하지 말 것

- 이메일·전화번호 등 개인 연락처를 배포되는 소스에 넣지 않는다(LinkedIn만).
- 화면 문구에 "AI"를 쓰지 않는다. 기술이 아니라 안심을 파는 서비스다
  (기술 스택을 설명하는 FAQ 문맥은 예외).
- 원본 CSV나 `api/recipes_index.json`을 커밋하지 않는다.
