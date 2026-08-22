/* MEALPLAN_KEY와 loadSavedPlan()은 장보기 페이지도 읽으므로 shared.js에 있다.
   장보기 리스트 렌더는 js/shopping.js로 옮겼다. */
const MP_REQUEST_TIMEOUT_MS = 30000;

/* 서버(api/mealplan.py)의 MEALS와 순서·이름이 같아야 자리가 맞는다. */
const MEALS = ["아침", "점심", "저녁"];

/* 끼니마다 라벨 색이 다르다. 클래스 이름을 한글로 만들지 않으려고 여기서 한 번 옮긴다. */
const MEAL_CLASS = { 아침: "morning", 점심: "noon", 저녁: "night" };

/* 이모지 대신 단색 SVG를 쓴다(CLAUDE.md). 둘 다 뜻은 옆 글자가 지므로 aria-hidden이다 —
   "해먹었어요"와 "자세히 보기"를 아이콘이 다시 읽어주면 같은 말이 두 번 들린다. */
const CHECK_ICON = `<svg class="meal-brief-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>`;
const CHEVRON_ICON = `<svg class="meal-open-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5"/></svg>`;

/* 화면이 고쳐 쓰는 대상. 넣기·옮기기·삭제가 이 배열 하나만 바꾸고 다시 그린다. */
let planItems = [];
let planShoppingList = [];

/* 장보기 목록을 뽑을 때의 냉장고. 목록의 수량은 "그때 기준으로 부족한 만큼"이라,
   그 뒤에 냉장고가 얼마나 늘었는지를 알아야 장보기 화면이 남은 양을 계산할 수 있다.
   이게 없으면 "샀어요"를 눌러도 목록이 줄지 않는다. */
let planPantryAt = null;

/* 1일차가 며칠이었는지(YYYY-MM-DD). 화면에 실제 날짜와 요일을 적기 위한 기준점이다.
   모르면 null이고, 그때는 예전처럼 "1일차"로 보여준다. */
let planStartDate = null;

/* 평소에는 읽는 화면이다. 9칸마다 조작 버튼을 띄워두면 정작 "이번 주 뭐 먹지"가 안 읽힌다.
   고치는 동안에만 조작을 꺼낸다. */
let editMode = false;
/* 고르고 → 놓기. 드래그와 달리 마우스·터치·키보드가 모두 같은 경로로 동작한다. */
let selectedIndex = null;

/* 지금 메뉴를 넣고 있는 빈 자리 {day, meal}. 한 번에 한 자리만 연다 —
   9칸에 입력창을 동시에 띄우면 어디에 넣는 중인지 알 수 없다. */
let addingSlot = null;

/* 왼쪽 고르기 목록이나 "이번 주 후보"에서 든 것. 그리드 내부 이동(selectedIndex)과
   같은 "고르고 → 놓기"를 쓰지만, 아직 planItems에 없는 것(왼쪽 목록)까지 다뤄야 해서
   따로 둔다. { type: 'new', recipe } | { type: 'existing', index } | null.
   selectedIndex/addingSlot과는 항상 셋 중 하나만 켜져 있다 — setHeldPick·setEditMode·
   그리드 내부 고르기가 서로를 지운다.
   selectedRecipe(아래)와는 다른 상태다 — heldPick은 "요일에 놓기"를 눌러야 켜지는
   배치용이고, selectedRecipe는 왼쪽 줄을 누르기만 해도 켜지는 열람용이다. */
let heldPick = null;

/* 왼쪽 레시피 리스트에서 지금 상세 보기에 띄운 줄. 줄을 누르면 바로 켜진다(즐겨찾기
   다이얼로그의 좌=목록/우=상세와 같은 클릭 한 번 전환). { source, index, recipe } | null. */
let selectedRecipe = null;

/* 왼쪽 두 아코디언이 지금 들고 있는 목록. commitEdit()마다 다시 안 그리는 렌더 함수들이
   fetch 없이 여기서 다시 그린다(renderMealpickLists). */
let mealpickSources = { pantry: [], favorite: [] };

