/**
 * 있는대로 — 브랜드 카피
 * 슬로건: 냉장고에 있는 대로, 오늘 한끼 완성
 *
 * 모듈이 아닌 일반 스크립트다. 다른 js보다 먼저 <script>로 불러오면
 * 전역 COPY 객체로 어디서든 쓸 수 있다.
 *   <script src="js/copy.js"></script>
 *   <script src="js/shared.js"></script>
 *
 * 표기 규칙
 * - 브랜드명은 붙여씀: "있는대로"
 * - 문장 안에서는 띄어씀: "있는 대로" (의존명사 '대로')
 */

const COPY = {
  BRAND: {
    name: "있는대로",
    nameEn: "Innundaero",
    slogan: "냉장고에 있는 대로, 오늘 한끼 완성",
    sloganShort: "있는 재료로, 없는 요리 없다",
  },

  // 각 페이지 <title>, <meta name="description">에 사용
  META: {
    title: "있는대로 — 냉장고에 있는 대로, 오늘 한끼 완성",
    description:
      "냉장고에 있는 재료만 입력하면 오늘 해먹을 수 있는 요리를 추천해요. 며칠치 식단 계획과 부족한 재료 장보기 리스트까지 한 번에.",
    ogTitle: "있는대로 — 오늘 뭐 해먹지?",
    ogDescription:
      "애매하게 남은 재료로도 한 끼는 나와요. 있는 재료만 적으면 요리와 장보기 리스트를 만들어드려요.",

    /* 페이지별 제목·설명. <body>의 data-page 값이 여기 키와 같아야 한다.
       HTML의 <title>·<meta>에도 같은 문구가 적혀 있는데, 지우지 않은 이유가 있다 —
       검색 로봇과 공유 카드 미리보기는 JS를 실행하지 않고 HTML만 읽는다.
       그래서 HTML은 로봇이 읽는 사본, 여기는 사람이 고치는 원본으로 두고,
       화면에서는 이 값이 HTML을 덮어써서 둘이 어긋나면 이쪽이 이긴다. */
    pages: {
      index: {
        title: "있는대로 — 냉장고에 있는 대로, 오늘 한끼 완성",
        description:
          "냉장고에 있는 재료만 입력하면 오늘 해먹을 수 있는 요리를 추천해요. 며칠치 식단 계획과 부족한 재료 장보기 리스트까지 한 번에.",
      },
      pantry: {
        title: "내 냉장고 · 있는대로",
        description: "냉장고에 있는 재료를 넣어두면 추천·식단·장보기에 자동으로 반영돼요.",
      },
      recipe: {
        title: "레시피 추천 · 있는대로",
        description: "있는 재료만 적으면 지금 바로 만들 수 있는 요리를 찾아드려요.",
      },
      mealplan: {
        title: "주간 식단 계획 · 있는대로",
        description: "냉장고에 있는 대로 며칠치 저녁을 미리 정하고, 부족한 재료만 따로 모아드려요.",
      },
      shopping: {
        title: "장보기 · 있는대로",
        description: "식단에 필요한 양에서 냉장고에 있는 만큼을 뺀, 진짜 사야 할 것만 모았어요.",
      },
    },
  },

  // index.html 히어로 섹션
  HERO: {
    headline: "냉장고에 있는 대로,\n오늘 한끼 완성",
    subhead:
      "애매하게 남은 재료만 적어주세요. 지금 바로 만들 수 있는 요리를 찾아드려요.",
    ctaPrimary: "냉장고 채우고 시작하기 →",
    ctaSecondary: "바로 추천받기",
    note: "있는 재료로, 없는 요리 없어요.",
  },

  // pantry.html 재료 입력
  PANTRY: {
    title: "냉장고",
    inputPlaceholder: "예) 계란, 대파, 김치, 두부",
    inputHelp: "냉장고 열어보고 보이는 대로, 쉼표로 구분해서 적어주세요.",
    empty: "아직 넣어둔 재료가 없어요. 두세 개만 적어도 충분해요.",

    /* --- 아래는 5단계에서 화면에 있는데 COPY에 없어 새로 넣은 것들 --- */
    pageTitle: "내 냉장고",
    pageIntro: "여기에 넣어둔 재료는 이 브라우저에만 저장되고, 추천·식단·장보기에 자동으로 반영돼요.",
    addSectionTitle: "재료 넣기",
    // 수량을 적으면 계산이 정확해진다는 안내. <strong> 자리는 화면에서 유지한다.
    amountHint: "쉼표로 구분하면 여러 개를 한 번에 넣을 수 있어요.",
    amountHintStrong: '"계란 2개"처럼 수량을 함께 적으면',
    amountHintTail: "식단을 짤 때 모자란 재료를 더 정확히 골라드려요.",
    addButton: "넣기",
    listTitle: "지금 들어있는 재료",
    detailOn: "자세히",
    detailOff: "간단히",
    exampleLabel: "눌러서 바로 넣기",
    nextLabel: "재료를 다 넣었다면",
    barEmpty: "아직 넣어둔 재료가 없어요. 아래에 적으면 바로 들어가요.",
    barPlaceholder: "재료 추가 (쉼표로 여러 개)",
    barInputLabel: "냉장고에 추가할 재료",
  },

  // index.html "이렇게 쓰면 돼요" 3단계
  STEPS: [
    {
      num: "1",
      title: "냉장고에 재료를 넣어요",
      body: "쉼표로 구분해서 적기만 하면 돼요. 정확한 계량은 필요 없어요. 한 번 넣어두면 다음부터 다시 적지 않아도 되고, 아래 기능에 자동으로 반영돼요.",
    },
    {
      num: "2",
      title: "오늘 뭐 먹을지 고르거나, 이번 주를 계획해요",
      body: "지금 있는 재료로 만들 수 있는 요리를 골라드려요. 며칠치 저녁을 미리 계획할 수도 있고, 냉장고에 없는 재료는 \"사야 해요\"로 표시돼요.",
    },
    {
      num: "3",
      title: "부족한 재료만 사요",
      body: "계획에 필요한 재료 중 냉장고에 없는 것만 모아 장보기 리스트로 만들어드려요. 사고 나면 \"샀어요\"를 눌러 바로 냉장고에 넣을 수 있어요.",
    },
  ],

  // 공용 UI 상태 문구
  UI: {
    loading: "있는 재료로 뭘 만들 수 있을지 찾고 있어요…",
    emptyIngredients: "냉장고가 좀 헐렁해도 괜찮아요. 두 개만 적어봐도 요리가 나와요.",
    emptyResult: "이 조합으로는 마땅한 게 안 보여요. 재료를 하나만 더 추가해볼까요?",
    error: "잠깐 문제가 생겼어요. 다시 시도해주세요.",
    shoppingListTitle: "이것만 사면 돼요",
    shoppingListEmpty: "다 있어요! 바로 해먹을 수 있어요.",
    mealPlanTitle: "이번 주 식단",
    darkModeToggle: "화면 모드 바꾸기",
    boughtButton: "샀어요",
    needToBuyBadge: "사야 해요",

    /* --- 아래는 5단계에서 화면에 있는데 COPY에 없어 새로 넣은 것들 --- */
    // 기다림. 무엇을 하는 중인지 화면마다 다르므로 따로 둔다
    loadingMealplan: "며칠치 저녁을 짜고 있어요…",
    loadingShopping: "바뀐 식단으로 다시 계산하고 있어요…",
    // 기다리는 동안의 경과·마감 (숫자는 코드가 채운다)
    waitElapsed: (sec, limit) => `${sec}초 지남 · 최대 ${limit}초`,
    waitSlow: (limit) => `${limit}초까지 기다린 뒤에도 답이 없으면 알려드릴게요.`,

    // 아직 아무것도 안 한 상태 — "실패"가 아니라 "시작 전"이라는 게 읽혀야 한다
    emptyRecipeStart: "아직 받은 추천이 없어요. 재료를 확인하고 위 버튼을 눌러보세요.",
    emptyHistory: "아직 받은 추천이 없어요.",
    emptyMealplan: "아직 짜둔 식단이 없어요. 위에서 며칠치 저녁을 정해보세요.",
    emptyShopping: "아직 식단이 없어요. 식단을 먼저 짜면 살 것만 골라드릴게요.",

    // 실패했을 때 다음에 할 수 있는 일
    errorMealplan: "식단을 짜지 못했어요. 잠시 후 다시 시도해주세요.",
    errorFallbackIntro: "지금 추천을 못 받아도 괜찮아요.",
    errorFallbackAction: "최근 받은 요리 보기",
    errorNetwork: "인터넷 연결을 확인하고 다시 시도해주세요.",
    errorTimeout: "답이 조금 늦어지고 있어요. 잠시 후 다시 시도해주세요.",

    // 추천 화면
    recipeFormTitle: "오늘 뭐 해먹을까요?",
    recipeFormIntro: "냉장고에 있는 재료는 자동으로 반영돼요. 오늘만 있는 재료가 있다면 아래에 따로 적어주세요.",
    submitRecipe: "오늘 뭐 해먹지?",
    rerecommend: "다른 요리 보기",
    historyTitle: "최근 받은 요리",
    clearAll: "전체 지우기",

    // 식단 화면
    mealplanTitle: "이번 주 저녁, 미리 정해둘까요?",
    mealplanIntro: "냉장고에 있는 재료를 최대한 쓰고, 부족한 것만 장보기로 모아드려요.",
    submitMealplan: "식단 짜기",
    clearPlan: "계획 지우기",
    editMenu: "메뉴 바꾸기",
    editMenuDone: "다 바꿨어요",
    mealplanStale: "계획한 날짜가 모두 지났어요. 새로 짜면 오늘부터 다시 정해드려요.",
    mealplanNext: "부족한 재료는",
    mealplanNextLink: "장보기에서 확인 →",

    // 장보기 화면
    shoppingTitle: "뭘 사야 할까요?",
    shoppingIntro: "식단에 필요한 양에서 냉장고에 있는 만큼을 뺀 부족한 만큼만 모았어요. 사고 나면 \"샀어요\"를 눌러 냉장고에 넣어주세요.",
    shoppingHint: "자동으로 담기지는 않아요. 누르면 쿠팡 검색 결과가 새 탭에서 열려요.",
    shoppingStale: "식단을 고쳐서 이 목록이 지금 계획과 다를 수 있어요.",
    shoppingRefresh: "장보기 다시 뽑기",
    shoppingEmptyCta: "식단 짜러 가기 →",

    // 홈에서 다음 화면으로 넘기는 버튼
    goRecipe: "이 재료로 추천받기 →",
    goMealplan: "이번 주 식단 짜기",
  },

  /* 푸터 복구: <footer>에 data-copy="FOOTER.tagline" / "FOOTER.copyright" 붙이고,
     LinkedIn 링크는 <a data-copy="FOOTER.linkedinLabel" data-copy-href="FOOTER.linkedinUrl"> 로 연결.
     이메일 등 개인 연락처는 노출하지 않기로 결정 — LinkedIn만 공개. */
  FOOTER: {
    tagline: "있는대로 · 냉장고에 있는 대로, 오늘 한끼 완성",
    copyright: "© " + new Date().getFullYear() + " 있는대로",
    linkedinLabel: "LinkedIn",
    linkedinUrl: "https://www.linkedin.com/in/seunghyeondu/",
  },
};

