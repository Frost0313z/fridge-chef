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
    note: "있는 재료로, 없는 요리 없어요.",
  },

  // pantry.html 재료 입력
  PANTRY: {
    title: "냉장고",

    /* 빈 화면의 "눌러서 바로 넣기" 버튼과 입력칸 placeholder가 쓰는 하나의 예시 세트.
       예전에는 버튼 목록이 pantry.html에, placeholder가 여기에 따로 적혀 있어서
       순서도 개수도 어긋나 있었다(계란·대파·두부·김치·양파 / 계란·대파·김치·두부).
       같은 것을 두 곳에 적으면 반드시 갈라진다.

       첫 칸에 수량을 붙여두는 이유는 바로 위 amountHintStrong이 "계란 2개"처럼
       적으라고 말하고 있어서다 — 말로만 시키지 않고 눌러볼 수 있는 예를 같이 둔다.
       (누르면 손으로 적은 것과 똑같이 이름·수량으로 갈라져 들어간다) */
    examples: ["계란 2개", "대파", "김치", "두부", "양파"],
    /* getter인 이유는 위 배열을 그대로 쓰기 위해서다. 함수로 두면 data-copy 바인딩이
       문자열이 아니라며 건너뛴다(copy.js 아래 applyCopy 참고). */
    get inputPlaceholder() {
      return `예) ${this.examples.join(", ")}`;
    },
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

    /* 실제 레시피와 매칭됐을 때. 조리 순서를 우리 화면에 옮겨 적지 않고 원본으로 보낸다 —
       데이터 라이선스(CC BY-NC-ND)의 ND 조건이라, 문구가 아니라 지켜야 하는 경계다.
       출처 표기는 BY 조건이다(docs/spec-recipe-match.md).

       "AI"라는 말을 쓰지 않는 브랜드 규칙은 여기서도 같다 — 사용자에게는 이게 어디서 왔는지가
       아니라 "진짜 있는 레시피"라는 사실이 중요하다. */
    matchedLink: "만개의레시피에서 자세히 보기 →",
    matchedSource: "레시피 출처: 만개의레시피",
    matchedNote: "실제로 올라와 있는 레시피예요. 조리 순서는 원문에서 볼 수 있어요.",

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
    recipeFormIntro: "냉장고에 있는 재료로 찾아드려요. 빠진 게 있으면 아래 냉장고에서 바로 넣을 수 있어요.",
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

  /* "이거 해먹었어요" — 요리한 뒤 냉장고에서 재료를 빼는 확인 단계.
     "다 썼나요?"가 아니라 "이제 냉장고에 없나요?"로 묻는다. 얼마를 썼는지를 재는 게 아니라
     지금 남아 있는지만 확인하는 자리다 — 정밀 수량 추적은 이 서비스의 범위 밖이고,
     "다 썼나요"는 그 요리에 정확히 얼마를 썼는지 묻는 것처럼 읽혀 오해를 부른다. */
  COOKED: {
    button: "이거 해먹었어요",
    question: "이제 냉장고에 없나요?",
    hint: "아직 남아 있는 재료는 체크를 풀어주세요.",
    confirm: "냉장고에 반영하기",
    // 전부 체크를 풀고 눌렀을 때. 아무 일도 안 일어난 것을 조용히 넘기지 않는다
    nothing: "체크한 재료가 없어서 냉장고는 그대로 뒀어요.",
    /* 다른 칸에서 이미 뺀 재료를 또 확인했을 때. 목록은 그릴 때의 냉장고 기준이라
       사이에 재고가 빠졌을 수 있다 — 이때 "뺐어요"라고 하면 거짓말이 된다. */
    already: "체크한 재료는 이미 냉장고에 없어요.",
    done: (names) => `${names}을(를) 냉장고에서 뺐어요.`,
    undone: (names) => `${names}을(를) 다시 넣었어요.`,
    failed: "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요.",
  },

  /* 절약 체감. "이거 해먹었어요"를 누를 때마다 쌓이는 개인 기록이다.

     톤은 축하다. 이 아이디어의 원형("이 돈이면 치킨 몇 마리인데")은 손실을 비꼬는
     자조인데, 여기는 손실이 아니라 성취를 보여주는 자리라 그 말투를 가져오면 안 된다.
     숫자는 올라가기만 한다 — 배달을 시킨 날이라고 깎으면 뿌듯함이 아니라 죄책감이 된다. */
  SAVINGS: {
    /* 카드가 어느 기간을 보고 있는지는 제목이 말한다. 토글이 둘 사이를 오간다. */
    titleWeek: "이번 주 아낀 돈",
    titleMonth: "이번 달 아낀 돈",

    /* 토글 버튼 글자. 냉장고의 "자세히/간단히"와 같이, 지금 상태가 아니라
       누르면 무엇이 되는지를 적는다. */
    rangeToMonth: "이번 달 보기",
    rangeToWeek: "이번 주 보기",

    amount: (won) => `${won.toLocaleString("ko-KR")}원`,
    // 확인 직후 결과 문구 뒤에 붙는 한 줄
    inline: (won) => `지금까지 ${won.toLocaleString("ko-KR")}원 아꼈어요.`,

    /* 치킨 환산. 소수점을 그대로 보여주지 않는다("치킨 1.7마리"는 읽히지 않는다). */
    chickenAlmost: "조금만 더 모으면 치킨 한 마리 값이에요.",
    chickenExact: (n) => `치킨 ${n}마리 값이에요.`,
    chickenOver: (n) => `치킨 ${n}마리 값을 넘었어요.`,
    chickenNear: (n) => `치킨 ${n}마리에 조금 못 미쳐요.`,

    // 근거를 밝힌 추정치임을 화면에서도 말한다 — 서비스가 보증하는 숫자가 아니다
    note: "배달 한 끼를 13,000원으로 잡고 더한 값이에요. 실제로 아낀 금액과는 다를 수 있어요.",
  },

  /* 즐겨찾기 — 이력에서 밀려나지 않는 목록. 담고 빼는 것 자체는 별 모양이 말하므로
     문구는 화면 낭독기용 이름과, 더 담을 수 없을 때 한 줄뿐이다. */
  FAVORITES: {
    add: (name) => `${name} 즐겨찾기에 담기`,
    remove: (name) => `${name} 즐겨찾기에서 빼기`,

    // 식단 빈 칸에서 "최근 추천받은 요리" 위에 서는 목록의 이름
    pickTitle: "즐겨찾기에 담아둔 요리",

    /* 가득 찼을 때. 조용히 안 담기면 별이 고장 난 것으로 읽힌다(C3).
       나무라지 않고 다음에 할 수 있는 일을 알려준다 — 냉장고 상한 안내와 같은 방침이다. */
    full: (limit) =>
      `즐겨찾기는 ${limit}개까지 담을 수 있어요. 안 보는 것 하나만 빼면 이 요리도 담을 수 있어요.`,
    failed: "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요.",
  },

  /* 식단 계획 항목의 상태. 계획을 못 지킨 것을 나무라지 않는다 — 계획 이탈은 실패가
     아니고, 부족은 "이것만 더 있으면 되는" 상태다. */
  MEALPLAN: {
    done: "해먹었어요",
    short: (names) => `괜찮아요, ${names}만 더 있으면 이 요리도 만들 수 있어요.`,

    /* 그리드 칸에 남기는 짧은 표시. 위의 긴 문구는 모달이 맡는다 —
       21칸에 문장을 늘어놓으면 정작 "이번 주 뭐 먹지"가 안 읽힌다(C2). */
    shortBrief: (count) => `${count}가지만 더`,

    /* 칸을 눌러 여는 버튼. 글자가 없는 버튼이라 이름은 이것뿐이다. */
    detail: (day, meal, menu) => `${day} ${meal} ${menu} 자세히 보기`,

    // 빈 칸에 넣을 메뉴를 고르는 목록. 즐겨찾기 목록이 이 위에 같은 모양으로 선다.
    recentTitle: "최근 추천받은 요리",
    dialogTitle: (day, meal) => `${day} ${meal}`,
    close: "닫기",
  },

  // 5개 페이지가 공유하는 머리말 — 건너뛰기 링크, 로고, 햄버거, 메뉴
  NAV: {
    skip: "본문 바로가기",
    brandAria: "있는대로 홈으로",
    menuAria: "메뉴 열기",
    home: "홈",
    pantry: "냉장고",
    recipe: "레시피 추천",
    mealplan: "식단 계획",
    shopping: "장보기",
  },

  // index.html 섹션 제목
  HOME: {
    stepsTitle: "이렇게 쓰면 돼요",
    faqTitle: "자주 묻는 질문",
  },

  /* 기록 옮기기. 계정도 서버도 없어서 이 브라우저를 벗어나면 전부 사라지는데, 그동안
     쌓아둔 절약 기록까지 함께 없어지는 것은 아깝다. 파일 하나로 들고 다니게 한다.

     실패 문구는 무엇이 잘못됐는지가 아니라 무엇을 하면 되는지로 끝낸다(C1·C8). */
  BACKUP: {
    title: "기록 옮기기",
    intro:
      "냉장고·식단·즐겨찾기·아낀 돈까지, 이 브라우저에 저장된 것을 파일 하나로 내려받아요. " +
      "브라우저를 바꾸거나 지우기 전에 받아두면 그대로 되살릴 수 있어요.",
    export: "파일로 내보내기",
    import: "파일에서 가져오기",

    // 되돌릴 수 없는 조작이라 여기서만 한 번 묻는다(A4)
    confirm: "지금 이 브라우저의 기록이 전부 파일 내용으로 바뀌어요. 계속할까요?",

    exported: (fileName) => `${fileName} 파일로 내려받았어요.`,
    imported: "가져왔어요. 화면을 새로 불러올게요.",
    canceled: "가져오기를 멈췄어요. 지금 기록은 그대로예요.",

    nothing: "아직 저장할 기록이 없어요. 냉장고에 재료를 넣어보면 여기에 담을 것이 생겨요.",
    broken: "파일을 읽지 못했어요. 내보내기로 받은 파일이 맞는지 확인해주세요.",
    notOurs: "있는대로에서 내보낸 파일이 아닌 것 같아요. 내보내기로 받은 파일을 골라주세요.",
    tooNew: "더 새로운 버전에서 내보낸 파일이에요. 페이지를 새로고침한 뒤 다시 시도해주세요.",
    empty: "파일에 담긴 기록이 없어요. 다른 파일을 골라주세요.",
    failed: "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요.",
  },

  /* 자주 묻는 질문. 마지막 답에는 링크가 들어가는데, 문구를 화면에 붙이는 쪽은
     안전을 위해 innerHTML을 쓰지 않아 <a>를 만들어내지 못한다. 그래서 그 항목만
     앞뒤로 쪼개 둔다 — PANTRY.amountHint를 셋으로 나눠둔 것과 같은 방식이다. */
  FAQ: [
    {
      q: "재료를 정확한 계량으로 입력해야 하나요?",
      a: '아니요. "계란 2개, 대파 조금"처럼 대략적으로만 입력해도 됩니다.',
    },
    {
      q: "추천 결과가 이상하거나 안 나오면 어떻게 하나요?",
      a: '재료를 조금 더 구체적으로 입력하거나, 잠시 후 다시 시도해보세요. 서버가 혼잡하거나 응답이 지연되는 경우 안내 메시지가 표시됩니다. 이전에 추천받은 요리가 있다면 "최근 받은 요리"에서 다시 확인할 수 있습니다.',
    },
    {
      q: "제 재료 정보가 저장되나요?",
      a: '"냉장고"에 넣어둔 재료는 편의를 위해 이 브라우저의 로컬 저장소(localStorage)에만 저장됩니다. 서버로 전송되거나 다른 사람에게 공개되지 않으며, 언제든 × 버튼으로 삭제할 수 있습니다. 그 외 그날그날 추가로 입력한 재료는 추천을 생성하는 데만 쓰이고 따로 저장되지 않습니다.',
    },
    {
      q: "주간 식단의 장보기 리스트, 쿠팡 장바구니에 자동으로 담기나요?",
      a: '아니요. 리스트의 "쿠팡에서 검색" 링크를 누르면 해당 재료의 쿠팡 검색 결과 페이지가 새 탭으로 열릴 뿐, 장바구니에 자동으로 담거나 결제를 진행하지 않습니다. 실제 담기·구매는 직접 확인하고 진행해주세요.',
    },
    {
      q: "어떤 기술로 만들었나요?",
      // 기술 스택을 묻는 질문이라 여기서는 구현을 그대로 밝힌다(브랜드 규칙의 예외 문맥)
      aHead:
        "프론트엔드는 프레임워크 없이 HTML / CSS / JavaScript로, 백엔드는 Vercel Serverless Functions(Python)로 만들었습니다. 요리 추천에는 OpenAI API를 쓰고, 배포는 Vercel로 합니다. 자세한 구조는 ",
      aLinkLabel: "GitHub 저장소",
      aLinkUrl: "https://github.com/Frost0313z/fridge-chef",
      aTail: "에서 볼 수 있어요.",
    },
  ],

  // 추천·식단 입력 폼
  FORM: {
    portion: "만들 분량",
    portionPerMeal: "한 끼당 만들 분량",
    timeLimit: "희망 조리 시간",
    days: "계획할 일수",
    healthy: "건강 관리 중이에요 (기름지지 않고 칼로리 낮은 요리로)",

    /* 아래는 <option>에 보이는 글자만이다. value 속성은 손대지 않는다 —
       그 값이 그대로 서버 프롬프트로 나가서, 바꾸면 AI가 받는 지시가 달라진다. */
    portionOne: "한 끼",
    portionTwoRecipe: "두 끼 (내일 점심까지)",
    portionTwoMealplan: "두 끼 (다음 끼니까지)",
    portionFew: "3~4끼 (며칠치)",
    timeAny: "상관없음",
    time15: "15분 이내",
    time30: "30분 이내",
    days3: "3일",
    days5: "5일",
    days7: "7일",
  },

  /* 푸터: <footer>에 data-copy="FOOTER.line" 하나만 붙인다 (태그라인+저작권 한 줄로 병합, 2026-08-14 결정).
     LinkedIn 링크는 <a data-copy="FOOTER.linkedinLabel" data-copy-href="FOOTER.linkedinUrl"
     aria-label="{FOOTER.linkedinAriaLabel}"> 로 연결 — 링크 텍스트는 브랜드명이 아니라 제작자 실명("두승현")을 노출해
     이름을 각인시킨다. 이메일 등 개인 연락처는 노출하지 않기로 결정 — LinkedIn만 공개.
     기존 tagline/copyright 두 필드는 line 하나로 합쳐졌다 — HTML의 두 data-copy 엘리먼트도
     하나로 합쳐야 한다 (이 변경은 Claude Code 쪽에서 마크업까지 같이 처리). */
  FOOTER: {
    line: "냉장고에 있는 대로, 오늘 한끼 완성 · © " + new Date().getFullYear() + " 있는대로",
    linkedinLabel: "제작자 링크드인: 두승현",
    linkedinAriaLabel: "두승현의 LinkedIn 프로필로 이동",
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

    /* data-copy-attr는 두 가지 꼴을 받는다.

         "placeholder"                         data-copy의 값을 그 속성에 넣는다. 글자는 채우지 않는다
         "aria-label:FOOTER.linkedinAriaLabel" 콜론 뒤 경로의 값을 그 속성에 넣는다. 글자는 data-copy가 채운다

       뒤 꼴이 필요한 이유는 링크 때문이다. 보이는 글자("두승현")와 화면 낭독기가
       읽어주는 이름("두승현의 LinkedIn 프로필로 이동")이 서로 다른 문구라,
       앞 꼴로는 둘 중 하나만 채울 수 있다. */
    const attrSpec = el.dataset.copyAttr;
    let attrTakesText = false;
    if (attrSpec) {
      const sep = attrSpec.indexOf(":");
      if (sep === -1) {
        attrTakesText = true;
      } else {
        const value = copyText(attrSpec.slice(sep + 1));
        if (typeof value === "string") el.setAttribute(attrSpec.slice(0, sep), value);
      }
    }

    if (!el.dataset.copy) return;
    const text = copyText(el.dataset.copy);
    if (typeof text !== "string") return;
    if (attrTakesText) el.setAttribute(attrSpec, text);
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