document.addEventListener("DOMContentLoaded", () => {
  const resultEl = document.getElementById("mealplan-result");
  if (!resultEl) return;

  const clearBtn = document.getElementById("mealplan-clear-btn");

  const dialogEl = document.getElementById("meal-dialog");
  const dialogBodyEl = document.getElementById("meal-dialog-body");

  /* 확인을 누르면 그 칸은 해먹은 것이 된다. 되돌리기를 누르면 차감도 표시도 함께 되돌아간다 —
     재료는 돌아왔는데 "해먹었어요"만 남으면 둘이 어긋난다.
     체크리스트가 모달로 옮겨갔으므로 위임도 모달에 건다(예전에는 결과 영역이었다). */
  initCooked(dialogEl, (root, action) => {
    const holder = root.closest("[data-plan-index]");
    const item = holder && planItems[Number(holder.dataset.planIndex)];
    if (item) {
      if (action === "undo") delete item.done;
      else item.done = true;
      savePlanState();
    }
    refreshPlanStates();
  });

  /* "다른 메뉴로 바꾸기" — 9칸 편집 모드를 거치지 않고 이 칸 하나만 바로 바꾸는 지름길.
     모달 본문을 뷰 ↔ 폼으로 갈아 끼우기만 하고, 닫지는 않는다 — "해먹었어요"처럼 결과를
     그 자리에서 보여주는 방식과 맞춘다. dialogIndex는 openMealDialog가 이미 들고 있다. */
  dialogEl.addEventListener("click", (e) => {
    if (e.target.closest(".meal-dialog-swap-btn")) {
      const item = planItems[dialogIndex];
      if (!item) return;
      dialogBodyEl.innerHTML = mealDialogSwapFormHtml(item);
      dialogBodyEl.querySelector("#meal-dialog-swap-input")?.focus();
      return;
    }

    if (e.target.closest(".meal-dialog-swap-cancel")) {
      const item = planItems[dialogIndex];
      if (!item) return;
      dialogBodyEl.innerHTML = mealDialogBodyHtml(item, pantryNamesFor(loadPantry()));
      return;
    }

    /* 즐겨찾기·최근 추천에서 골랐다 — addPicksHtml()이 만든 것과 같은 버튼이라 판별도 같다. */
    const pick = e.target.closest(".meal-add-recent-item");
    if (pick && dialogBodyEl.contains(pick)) {
      const picked =
        pick.dataset.favoriteIndex !== undefined
          ? loadFavorites()[Number(pick.dataset.favoriteIndex)]
          : loadHistory()[Number(pick.dataset.historyIndex)];
      if (picked) {
        swapMeal(dialogIndex, picked.name, picked.searchKeyword, picked.ingredients);
        dialogBodyEl.innerHTML = mealDialogBodyHtml(planItems[dialogIndex], pantryNamesFor(loadPantry()));
      }
      return;
    }

    if (e.target.closest(".meal-dialog-swap-confirm")) {
      const input = dialogBodyEl.querySelector("#meal-dialog-swap-input");
      if (!input) return;
      swapMeal(dialogIndex, input.value);
      dialogBodyEl.innerHTML = mealDialogBodyHtml(planItems[dialogIndex], pantryNamesFor(loadPantry()));
    }
  });

  /* 입력창에서 Enter — 그리드 쪽(#meal-add-input)과 같은 처리를 모달 쪽 입력창에도 준다. */
  dialogBodyEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.id !== "meal-dialog-swap-input") return;
    e.preventDefault();
    swapMeal(dialogIndex, e.target.value);
    dialogBodyEl.innerHTML = mealDialogBodyHtml(planItems[dialogIndex], pantryNamesFor(loadPantry()));
  });

  document.getElementById("meal-dialog-close").addEventListener("click", () => dialogEl.close());

  /* 배경을 눌러 닫는다. 모달이 화면 전체를 덮고 안쪽에 패널이 따로 있어서,
     이벤트 대상이 모달 자신이면 그건 패널 바깥 = 배경을 누른 것이다. */
  dialogEl.addEventListener("click", (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });

  /* 닫기 버튼·배경·Esc 어느 쪽으로 닫혀도 여기로 온다. 초점을 열었던 칸으로 돌려준다 —
     안 돌려주면 키보드만 쓰는 사람은 화면 맨 처음부터 다시 짚어 내려와야 한다.
     버튼을 다시 찾는 이유는 그 사이 그리드가 다시 그려져 새 버튼으로 바뀌었을 수 있어서다. */
  dialogEl.addEventListener("close", () => {
    const opener = document.querySelector(`.meal-open[data-plan-index="${dialogIndex}"]`);
    dialogIndex = null;
    delete dialogBodyEl.dataset.planIndex;
    dialogBodyEl.innerHTML = "";
    if (opener) opener.focus();
  });

  /* 왼쪽 "레시피 리스트" — 언제나 떠 있는 아코디언 2개(냉장고 매칭/즐겨찾기). 줄을 누르면
     그 즉시 오른쪽 "상세 보기"로 전환된다(즐겨찾기 다이얼로그가 하던 좌=목록/우=상세를
     그대로 페이지 섹션으로 옮겼다 — 별도 모달은 없앴다). AI 추천(장보기 필요한 요리)은
     뺐다 — 필요하면 레시피 추천 화면에서 즐겨찾기에 담아 여기서 고르는 편이 더 깔끔하다.
     렌더·로드 함수들은 최상위(top-level)에 두고 매번 document.getElementById로 다시
     찾는다 — setHeldPick 등 여기 DOMContentLoaded 밖의 함수에서도 같이 불러야 해서다
     (mealpickSources도 마찬가지 이유로 파일 위쪽에 둔다). */
  loadMealpickFavorites();
  loadMealpickPantry();

  /* 줄 클릭 = 그 즉시 상세 전환(heldPick의 "고르기"와는 다른 상태 — selectedRecipe 주석
     참고). 담음 표시·요일 배치·넣기·빼기는 전부 오른쪽 상세 보기(#mealpick-detail)의 일이다. */
  document.getElementById("mealpick-pane").addEventListener("click", (e) => {
    const selectBtn = e.target.closest(".favorites-list-select");
    if (!selectBtn) return;
    const source = selectBtn.dataset.source;
    const index = Number(selectBtn.dataset.index);
    const recipe = mealpickSources[source][index];
    if (!recipe) return;
    selectedRecipe = { source, index, recipe };
    renderMealpickLists();
    renderMealpickDetail();
  });

  /* 상세 보기의 조작 — 계획에 넣기/빼기, 요일에 놓기. "해먹었어요"는 따로 initCooked로
     건다(그리드 모달과 같은 자리, 같은 방식). */
  const mealpickDetailEl = document.getElementById("mealpick-detail");
  mealpickDetailEl.addEventListener("click", (e) => {
    if (!selectedRecipe) return;
    const recipe = selectedRecipe.recipe;

    if (e.target.closest(".mealpick-add-btn")) {
      addToPool(recipe);
      return;
    }

    if (e.target.closest(".mealpick-remove-btn")) {
      const index = poolIndexFor(recipe);
      if (index !== -1) deleteMeal(index);
      return;
    }

    if (e.target.closest(".mealpool-pick-btn")) {
      const index = poolIndexFor(recipe);
      if (index !== -1) {
        const already = heldPick && heldPick.type === "existing" && heldPick.index === index;
        setHeldPick(already ? null : { type: "existing", index });
      } else {
        const already = heldPick && heldPick.type === "new" && heldPick.recipe && heldPick.recipe.name === recipe.name;
        setHeldPick(already ? null : { type: "new", recipe });
      }
    }
  });

  initCooked(mealpickDetailEl, (root, action) => {
    const holder = root.closest("[data-plan-index]");
    const item = holder && planItems[Number(holder.dataset.planIndex)];
    if (item) {
      if (action === "undo") delete item.done;
      else item.done = true;
      savePlanState();
    }
    refreshPlanStates();
  });

  /* 냉장고는 조회 바에서도 바뀐다(추가·삭제·되돌리기). 부족 여부를 저장하지 않고 그때그때
     세므로, 바뀔 때 상태 줄만 다시 그리면 양쪽 방향이 모두 맞는다. */
  onPantryChanged(refreshPlanStates);

  const editBtn = document.getElementById("mealplan-edit-btn");

  const saved = loadSavedPlan();
  if (saved) {
    /* 세 끼로 나누기 전에 저장된 계획에는 meal이 없다. 저녁으로 본다 — 그때 계획한 게 저녁이었다. */
    planItems = saved.plan
      .filter((i) => i && i.menu)
      .map((i) => ({ ...i, meal: MEALS.includes(i.meal) ? i.meal : "저녁" }));
    planShoppingList = Array.isArray(saved.shoppingList) ? saved.shoppingList : [];
    /* 빈 냉장고([])와 "옛 저장분이라 모름"(null)은 다르다. 뒤엣것은 뺄 기준이 없다는 뜻이다. */
    planPantryAt = Array.isArray(saved.pantryAt) ? saved.pantryAt : null;
    /* 시작일을 적어두기 전에 저장된 계획은 마지막 저장 시각으로 대신한다. 계획을 만든 날과
       정확히 같지는 않지만, "1일차"만 덩그러니 두는 것보다 낫다. 다음 저장 때 startDate로
       굳으므로 그 뒤로는 흔들리지 않는다. */
    planStartDate =
      typeof saved.startDate === "string" ? saved.startDate : localDateOf(saved.savedAt);
  }
  /* 그리드는 더 이상 "식단 짜기"를 눌러야 생기지 않는다 — 항상 오늘/내일/모레 빈 칸으로
     떠 있고, 왼쪽에서 고르거나 담는 순간 실제로 저장된다(여기서는 localStorage에 아무것도
     안 쓴다 — commitEdit()가 실제 담긴 것을 쓸 때 비로소 저장된다). */
  if (!planStartDate) planStartDate = todayISO();
  shiftPlanForToday();
  renderPlan();
  renderMealpickDetail();

  clearBtn.addEventListener("click", () => {
    if (!confirm(COPY.UI.mealplanClearConfirm)) return;
    localStorage.removeItem(MEALPLAN_KEY);
    planItems = [];
    planShoppingList = [];
    planPantryAt = null;
    /* null로 두면 그리드가 사라진다 — 항상 떠 있어야 하므로 오늘로 다시 채운다. */
    planStartDate = todayISO();
    selectedRecipe = null;
    setEditMode(false); // heldPick도 같이 지우고 renderPlan()까지 한다
    renderMealpickLists();
    renderMealpickDetail();
  });

  editBtn.addEventListener("click", () => setEditMode(!editMode));

  /* 조작은 매번 새로 그리는 카드 위에서 일어나므로 컨테이너에 한 번만 건다. */
  resultEl.addEventListener("click", (e) => {
    /* 읽기 모드에서 칸을 눌렀다 — 그 칸의 상세를 연다. */
    const open = e.target.closest(".meal-open");
    if (open) {
      openMealDialog(Number(open.dataset.planIndex));
      return;
    }

    const del = e.target.closest(".meal-delete");
    if (del) {
      /* 메뉴가 하나도 안 남아도 요일 칸은 그대로 3개 남는다 — 거기에 다시 넣을 수 있어야
         한다. 계획을 진짜로 없애는 건 "계획 지우기"의 일이다. */
      deleteMeal(Number(del.dataset.index));
      return;
    }

    /* 빈 자리에 메뉴를 직접 넣는다. 여는 것과 닫는 것 모두 그 자리에서 끝난다. */
    const add = e.target.closest(".meal-add");
    if (add) {
      openAddSlot(add.dataset.day, add.dataset.meal);
      return;
    }

    if (e.target.closest(".meal-add-cancel")) {
      addingSlot = null;
      renderPlan();
      return;
    }

    if (e.target.closest(".meal-add-confirm")) {
      submitAddSlot();
      return;
    }

    /* 즐겨찾기나 최근 추천에서 골랐다 — 이름뿐 아니라 검색어·재료까지 그대로 가져온다.
       그래야 레시피 링크가 걸리고, 장보기를 다시 뽑을 때도 이 메뉴의 재료가 반영된다.
       두 목록은 같은 모양의 버튼이고 어느 배열에서 꺼낼지만 다르다. */
    const addPick = e.target.closest(".meal-add-recent-item");
    if (addPick) {
      const picked =
        addPick.dataset.favoriteIndex !== undefined
          ? loadFavorites()[Number(addPick.dataset.favoriteIndex)]
          : loadHistory()[Number(addPick.dataset.historyIndex)];
      if (picked) addMeal(picked.name, picked.searchKeyword, picked.ingredients);
      return;
    }

    /* 빈 자리를 눌렀다 — 왼쪽에서 골랐거나(heldPick) 그리드 안에서 골랐던(selectedIndex)
       것을 여기로 놓는다. 렌더는 heldPick이 있을 때만 이 자리를 .meal-drop으로 만들므로
       (mealSlotHtml 참고), 여기 오는 건 둘 중 하나가 이미 있을 때뿐이다. */
    const drop = e.target.closest(".meal-drop");
    if (drop) {
      if (heldPick) {
        placeHeldPick(drop.dataset.day, drop.dataset.meal);
      } else if (selectedIndex !== null) {
        const from = selectedIndex;
        selectedIndex = null;
        moveMeal(from, drop.dataset.day, drop.dataset.meal);
      }
      return;
    }

    const pick = e.target.closest(".meal-pick");
    if (!pick) return;
    const index = Number(pick.dataset.index);

    /* 그리드 안에서 새로 고르면 왼쪽에서 들고 있던 것은 놓는다 — 셋 중 하나만 켜져
       있어야 한다(setHeldPick과 같은 규칙). */
    if (heldPick) {
      heldPick = null;
      renderMealpickDetail();
    }

    if (selectedIndex === null || selectedIndex === index) {
      // 고르기, 또는 같은 걸 다시 눌러 고르기 취소
      selectedIndex = selectedIndex === null ? index : null;
      renderPlan();
      return;
    }

    /* 다른 메뉴 위에 놓았다 — 서로 자리를 맞바꾼다. */
    const from = selectedIndex;
    const target = planItems[index];
    selectedIndex = null;
    moveMeal(from, target.day, target.meal);
  });

  /* 메뉴 이름을 적고 Enter. 폼 밖이라 제출될 일은 없지만 줄바꿈도 만들지 않는다. */
  resultEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.closest(".meal-add-input")) {
      e.preventDefault();
      submitAddSlot();
    }
  });
});