/* ============================================================
   화면에 붙이기

   HTML에는 문구를 그대로 남겨둔다. 지우고 JS로만 채우면 스크립트가 실패했을 때
   빈 화면이 남고, 검색 로봇도 아무것도 읽지 못한다. HTML은 그 자체로 읽히는 사본이고,
   COPY가 원본이다 — 둘이 어긋나면 화면에서는 COPY가 이긴다.
   ============================================================ */

/* "UI.loading" 같은 경로로 COPY 안을 찾아간다. 없는 경로면 undefined를 돌려주고,
   부르는 쪽이 아무것도 하지 않게 한다 — 오타 하나로 화면이 비는 것보다 낫다. */
function copyText(path) {
  return path.split(".").reduce((obj, key) => (obj == null ? obj : obj[key]), COPY);
}

/* 줄바꿈이 있는 문구는 <br>로 넣는다. innerHTML을 쓰지 않는 이유는,
   문구가 언젠가 사용자 데이터를 품게 돼도 그대로 안전하기 위해서다. */
function setCopyText(el, text) {
  if (!text.includes("\n")) {
    el.textContent = text;
    return;
  }
  el.textContent = "";
  text.split("\n").forEach((line, i) => {
    if (i) el.appendChild(document.createElement("br"));
    el.appendChild(document.createTextNode(line));
  });
}

function applyCopy(root) {
  (root || document).querySelectorAll("[data-copy], [data-copy-href]").forEach((el) => {
    /* data-copy-href는 data-copy-attr와 방향이 반대다. copy-attr는 "값을 어느 속성에 넣을지"를
       적고 값은 data-copy에서 가져오지만, copy-href는 "값을 어느 경로에서 가져올지"를 적는다.
       링크는 보이는 글자와 주소가 서로 다른 문구라 속성 하나로는 둘 다 담지 못한다. */
    if (el.dataset.copyHref) {
      const href = copyText(el.dataset.copyHref);
      if (typeof href === "string") el.setAttribute("href", href);
    }
    if (!el.dataset.copy) return;
    const text = copyText(el.dataset.copy);
    if (typeof text !== "string") return;
    // data-copy-attr가 있으면 글자가 아니라 그 속성(placeholder, aria-label 등)을 채운다
    if (el.dataset.copyAttr) el.setAttribute(el.dataset.copyAttr, text);
    else setCopyText(el, text);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const meta = COPY.META.pages[document.body.dataset.page];
  if (meta) {
    document.title = meta.title;
    const tag = document.querySelector('meta[name="description"]');
    if (tag) tag.setAttribute("content", meta.description);
  }
  applyCopy();
});
