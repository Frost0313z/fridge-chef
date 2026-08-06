# 🧊 냉털 셰프 (fridge-chef)

![HTML/CSS/JS](https://img.shields.io/badge/frontend-Vanilla%20HTML%2FCSS%2FJS-e34c26)
![Python](https://img.shields.io/badge/backend-Vercel%20Serverless%20(Python)-3776AB?logo=python&logoColor=white)
![OpenAI](https://img.shields.io/badge/AI-OpenAI%20API-412991?logo=openai&logoColor=white)
![Vercel](https://img.shields.io/badge/deploy-Vercel-black?logo=vercel&logoColor=white)
![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)

**냉장고에 있는 재료만 입력하면, AI가 지금 바로 만들 수 있는 요리를 추천해주는 웹 서비스입니다.**
"뭘 해먹지?"를 고민하는 대신 재료를 입력하면, 요리 이름부터 조리 순서까지 한 번에 확인할 수 있습니다.

Codyssey 대전 캠퍼스 "AI 웹 개발: 내 아이디어를 현실로, AI 웹 서비스 빌딩" 미션 결과물입니다.

🔗 **배포 URL**: `배포 후 업데이트 예정`

> [!NOTE]
> **목차**
>
> - [💡 무엇을, 어떻게 하나요?](#-무엇을-어떻게-하나요)
> - [🚀 빠른 시작 (로컬 실행)](#-빠른-시작-로컬-실행)
> - [🖥️ 실행 화면](#️-실행-화면)
> - [📋 기능](#-기능)
> - [🔑 API 키 설정 방법](#-api-키-설정-방법)
> - [⚠️ API 키 유출 주의사항](#️-api-키-유출-주의사항)
> - [🧱 프로젝트 구조](#-프로젝트-구조)
> - [🛠️ 개발 환경 확인](#️-개발-환경-확인)
> - [🧠 설계 노트](#-설계-노트) — AI 응답 JSON 강제, 실패 처리 3종, 반응형 전략, 향후 확장
> - [📄 서비스 기획서](./docs/서비스기획서.md)
> - [📄 라이선스](#-라이선스)

---

## 💡 무엇을, 어떻게 하나요?

동작은 딱 세 단계입니다.

```
"계란 2개, 대파, 두부 있는데 뭐 해먹지?"
        │
        ▼
1️⃣ [브라우저] 재료 입력 폼에 입력       ──▶  fetch('/api/recommend')
        │
        ▼
2️⃣ [Vercel Serverless Function] 입력을 받아 OpenAI API 호출
        │  (재료 → JSON 형식의 요리 1~3개 요청)
        ▼
3️⃣ [브라우저] 추천 요리 카드로 표시     ──▶  이름 / 예상 시간 / 재료 / 조리 순서
```

<br>

프론트엔드(브라우저)는 사용자 입력을 받아 백엔드(Vercel Serverless Function)에 `fetch`로 요청만 보내고,
실제로 OpenAI API를 호출하는 부분은 전부 서버에서 처리합니다. API 키가 브라우저에 노출되지 않는 이유가 여기에 있습니다.

빈 입력, API 오류, 응답 지연 세 가지 실패 상황에서는 프로그램이 멈추지 않고 사용자에게 안내 메시지를 보여줍니다 — 왜 이렇게 설계했는지는 [설계 노트](#-설계-노트)에서 다룹니다.

---

## 🚀 빠른 시작 (로컬 실행)

이 프로젝트는 Vercel Serverless Functions(Python)를 사용하므로, 백엔드까지 포함한 완전한 로컬 실행은 [Vercel CLI](https://vercel.com/docs/cli)가 필요합니다.

```bash
git clone https://github.com/Frost0313z/fridge-chef.git
cd fridge-chef

cp .env.example .env   # .env에 실제 OPENAI_API_KEY 입력

npm install -g vercel   # 최초 1회
vercel dev              # http://localhost:3000 에서 프론트+백엔드 동시 실행
```

프론트엔드 화면만 빠르게 확인하려면 (AI 기능은 동작하지 않음):

```bash
python -m http.server 8000
# http://localhost:8000/index.html 접속
```

---

## 🖥️ 실행 화면

| 데스크톱 | 모바일 |
|---|---|
| `스크린샷 추가 예정` | `스크린샷 추가 예정` |

**AI 기능 동작 예시**

```
입력: 계란 2개, 대파, 두부 반모 / 2인분 / 15분 이내

→ 추천 결과 (예시)
스크린샷 추가 예정
```

---

## 📋 기능

| 페이지 | 기능 |
|---|---|
| 홈 (`index.html`) | 서비스 소개, 레시피 추천 페이지로 이동 |
| 레시피 추천 (`recipe.html`) | 재료/인원수/조리시간 입력 → AI 추천 요리 카드 표시 |
| 소개 (`about.html`) | 이용 방법 3단계, 기술 스택, FAQ |

- 반응형 레이아웃 (데스크톱 / 태블릿 / 모바일 640px 이하에서 햄버거 메뉴 전환)
- AI 실패 처리: 빈 입력 / API 오류(4xx·5xx) / 응답 지연(타임아웃) 각각 별도 안내 메시지
- **[보너스]** 다크 모드 토글 — 선택값을 `localStorage`에 저장, 최초 방문 시 OS 설정(`prefers-color-scheme`)을 따름

---

## 🔑 API 키 설정 방법

1. [OpenAI Platform](https://platform.openai.com/api-keys)에서 API 키를 발급받습니다.
2. **로컬 개발**: `.env.example`을 복사해 `.env`로 저장한 뒤 `OPENAI_API_KEY` 값을 채웁니다. (`.env`는 `.gitignore`에 등록되어 있어 커밋되지 않습니다)
3. **배포(Vercel)**: 프로젝트 대시보드 → Settings → Environment Variables 에서 동일한 이름(`OPENAI_API_KEY`)으로 등록합니다.

## ⚠️ API 키 유출 주의사항

- API 키는 코드/README/스크린샷 어디에도 실제 값으로 노출하지 않습니다.
- 브라우저(프론트엔드)는 API 키를 전혀 알지 못합니다 — 키를 사용하는 모든 호출은 서버(`api/recommend.py`)에서만 이루어집니다.
- 만약 키가 실수로 노출되었다면 즉시 OpenAI 대시보드에서 해당 키를 폐기(Revoke)하고 새로 발급하며, 노출된 커밋이 있다면 히스토리에서도 제거합니다.

---

## 🧱 프로젝트 구조

```
fridge-chef/
├── index.html            # 홈
├── recipe.html            # 레시피 추천 (AI 기능)
├── about.html              # 소개
├── css/
│   └── style.css          # 전체 페이지 공통 스타일 + 반응형
├── js/
│   ├── main.js             # 반응형 네비게이션(햄버거 메뉴) 토글
│   └── recipe.js           # AI 추천 요청/결과 렌더링/실패 처리
├── api/
│   └── recommend.py        # Vercel Serverless Function — OpenAI 연동
├── docs/
│   └── 서비스기획서.md
├── requirements.txt
├── .env.example
└── README.md
```

---

## 🛠️ 개발 환경 확인

<!-- ENV_EVIDENCE_START -->
```
$ python -V
Python 3.14.6

$ git --version
git version 2.55.0.windows.3

$ git config user.name
Drako_Dev

$ git config user.email
msong7618@gmail.com

$ git log --oneline --graph --all
* a891da6 docs: 서비스 기획서 작성
* 273b3da feat: 레시피 추천 페이지 + 프론트-백엔드 연동, 실패 처리 UX 구현
* 691958e feat: AI 레시피 추천 백엔드(api/recommend.py) 구현
* 0a0d357 chore: 의존성 정의 및 환경변수 템플릿 추가
* 339bd7e feat: 소개 페이지(이용방법/기술스택/FAQ) 구현
* 46d0bf2 feat: 홈 페이지 + 반응형 네비게이션 골격 구현
* fb1f77d chore: 프로젝트 구조 초기화
```
<!-- ENV_EVIDENCE_END -->

---

## 🧠 설계 노트

### AI 응답을 JSON으로 강제한 이유
프론트엔드가 자연어 문장을 파싱하면 AI 응답의 형식이 조금만 달라져도 화면이 깨집니다.
`response_format={"type": "json_object"}`로 응답 형식을 강제하고, 서버가 `recipes` 배열 구조로 한 번 더 검증한 뒤 프론트에 전달하므로,
AI가 "추천 요리는 다음과 같습니다:" 같은 부연 설명을 덧붙여도 화면 렌더링에 영향을 주지 않습니다.

### 실패 처리를 3종으로 나눈 이유
미션 요구사항은 실패 처리 1개 이상이지만, 실제로 발생 가능한 실패는 성격이 다릅니다.
- **빈 입력**: 사용자 실수 → 프론트에서 즉시 막아 API 호출 자체를 아낀다 (요청 비용 절감)
- **API 오류(4xx/5xx)**: OpenAI 쪽 문제 → 서버가 원인을 감추고 "잠시 후 다시 시도" 안내로 통일
- **응답 지연**: 서버 15초 + 클라이언트 20초로 이중 타임아웃을 걸어, 서버가 먼저 끊어도 클라이언트가 무한 대기하지 않도록 한다

### 반응형을 브레이크포인트 2단계로 설계한 이유
데스크톱(3열 카드) → 태블릿 900px(2열) → 모바일 640px(1열 + 햄버거 메뉴) 3단계로 나눴습니다.
페이지 종류가 적어 복잡한 그리드 시스템 대신 `grid-template-columns`를 구간별로 직접 지정하는 방식이
코드량 대비 유지보수가 더 쉽다고 판단했습니다.

### 프레임워크 없이 바닐라로 구현한 이유
미션 제약사항(React/Vue 등 금지)이 아니더라도, 페이지 3개 규모에서는 라우터/상태관리 없이
각 HTML 파일에 공통 네비게이션을 복제하는 방식이 빌드 도구 없이 Vercel에 정적 파일 그대로 배포할 수 있어 더 단순합니다.

### 향후 확장 아이디어
[서비스 기획서](./docs/서비스기획서.md)의 "향후 확장 아이디어" 참고 — 장바구니 기능, 다크 모드, 방문자 카운팅 등을 보너스 범위로 검토했습니다.

---

## 📄 라이선스

MIT License — [LICENSE](./LICENSE) 참고