/* 한 자리씩만 연다. 다른 자리를 열면 적던 것은 버린다 —
   두 자리에 반쯤 적힌 상태가 남으면 어디에 넣는 중인지 알 수 없다. */
function openAddSlot(day, meal) {
  addingSlot = { day, meal };
  selectedIndex = null;
  renderPlan();

  /* 다시 그리면서 입력칸이 새로 생긴다. 누른 자리에 바로 적을 수 있게 초점을 옮긴다. */
  const input = document.querySelector(".meal-add-input");
  if (input) input.focus();
}

function submitAddSlot() {
  const input = document.querySelector(".meal-add-input");
  if (input) addMeal(input.value);
}

/* 빈 자리에 메뉴 한 칸을 만든다. 재료는 묻지 않는다 — 9칸마다 재료까지 적게 하면
   손으로 넣는 편이 다시 계획하는 것보다 번거로워진다. 재료가 비어 있으면 장보기를
   다시 뽑을 때 서버가 그 메뉴의 재료만 AI에게 물어 채운다(api/mealplan.py). */
function addMeal(menu, searchKeyword, ingredients) {
  if (!addingSlot) return;

  const name = String(menu || "").trim();
  if (!name) {
    editNotice = COPY.MEALPLAN.nameRequired;
    renderEditStatus();
    const input = document.querySelector(".meal-add-input");
    if (input) input.focus();
    return;
  }

  planItems.push({
    day: addingSlot.day,
    meal: addingSlot.meal,
    menu: name,
    searchKeyword: String(searchKeyword || "").trim(),
    ingredients: Array.isArray(ingredients) ? ingredients : [],
  });
  addingSlot = null;
  commitEdit();
}

/* 편집 모드에서만 조작이 나타난다. 모드를 끄면 고르던 것과 적던 것도 함께 푼다. */
function setEditMode(on) {
  editMode = on;
  selectedIndex = null;
  addingSlot = null;
  if (heldPick) {
    heldPick = null;
    renderMealpickDetail();
  }

  const btn = document.getElementById("mealplan-edit-btn");
  if (btn) {
    btn.textContent = on ? COPY.UI.editMenuDone : COPY.UI.editMenu;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("is-on", on);
  }
  renderPlan();
}

/* 다음 렌더 한 번만 보여주고 지우는 문구. 조작이 아무 일도 하지 않았을 때 쓴다 —
   버튼을 눌렀는데 화면이 그대로면 사용자는 고장으로 읽는다(C3). */
let editNotice = "";

/* 지금 무엇을 해야 하는지 한 줄로 알린다. role="status"라 화면을 보지 않아도 읽힌다. */
function renderEditStatus() {
  const el = document.getElementById("mealplan-edit-status");
  if (!el) return;

  /* editNotice(예: "담기" 확인)와 heldPick(왼쪽 고르기·후보 배치)은 "메뉴 바꾸기"를
     안 켜도 뜬다 — 편집 모드 밖에서 일어나는 조작이라 여기서 조건을 먼저 본다. */
  if (editNotice) {
    el.textContent = editNotice;
    editNotice = "";
    el.hidden = false;
    return;
  }

  if (heldPick) {
    const name = heldPick.type === "existing" ? planItems[heldPick.index]?.menu : heldPick.recipe.name;
    el.textContent = COPY.MEALPLAN.holding(name || "");
    el.hidden = false;
    return;
  }

  if (!editMode) {
    el.hidden = true;
    return;
  }

  /* 칸마다 붙이던 설명("여기와 맞바꾸기", "다시 누르면 취소", "여기로 옮기기")을 여기로 모았다.
     같은 문장이 21번 반복되면 화면이 안내문으로 뒤덮이고, 정작 메뉴 이름이 안 읽힌다.
     어느 칸을 들고 있는지는 색이 말하고, 무엇을 할 수 있는지는 이 한 줄이 말한다. */
  const picked = selectedIndex !== null ? planItems[selectedIndex] : null;
  if (picked) {
    el.textContent =
      `"${picked.menu}"을(를) 들었어요. 옮길 자리를 누르세요. ` +
      `이미 메뉴가 있는 자리를 누르면 서로 바뀌고, 색이 칠해진 "${picked.menu}"을(를) 다시 누르면 취소됩니다.`;
  } else if (addingSlot) {
    /* 아래 목록이 즐겨찾기와 최근 추천 둘로 늘었다. 한쪽만 가리키면 다른 쪽을 안 본다. */
    el.textContent = `${dayInfo(addingSlot.day, planStartDate).label} ${addingSlot.meal}에 넣을 메뉴를 적거나, 아래에서 고르세요.`;
  } else {
    el.textContent =
      "옮길 메뉴를 누르세요. 빈 자리를 누르면 메뉴를 직접 넣고, 옆의 × 를 누르면 지웁니다.";
  }
  el.hidden = false;
}

/* 계획을 고치면 장보기 목록은 더 이상 이 계획의 것이 아니다.
   edited로 표시해두고, 장보기 화면이 "다시 뽑기"를 권한다. */
