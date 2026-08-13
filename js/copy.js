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
  },

  FOOTER: {
    tagline: "있는대로 · 냉장고에 있는 대로, 오늘 한끼 완성",
    copyright: "© " + new Date().getFullYear() + " 있는대로",
  },
};