function savePlan(edited) {
  return saveJson(MEALPLAN_KEY, {
    plan: planItems,
    shoppingList: planShoppingList,
    /* 목록을 뽑을 때의 냉장고. 계획을 고쳐도 목록과 함께 그대로 따라가야
       장보기 화면이 "그 뒤로 얼마나 채웠는지"를 잴 수 있다. */
    pantryAt: planPantryAt,
    /* 1일차가 며칠이었는지. 고칠 때마다 오늘로 새로 찍으면 계획이 매일 하루씩 밀린다. */
    startDate: planStartDate,
    edited: Boolean(edited),
    savedAt: new Date().toISOString(),
  });
}

function commitEdit() {
  if (!planItems.length) {
    localStorage.removeItem(MEALPLAN_KEY);
  } else {
    savePlan(true);
  }
  renderPlan();
  /* 담김 여부(poolIndexFor)가 planItems에 따라 갈리므로, 넣기·빼기·배치·삭제 어느 쪽으로
     바뀌었든 왼쪽 "담음" 표시와 오른쪽 상세의 버튼 상태를 같이 다시 그린다. */
  renderMealpickLists();
  renderMealpickDetail();
}

/* 목적지가 비어 있으면 옮기고, 이미 메뉴가 있으면 서로 자리를 맞바꾼다.
   덮어쓰면 사용자가 의도하지 않은 삭제가 되고, 되돌릴 방법도 없다. */
function moveMeal(index, day, meal) {
  const moving = planItems[index];
  if (!moving) return;

  const occupant = planItems.find((i) => i !== moving && i.day === day && i.meal === meal);
  if (occupant) {
    occupant.day = moving.day;
    occupant.meal = moving.meal;
  }
  moving.day = day;
  moving.meal = meal;
  commitEdit();
}

function deleteMeal(index) {
  if (!planItems[index]) return;
  planItems.splice(index, 1);
  commitEdit();
}

/* 상세 모달의 "다른 메뉴로 바꾸기" 전용 — 그 칸 하나만 제자리에서 바꾼다. addMeal처럼
   push하지 않는 이유는, 이미 채워진 칸에 push하면 같은 day/meal이 중복되기 때문이다. */
function swapMeal(index, menu, searchKeyword, ingredients) {
  const item = planItems[index];
  if (!item) return;
  const trimmed = String(menu || "").trim();
  if (!trimmed) return;
  item.menu = trimmed;
  item.searchKeyword = searchKeyword || "";
  item.ingredients = ingredients || [];
  commitEdit();
}

/* 요일 칸은 항상 오늘·내일·모레 세 개 고정이다 — 일주일치는 한눈에 보기엔 너무 많다.
   planStartDate가 없으면 아직 "식단 짜기"를 한 번도 안 누른 것이라 빈 배열을 돌려준다
   (setPlanVisible(false) 상태와 맞는다). */
function dayLabels() {
  if (!planStartDate) return [];
  return Array.from({ length: 3 }, (_, n) => dayInfo(`${n + 1}일차`, planStartDate));
}

/* 날짜 이름을 만드는 일은 shared.js가 한다 — 장보기 화면도 "이 재료가 언제 쓰이는지"를
   같은 말로 적어야 하기 때문이다. 한쪽만 "1일차"로 남으면 방금 없앤 혼란이 되살아난다. */

/* dayInfo()의 "열쇠(1일차 등)는 그대로 두고 화면 이름만 만든다" 원칙과 달리, 여기서는
   실제로 day 값 자체를 당긴다 — 자정을 넘겨 다시 열면(하루 이상 지나면) "오늘"이었던
   칸은 이미 지난 끼니라 지우고, "내일"이 새 "오늘"이 되도록 나머지를 앞으로 민다.
   day 없는 후보("이번 주 후보", D-0y)는 요일과 무관하므로 손대지 않는다.
   페이지를 열 때마다 한 번만 부른다 — 탭을 밤새 열어둔 채 자정을 넘기는 것까지는
   따라가지 않는다(다음에 새로고침하거나 다시 열 때 맞춰진다). */
function shiftPlanForToday() {
  if (!planStartDate) return;
  const today = todayISO();
  const elapsed = Math.round(
    (new Date(`${today}T00:00:00`) - new Date(`${planStartDate}T00:00:00`)) / 86400000
  );
  if (elapsed <= 0) return;

  planItems = planItems
    .map((item) => {
      if (!item.day) return item;
      const shifted = parseInt(item.day, 10) - elapsed;
      return shifted >= 1 ? { ...item, day: `${shifted}일차` } : null;
    })
    .filter(Boolean);
  planStartDate = today;
  commitEdit();
}

function renderPlan() {
  const resultEl = document.getElementById("mealplan-result");
  if (!resultEl) return;

  /* 다시 그리면 안쪽이 통째로 교체돼 스크롤이 오늘로 돌아간다. 편집은 조작할 때마다
     다시 그리기를 부르므로, 좁은 화면에서 모레를 고치는 동안 화면이 매번 맨 앞으로
     튀어버린다. 밀어둔 위치를 넘겨받아 되돌린다. */
  const previous = resultEl.querySelector(".mealplan-days");
  const keptScroll = previous ? previous.scrollLeft : 0;

  /* 세 칸이라 대부분 화면엔 다 들어오지만, 좁은 화면에선 여전히 밀어야 할 수 있다.
     가로로 미는 영역은 초점을 받을 수 있어야 키보드에서도 화살표로 밀 수 있다(WCAG 2.1.1).
     읽기 모드에서 메뉴가 다 비어 있으면 안에 초점 갈 요소가 하나도 없어, 이게 없으면
     키보드만 쓰는 사람은 모레를 볼 방법이 사라진다. */
  const days = dayLabels();
  /* "이거 해먹었어요"가 물을 재료를 고르는 기준. 그릴 때마다 다시 읽어 항상 지금의 냉장고를 쓴다
     — 추천 카드의 보유 표시와 같은 규칙이다. */
  const pantryNames = pantryNamesFor(loadPantry());
  resultEl.innerHTML = `<div class="mealplan-days${editMode ? " is-editing" : ""}"
    tabindex="0" role="group" aria-label="식단 계획">${days
    .map(
      (day, i) => `
      <article class="mealplan-day-card${i === 0 ? " is-today" : ""}">
        <h3>${escapeHtml(day.label)}</h3>
        ${MEALS.map((meal) => mealSlotHtml(day, meal, pantryNames)).join("")}
      </article>`
    )
    .join("")}</div>`;

  const daysEl = resultEl.querySelector(".mealplan-days");
  daysEl.scrollLeft = keptScroll;
  enableDragScroll(daysEl);

  renderStaleNotice(days);
  renderEditStatus();
}

/* 날짜를 적고 나니 "지난 계획"이 눈에 보이게 됐다. "1일차"였을 때는 언제 짠 것인지 알 길이
   없어서 묵은 계획도 새것처럼 보였는데, 이제는 지난주 날짜가 그대로 드러난다.
   보이는 이상 왜 그런지도 말해주는 편이 낫다 — 아니면 "날짜가 왜 이래?"가 된다. */
function renderStaleNotice(days) {
  const el = document.getElementById("mealplan-stale");
  if (!el) return;

  const last = days.length ? dayDate(planStartDate, days.length - 1) : null;
  el.hidden = !last || last >= new Date(`${todayISO()}T00:00:00`);
}

/* ==========================================================================
   이번 주 후보 — 요일 배정 없이도 planItems에 같이 담긴다(day 없음, D-0y). mealSlotHtml은
   day 없는 항목을 절대 찾지 못해 그리드에는 저절로 안 보인다. 후보를 훑어보던 목록
   화면은 없앴고, poolIndexFor로 이름을 찾아 오른쪽 상세 보기 하나에서 다룬다.
   ========================================================================== */
/* "지금 냉장고로 만들 수 있는 요리" 소스. matchOnly:true라 서버가 AI로 채우지 않는다
   (api/recommend.py) — 매칭이 적으면 그대로 적게(또는 0개) 돌려받는다. */
async function fetchPoolPantryMatches() {
  const ingredients = loadPantry()
    .map(pantryPromptText)
    .join(", ");
  if (!ingredients) return [];
  const result = await postJson("/api/recommend", { ingredients, matchOnly: true }, MP_REQUEST_TIMEOUT_MS);
  return result.ok ? result.data.recipes || [] : [];
}

/* 이 레시피 이름과 같은, 아직 요일이 없는 planItems 항목의 인덱스. 없으면 -1이다.
   day-less 항목은 이 이름으로만 찾는다 — "이번 주 후보"에 같은 이름이 중복으로 쌓이는
   일은 상세 보기의 넣기/빼기 토글이 막아준다(이미 담겼으면 넣기 버튼 자체가 안 뜬다). */
function poolIndexFor(recipe) {
  return planItems.findIndex((i) => !i.day && i.menu === recipe.name);
}

/* 그리드 내부 이동과 같은 "고르고 → 놓기"다 — 눌러서 든 뒤 빈 요일 칸을 누르면 놓인다
   (heldPick, resultEl의 .meal-drop 처리 참고). 채워진 자리는 mealSlotHtml이 애초에
   .meal-drop을 안 만들어서 선택지에서 자연히 빠진다(예상 못 할 자리 바꿈 방지).
   빈 자리가 하나도 없을 때만 이유를 알려준다. poolIndex가 없으면(아직 안 담김) heldPick을
   곧장 { type: 'new' }로 세운다 — 담기를 거치지 않고 바로 요일에 놓을 수도 있어야 한다. */
function placeButtonHtml(recipe, poolIndex) {
  const hasEmptySlot = dayLabels().some((day) =>
    MEALS.some((meal) => !planItems.some((i) => i.day === day.key && i.meal === meal))
  );
  if (!hasEmptySlot) {
    return `<span class="mealpool-noslot">${escapeHtml(COPY.MEALPOOL.noSlot)}</span>`;
  }

  const picked =
    poolIndex !== -1
      ? heldPick && heldPick.type === "existing" && heldPick.index === poolIndex
      : heldPick && heldPick.type === "new" && heldPick.recipe && heldPick.recipe.name === recipe.name;
  return `<button type="button" class="link-button mealpool-pick-btn" aria-pressed="${picked}">${escapeHtml(
    picked ? COPY.MEALPOOL.pickButtonCancel : COPY.MEALPOOL.pickButton
  )}</button>`;
}

function detailActionsHtml(recipe, poolIndex) {
  const toggleBtn =
    poolIndex !== -1
      ? `<button type="button" class="link-button link-button-muted mealpick-remove-btn">${escapeHtml(
          COPY.MEALPOOL.removeButton
        )}</button>`
      : `<button type="button" class="link-button mealpick-add-btn">${escapeHtml(
          COPY.MEALPOOL.confirmButton
        )}</button>`;
  return `<div class="mealpool-actions">${toggleBtn}${placeButtonHtml(recipe, poolIndex)}</div>`;
}

/* 즐겨찾기 다이얼로그가 쓰던 상세 렌더(재료+조리법)를 그대로 옮겨온다 —
   조리법·링크 갈림길은 shared.js의 recipeStepsOrLinkHtml이 recipe.js 카드와 함께 쓴다. */
function recipeDetailHtml(r) {
  const timeHtml = r.time ? `<p class="recipe-time">⏱ ${escapeHtml(r.time)}</p>` : "";
  const ingredientsHtml = (r.ingredients || []).length
    ? `<h4>${escapeHtml(COPY.FAVORITES.detailIngredients)}</h4>
       <ul>${r.ingredients.map((ing) => `<li>${escapeHtml(ing)}</li>`).join("")}</ul>`
    : "";
  return `<h3 class="favorites-detail-name">${escapeHtml(r.name)}</h3>${timeHtml}${ingredientsHtml}${recipeStepsOrLinkHtml(r)}`;
}

/* 오른쪽 "상세 보기" 전체를 다시 그린다. selectedRecipe가 day-less 후보로도 담겨 있으면
   "해먹었어요"까지 같이 보여준다(day-plan-index를 패널 자체에 얹어 initCooked가 찾는다) —
   그리드에 배치된 뒤에는 그리드 칸·모달이 그 역할을 이어받으므로 여기선 다루지 않는다. */
function renderMealpickDetail() {
  const el = document.getElementById("mealpick-detail");
  if (!el) return;

  if (!selectedRecipe) {
    delete el.dataset.planIndex;
    el.innerHTML = `<p class="favorites-detail-empty">${escapeHtml(COPY.MEALPOOL.empty)}</p>`;
    return;
  }

  const recipe = selectedRecipe.recipe;
  const poolIndex = poolIndexFor(recipe);
  const item = poolIndex !== -1 ? planItems[poolIndex] : null;
  if (item) el.dataset.planIndex = poolIndex;
  else delete el.dataset.planIndex;

  const pantryNames = pantryNamesFor(loadPantry());
  const stateHtml = item ? mealStateHtml(item, pantryNames) : "";
  const cooked = item && !item.done ? cookedHtml(item.ingredients, pantryNames) : "";
  el.innerHTML = `${recipeDetailHtml(recipe)}${stateHtml}${detailActionsHtml(recipe, poolIndex)}${cooked}`;
}

/* ==========================================================================
   왼쪽 "레시피 리스트" — 냉장고 매칭·즐겨찾기 두 소스.
   ========================================================================== */
/* .favorites-list-item/.favorites-list-select(원래 즐겨찾기 다이얼로그, css/style.css)를
   그대로 가져다 쓴다 — 형제 버튼 없이 이름 하나만 누르는 줄이라 잘 맞는다. 선택 표시는
   is-selected(즐겨찾기 다이얼로그와 같은 클래스), 이미 후보로 담긴 것은 CHECK_ICON +
   담음 배지로 얹는다. */
function mealpickRowHtml(r, source, i) {
  const selected = selectedRecipe && selectedRecipe.source === source && selectedRecipe.index === i;
  const pooled = poolIndexFor(r) !== -1;
  const label = pooled ? `${r.name} (${COPY.MEALPOOL.pooledBadge})` : r.name;
  return `<li class="favorites-list-item${selected ? " is-selected" : ""}">
    <button type="button" class="favorites-list-select" data-source="${source}" data-index="${i}"
      aria-pressed="${selected}" aria-label="${escapeHtml(label)}">
      ${pooled ? CHECK_ICON : ""}<span class="favorites-list-name" aria-hidden="true">${escapeHtml(r.name)}</span>
    </button>
  </li>`;
}

/* is-selected·담음 표시만 새로 그린다 — commitEdit()마다는 이 함수가 다시 불리지만
   fetch는 안 한다, mealpickSources 캐시에서 다시 그리는 것뿐이다. */
function renderMealpickLists() {
  const favoritesEl = document.getElementById("mealpick-favorites-list");
  const pantryEl = document.getElementById("mealpick-pantry-list");
  if (favoritesEl) favoritesEl.innerHTML = mealpickSources.favorite.map((r, i) => mealpickRowHtml(r, "favorite", i)).join("");
  if (pantryEl) pantryEl.innerHTML = mealpickSources.pantry.map((r, i) => mealpickRowHtml(r, "pantry", i)).join("");
}

/* 목록을 그리는 일은 renderMealpickLists() 하나뿐이다 — 여기서는 캐시와 빈 상태만
   세운다. 그리는 줄을 여기에도 두면 행 모양을 고칠 때 세 곳을 같이 고쳐야 한다. */
function loadMealpickFavorites() {
  mealpickSources.favorite = loadFavorites();
  document.getElementById("mealpick-favorites-empty").hidden = mealpickSources.favorite.length > 0;
  renderMealpickLists();
}

/* 즐겨찾기 목록·냉장고 매칭과 같은 이유로 즉시 그리고 바로 보인다(C3) — 서버 응답을
   기다리며 텅 빈 아코디언만 있으면 페이지가 덜 만들어진 것처럼 보인다. */
async function loadMealpickPantry() {
  const emptyEl = document.getElementById("mealpick-pantry-empty");
  const loadingEl = document.getElementById("mealpick-pantry-loading");
  emptyEl.hidden = true;
  loadingEl.hidden = false;
  mealpickSources.pantry = [];
  renderMealpickLists();
  mealpickSources.pantry = await fetchPoolPantryMatches();
  loadingEl.hidden = true;
  emptyEl.hidden = mealpickSources.pantry.length > 0;
  renderMealpickLists();
}

/* heldPick을 바꾸는 단 하나의 자리 — 그리드 내부 고르기(selectedIndex)·빈 자리 넣기
   (addingSlot)와 셋 중 하나만 켜져 있어야 하므로 여기서 나머지 둘도 같이 지운다.
   renderPlan()이 빈 칸을 .meal-slot-empty ↔ .meal-drop으로 바꾸고 renderEditStatus까지
   불러주므로, 상세 보기의 "요일에 놓기 ↔ 선택 취소" 표시만 따로 새로 그리면 된다. */
function setHeldPick(next) {
  heldPick = next;
  selectedIndex = null;
  addingSlot = null;
  renderMealpickDetail();
  renderPlan();
}

/* 빈 칸을 클릭했을 때 불린다(resultEl 위임에서). 무엇을 들고 있었는지에 따라 기존
   후보를 옮기거나(moveMeal, 이미 commitEdit까지 한다), 왼쪽에서 막 고른 것을 그 자리에
   새 항목으로 만든다(commitEdit이 담음 표시·상세 보기까지 다시 그린다). */
function placeHeldPick(day, meal) {
  const pick = heldPick;
  heldPick = null;
  if (!pick) return;

  if (pick.type === "existing") {
    moveMeal(pick.index, day, meal);
    return;
  }

  planItems.push({
    day,
    meal,
    menu: pick.recipe.name,
    searchKeyword: pick.recipe.searchKeyword || "",
    ingredients: pick.recipe.ingredients || [],
  });
  commitEdit();
}

/* "계획에 넣기" — 요일 배정 없이 day-less 후보로 담는다. 버튼을 누르면 그 자리(상세
   보기)가 "빼기"로 바로 바뀌지만, 왼쪽 목록의 담음 배지도 같이 바뀌는 걸 더 분명히
   하려고 문구로도 반응을 보여준다(C3). */
function addToPool(recipe) {
  planItems.push({ menu: recipe.name, searchKeyword: recipe.searchKeyword || "", ingredients: recipe.ingredients || [] });
  editNotice = COPY.MEALPOOL.addedToPool(recipe.name);
  commitEdit();
}

/* 클릭할 때도 손은 몇 px 흔들린다. 이 문턱을 넘기 전에는 아무 일도 일어나지 않아야
   메뉴 링크와 편집 버튼이 평소대로 눌린다. */
const DRAG_THRESHOLD_PX = 5;

/* 가로 영역을 마우스로 붙잡아 끌 수 있게 한다. 스크롤바를 감춘 자리를 이 조작이 대신한다.

   터치·펜은 일부러 손대지 않는다 — 미는 것이 이미 기본 동작이고, 관성과 고무줄 반동까지
   브라우저가 공짜로 해준다. JS로 흉내 내면 반드시 더 나빠진다.
   요소가 다시 그려질 때마다 새로 걸린다(안쪽이 통째로 교체되므로 이전 것은 함께 사라진다). */
function enableDragScroll(el) {
  let pointerId = null;
  let startX = 0;
  let startScroll = 0;
  let dragged = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startScroll = el.scrollLeft;
    dragged = false;
  });

  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;

    const moved = e.clientX - startX;
    if (!dragged) {
      if (Math.abs(moved) < DRAG_THRESHOLD_PX) return;
      dragged = true;
      el.classList.add("is-dragging");
      /* 문턱을 넘는 순간 글자가 파랗게 잡히기 시작한다. 미는 동작에 선택은 방해일 뿐이다. */
      const selection = document.getSelection();
      if (selection) selection.removeAllRanges();
      /* 포인터를 붙잡아 두면 커서가 카드 밖으로 나가도 계속 따라온다.
         없으면 영역을 벗어나는 순간 멈춰서 화면 끝까지 끌 수가 없다. */
      el.setPointerCapture(pointerId);
    }
    el.scrollLeft = startScroll - moved;
  });

  function endDrag(e) {
    if (e.pointerId !== pointerId) return;
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    pointerId = null;
    el.classList.remove("is-dragging");
  }

  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);

  /* 끌고 손을 떼면 click이 따라 나온다. 그대로 두면 카드를 밀었을 뿐인데 레시피 링크가
     새 탭으로 열리거나, 편집 모드에서 지나간 메뉴가 집힌다.
     capture 단계에서 잡아야 안쪽 링크·버튼의 처리보다 먼저 막을 수 있다.
     dragged를 여기서 되돌리지 않는 이유는 다음 pointerdown이 어차피 false로 시작하기
     때문이다 — 클릭은 언제나 pointerdown 뒤에 오므로 남은 값이 다음 클릭을 먹지 않는다. */
  el.addEventListener(
    "click",
    (e) => {
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );
}

/* 읽을 때는 끼니·메뉴·레시피 링크만 보여준다.
   재료를 9칸에 모두 펼치면 100줄이 넘어 "이번 주 뭐 먹지"가 안 읽힌다.
   무엇을 사야 하는지는 장보기 화면이, 어떻게 만드는지는 레시피 링크가 이미 답한다.
   (재료 데이터 자체는 지우지 않는다 — 장보기를 다시 뽑을 때 서버로 보낸다) */
/* 9칸에 "만개의레시피에서 찾아보기 →"를 반복하면 링크 문구가 메뉴 이름보다 길어서
   화면이 링크 문구로 뒤덮인다. 반복 자체가 이미 의미를 알려주므로 이름을 링크로 만들고
   화살표만 붙인다. 링크 텍스트가 요리 이름이 되어 스크린리더에도 더 정확해진다.
   (레시피 추천 화면은 카드가 1~3장뿐이고 이 링크가 화면의 결론이라 문장을 그대로 둔다) */
/* 칸의 상태 한 줄. 세 가지뿐이다 — 해먹음 / 재료 부족 / 아무 말 없음.
   저장된 것은 done 하나이고 부족은 지금 냉장고를 보고 그때그때 센다(shared.js의
   missingIngredients). 그래서 장을 봐서 다시 채우면 따로 누를 것 없이 저절로 풀린다.

   부족일 때도 빈 <p>를 남기는 이유는, 냉장고가 바뀌었을 때 이 줄만 제자리에서 갈아끼우기
   위해서다 — 칸을 통째로 다시 그리면 열어둔 "해먹었어요"와 되돌리기 버튼이 사라진다.

   이 전체 문구가 나가는 자리는 이제 모달 안이다. 칸에는 mealBriefHtml의 짧은 표시만 남는다. */
function mealStateHtml(item, pantryNames) {
  if (item.done) {
    return `<p class="meal-state meal-state-done">${escapeHtml(COPY.MEALPLAN.done)}</p>`;
  }

  const missing = missingIngredients(item, pantryNames).map((i) => splitIngredient(i).name);
  if (!missing.length) return `<p class="meal-state" hidden></p>`;

  return `<p class="meal-state meal-state-short">${escapeHtml(
    COPY.MEALPLAN.short(missing.join(", "))
  )}</p>`;
}

/* 칸에 남는 짧은 표시. 위의 mealStateHtml과 같은 세 상태를 말하지만 길이가 다르다 —
   요일 그리드는 "이번 주 뭐 먹지"를 훑는 자리라, 9칸에 문장이 들어가면 칸 높이가
   요리마다 달라지고 정작 메뉴 이름이 안 읽힌다(C2). 자세한 말은 모달이 맡는다.

   부족을 개수로만 말하는 이유도 같다. "무엇이" 부족한지는 이름 길이에 따라 한 줄이
   되기도 세 줄이 되기도 하는데, "몇 가지"는 언제나 한 줄이고 눌러볼 이유로는 충분하다.

   아무 말도 없을 때 빈 <p>를 남기는 이유는 mealStateHtml과 같다 — 냉장고가 바뀌면
   이 줄만 제자리에서 갈아끼운다. */
function mealBriefHtml(item, pantryNames) {
  if (item.done) {
    return `<p class="meal-brief meal-brief-done">${CHECK_ICON}${escapeHtml(
      COPY.MEALPLAN.done
    )}</p>`;
  }

  const missing = missingIngredients(item, pantryNames);
  if (!missing.length) return `<p class="meal-brief" hidden></p>`;

  return `<p class="meal-brief meal-brief-short">${escapeHtml(
    COPY.MEALPLAN.shortBrief(missing.length)
  )}</p>`;
}

/* 냉장고가 바뀌면 상태 줄만 지금 기준으로 갈아끼운다. renderPlan()을 부르지 않는 이유는
   위와 같다 — 방금 띄운 결과 문구와 되돌리기가 같이 날아간다.

   같은 항목이 두 곳에 그려지므로 두 곳을 다 갈아끼운다: 그리드 칸의 짧은 표시와,
   열려 있다면 모달의 전체 문구. 모달 쪽은 열려 있는 동안에만 data-plan-index를 갖는다. */
function refreshPlanStates() {
  const pantryNames = pantryNamesFor(loadPantry());
  document.querySelectorAll(".meal-slot[data-plan-index]").forEach((slot) => {
    const item = planItems[Number(slot.dataset.planIndex)];
    const briefEl = slot.querySelector(".meal-brief");
    if (item && briefEl) briefEl.outerHTML = mealBriefHtml(item, pantryNames);
  });

  /* 상세 보기가 day-less 후보를 띄우고 있으면 "부족한 재료" 표시도 냉장고가 바뀔 때
     같이 갱신한다. */
  const detailEl = document.getElementById("mealpick-detail");
  if (detailEl && detailEl.dataset.planIndex !== undefined) {
    const item = planItems[Number(detailEl.dataset.planIndex)];
    const stateEl = detailEl.querySelector(".meal-state");
    if (item && stateEl) stateEl.outerHTML = mealStateHtml(item, pantryNames);
  }

  const body = document.querySelector(".meal-dialog-body[data-plan-index]");
  if (!body) return;
  const item = planItems[Number(body.dataset.planIndex)];
  const stateEl = body.querySelector(".meal-state");
  if (item && stateEl) stateEl.outerHTML = mealStateHtml(item, pantryNames);
}

/* "해먹었어요" 표시는 메뉴를 고친 것이 아니므로 edited 값을 그대로 둔다 —
   true로 만들면 장보기 화면이 "식단을 고쳤으니 목록을 다시 뽑으라"고 잘못 권한다. */
function savePlanState() {
  const saved = loadSavedPlan();
  return savePlan(Boolean(saved && saved.edited));
}

function menuLinkHtml(item) {
  const name = escapeHtml(item.menu || "");
  const url = recipeSearchUrl(item.menu, item.searchKeyword);
  if (!url) return `<span class="meal-menu">${name}</span>`;

  return `<a class="meal-menu meal-menu-link" href="${escapeHtml(url)}"
    target="_blank" rel="noopener noreferrer"
    aria-label="${name} 레시피를 만개의레시피에서 찾아보기">${name}${EXTERNAL_LINK_ICON}</a>`;
}

/* 담아둔 요리를 그대로 식단에 넣을 수 있게 늘어놓는다. 손으로 이름을 적는 것보다 빠르고,
   재료·검색어까지 딸려와서 결과도 정확하다.
   비어 있으면 아무것도 그리지 않는다 — 빈 목록은 정보가 아니라 노이즈다. */
function addPickListHtml(title, items, attr) {
  if (!items.length) return "";

  return `<div class="meal-add-recent">
    <p class="meal-add-recent-title">${escapeHtml(title)}</p>
    ${items
      .map(
        (r, i) => `<button type="button" class="meal-add-recent-item" ${attr}="${i}">
          ${escapeHtml(r.name)}</button>`
      )
      .join("")}
  </div>`;
}

/* 즐겨찾기가 위에 선다. 이력은 다섯 개까지만 남고 새 추천에 밀려나지만 즐겨찾기는 그대로라,
   "저번에 좋았던 그거"를 찾는 사람이 먼저 만나야 하는 쪽이다.
   같은 요리가 양쪽에 있을 수 있는데 걸러내지 않는다 — 두 목록은 서로 다른 것을 말하고
   ("담아둔 것" / "방금 받은 것"), 어느 쪽에서 골라도 결과는 같다. */
function addPicksHtml() {
  return (
    addPickListHtml(COPY.FAVORITES.pickTitle, loadFavorites(), "data-favorite-index") +
    addPickListHtml(COPY.MEALPLAN.recentTitle, loadHistory(), "data-history-index")
  );
}

function mealAddFormHtml(day, meal) {
  return `<div class="meal-slot meal-slot-add">
    <label class="meal-add-label" for="meal-add-input">${escapeHtml(day.label)} ${meal}에 넣을 메뉴</label>
    <input type="text" id="meal-add-input" class="meal-add-input" autocomplete="off"
      placeholder="예: 김치볶음밥" />
    <div class="meal-add-actions">
      <button type="button" class="meal-add-confirm">넣기</button>
      <button type="button" class="link-button link-button-muted meal-add-cancel">취소</button>
    </div>
    ${addPicksHtml()}
  </div>`;
}

/* 상세 모달의 "다른 메뉴로 바꾸기"가 그 자리를 이 폼으로 갈아 끼운다. mealAddFormHtml과 같은
   짜임이지만 이미 있는 메뉴 이름을 입력값으로 미리 채운다 — 살짝만 고치고 싶은 경우도 있다.
   id는 그리드의 #meal-add-input과 겹치지 않게 따로 쓴다(모달은 그리드와 다른 서브트리라
   같은 페이지에 둘 다 있을 수 있다). */
function mealDialogSwapFormHtml(item) {
  const day = dayInfo(item.day, planStartDate);
  return `
    <label class="meal-add-label" for="meal-dialog-swap-input">${escapeHtml(
      day.label
    )} ${item.meal}에 넣을 메뉴</label>
    <input type="text" id="meal-dialog-swap-input" class="meal-add-input" autocomplete="off"
      placeholder="예: 김치볶음밥" value="${escapeHtml(item.menu || "")}" />
    <div class="meal-add-actions">
      <button type="button" class="meal-add-confirm meal-dialog-swap-confirm">${escapeHtml(
        COPY.UI.mealSwapConfirm
      )}</button>
      <button type="button" class="link-button link-button-muted meal-dialog-swap-cancel">${escapeHtml(
        COPY.UI.mealSwapCancel
      )}</button>
    </div>
    ${addPicksHtml()}`;
}

/* day는 dayInfo가 만든 { key, label, badge, aria }다. 칸을 찾고 되돌려 보낼 때는 언제나
   key("1일차")를 쓰고, 사람에게 읽히는 자리에만 label/aria("8/13 (수)")를 쓴다. */
function mealSlotHtml(day, meal, pantryNames = []) {
  const index = planItems.findIndex((i) => i.day === day.key && i.meal === meal);
  const label = `<span class="meal-label meal-label-${MEAL_CLASS[meal] || "night"}">${meal}</span>`;

  if (index < 0) {
    if (addingSlot && addingSlot.day === day.key && addingSlot.meal === meal) {
      return mealAddFormHtml(day, meal);
    }
    /* 메뉴를 고른 상태에서는 옮길 자리로만 쓴다 — 옮기기와 넣기를 한 자리에 같이 두면
       무엇을 누르는 건지 알 수 없다. 고른 게 없을 때만 넣기가 나온다. */
    /* 빈 자리의 본문은 어느 상태에서나 "끼니 + 비어 있음"으로 같다.
       메뉴가 있는 칸이 [본문][× 버튼]인 것과 맞추려고, 조작은 옆의 정사각 버튼이 진다. */
    const blank = `${label}<span class="meal-empty-text">비어 있음</span>`;

    /* 왼쪽 목록·이번 주 후보에서 고른 게 있으면(heldPick) "메뉴 바꾸기"를 안 켜도 빈 칸이
       놓을 자리가 된다 — 그리드 내부 이동(editMode)과는 별개의 경로다. */
    if (heldPick) {
      return `<div class="meal-slot meal-slot-edit">
        <button type="button" class="meal-drop" data-day="${escapeHtml(day.key)}" data-meal="${meal}"
          aria-label="${escapeHtml(day.aria)} ${meal}에 놓기">${blank}</button></div>`;
    }

    /* 메뉴를 들고 있을 때는 본문 전체가 놓을 자리가 된다 — 정사각 버튼만 노리게 하면
       9칸에서 표적이 너무 작다. 눌렀을 때 무슨 일이 생기는지는 상단 안내가 말한다. */
    if (editMode && selectedIndex !== null) {
      return `<div class="meal-slot meal-slot-edit">
        <button type="button" class="meal-drop" data-day="${escapeHtml(day.key)}" data-meal="${meal}"
          aria-label="${escapeHtml(day.aria)} ${meal}으로 옮기기">${blank}</button></div>`;
    }

    if (editMode) {
      return `<div class="meal-slot meal-slot-edit">
        <div class="meal-blank">${blank}</div>
        <button type="button" class="meal-add" data-day="${escapeHtml(day.key)}" data-meal="${meal}"
          aria-label="${escapeHtml(day.aria)} ${meal}에 메뉴 넣기">+</button>
      </div>`;
    }

    return `<div class="meal-slot meal-slot-empty">${blank}</div>`;
  }

  const item = planItems[index];
  const name = escapeHtml(item.menu || "");

  /* 편집 모드에서는 붙이지 않는다. 그때 칸은 고르고 옮기는 표적이라, 안에 또 누를 것을 두면
     무엇을 누르는 건지 알 수 없어진다(빈 칸의 넣기·옮기기를 한 자리에 두지 않는 것과 같은 이유).
     계획에 있던 요리든 임의로 넣은 요리든 똑같이 붙는다 — 이 칸에 메뉴가 있으면 그것으로 끝이다.

     data-plan-index는 "해먹었어요"를 누른 칸이 어느 항목인지 되찾는 데 쓴다. */
  if (!editMode) {
    /* 칸에는 끼니·메뉴·짧은 상태만 남기고, 자세한 상태와 "이거 해먹었어요"는 모달이 맡는다.
       예전에는 둘 다 칸 안에 있어서 칸 높이가 요리마다 들쭉날쭉했고, 9칸이 한꺼번에
       복잡해 보였다 — 그리드의 목적은 "한 주 조망" 하나다(C2).

       칸 전체를 덮는 버튼 하나가 상세를 연다. 메뉴 이름은 만개의레시피로 나가는 링크라
       버튼 안에 넣을 수 없고(대화형 요소는 겹칠 수 없다), 이름을 뺀 나머지만 누를 자리로
       만들면 9칸에서 표적이 너무 작다. 그래서 버튼을 칸 크기로 깔고 이름 링크만 그 위로
       올린다(css의 .meal-open 참고).

       버튼에 글자를 넣지 않는 이유는 칸이 이미 끼니·메뉴·상태를 말하고 있어서다.
       화면 낭독기에는 aria-label이 같은 것을 한 번에 읽어준다. */
    return `<div class="meal-slot meal-slot-filled" data-plan-index="${index}">
      <button type="button" class="meal-open" data-plan-index="${index}" aria-label="${escapeHtml(
      COPY.MEALPLAN.detail(day.aria, meal, item.menu || "")
    )}">${CHEVRON_ICON}</button>
      <div class="meal-head">${label}${menuLinkHtml(item)}</div>
      ${mealBriefHtml(item, pantryNames)}
    </div>`;
  }

  /* 칸에는 설명을 붙이지 않는다. 고른 상태는 색이, 다음에 무엇을 할지는 상단 안내가 말한다
     (9칸에 같은 문장을 반복하면 정작 메뉴 이름이 안 읽힌다).
     aria-pressed가 스크린리더에는 눌린 상태를 그대로 전한다. */
  const picked = selectedIndex === index;

  return `
    <div class="meal-slot meal-slot-edit">
      <button type="button" class="meal-pick${picked ? " is-picked" : ""}" data-index="${index}"
        aria-pressed="${picked}">
        ${label}<span class="meal-menu">${name}</span>
      </button>
      <button type="button" class="meal-delete" data-index="${index}" aria-label="${name} 삭제">×</button>
    </div>`;
}

/* ==========================================================================
   칸 상세 모달
   ==========================================================================
   그리드는 조망이고, 한 칸을 실제로 다루는 일은 여기서 한다(C2·C4).

   커스텀 오버레이 대신 <dialog>의 showModal()을 쓰는 이유는 조회 바가 여닫기를
   <details>에 맡기는 것과 같다 — 초점 가두기, Esc로 닫기, 뒤 화면 비활성화,
   다른 요소 위로 띄우기가 전부 브라우저 기본으로 딸려온다. 직접 만들면 그중
   하나는 반드시 빠뜨린다.

   안쪽 내용은 열 때마다 새로 만든다. 9칸치를 미리 그려두면 지금 냉장고가 아니라
   그릴 때의 냉장고를 보여주게 되고, 그건 이 화면이 지금까지 피해온 것이다. */
let dialogIndex = null;

function mealDialogBodyHtml(item, pantryNames) {
  /* 이미 해먹은 칸에는 "이거 해먹었어요"를 다시 띄우지 않는다 — "해먹었어요"라고 적어두고
     바로 아래에 같은 걸 또 물으면 어느 쪽이 사실인지 알 수 없다.
     잘못 눌렀을 때는 확인 직후 그 자리에 남는 되돌리기로 되돌린다. */
  const cooked = item.done ? "" : cookedHtml(item.ingredients, pantryNames);

  /* 해먹은 칸은 메뉴를 못 바꾼다 — 이미 그 메뉴의 재료 기준으로 냉장고를 뺀 기록이라,
     여기서 메뉴만 바꾸면 재료 기록과 어긋난다. "이거 해먹었어요"가 숨는 것과 같은 이유. */
  const swapBtn = item.done
    ? ""
    : `<button type="button" class="link-button meal-dialog-swap-btn">${escapeHtml(
        COPY.UI.mealSwap
      )}</button>`;

  /* 메뉴 이름을 여기서도 보여주는 이유는, 모달 제목이 "8/17 (일) 저녁"이라 어느 요리인지
     말해주지 않기 때문이다. 링크도 그대로 따라온다 — 상세를 열어놓고 레시피로 넘어가는
     것이 오히려 자연스러운 다음 걸음이다(C4). */
  return `<p class="meal-dialog-menu">${menuLinkHtml(item)}</p>${mealStateHtml(
    item,
    pantryNames
  )}${swapBtn}${cooked}`;
}

function openMealDialog(index) {
  const dlg = document.getElementById("meal-dialog");
  const body = document.getElementById("meal-dialog-body");
  const item = planItems[index];
  if (!dlg || !body || !item) return;

  dialogIndex = index;
  /* 열려 있는 동안에만 붙는다. refreshPlanStates가 이걸 보고 모달의 상태 줄도 함께 고친다. */
  body.dataset.planIndex = index;
  body.innerHTML = mealDialogBodyHtml(item, pantryNamesFor(loadPantry()));
  document.getElementById("meal-dialog-title").textContent = COPY.MEALPLAN.dialogTitle(
    dayInfo(item.day, planStartDate).label,
    item.meal
  );
  dlg.showModal();
}
