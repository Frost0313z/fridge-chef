/* MEALPLAN_KEY와 loadSavedPlan()은 장보기 페이지도 읽으므로 shared.js에 있다.
   장보기 리스트 렌더는 js/shopping.js로 옮겼다. */
const MP_REQUEST_TIMEOUT_MS = 30000;

/* 서버(api/mealplan.py)의 MEALS와 순서·이름이 같아야 자리가 맞는다. */
const MEALS = ["아침", "점심", "저녁"];

/* 끼니마다 라벨 색이 다르다. 클래스 이름을 한글로 만들지 않으려고 여기서 한 번 옮긴다. */
const MEAL_CLASS = { 아침: "morning", 점심: "noon", 저녁: "night" };

/* 화면이 고쳐 쓰는 대상. 넣기·옮기기·삭제가 이 배열 하나만 바꾸고 다시 그린다. */
let planItems = [];
let planShoppingList = [];

/* 계획한 일수. 남아 있는 메뉴에서 역산하지 않고 따로 들고 있는다 —
   마지막 날 세 끼를 다 지우면 그 날짜 칸이 통째로 사라져서, 거기에 다시 넣을 수가 없었다. */
let planDays = 0;

/* 평소에는 읽는 화면이다. 21칸마다 조작 버튼을 띄워두면 정작 "이번 주 뭐 먹지"가 안 읽힌다.
   고치는 동안에만 조작을 꺼낸다. */
let editMode = false;
/* 고르고 → 놓기. 드래그와 달리 마우스·터치·키보드가 모두 같은 경로로 동작한다. */
let selectedIndex = null;

/* 지금 메뉴를 넣고 있는 빈 자리 {day, meal}. 한 번에 한 자리만 연다 —
   21칸에 입력창을 동시에 띄우면 어디에 넣는 중인지 알 수 없다. */
let addingSlot = null;

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("mealplan-form");
  if (!form) return;

  const daysEl = document.getElementById("days");
  const portionEl = document.getElementById("mp-portion");
  const healthyEl = document.getElementById("mp-healthy");
  const submitBtn = document.getElementById("mealplan-submit-btn");
  const clearBtn = document.getElementById("mealplan-clear-btn");
  const loadingEl = document.getElementById("mealplan-loading");
  const errorEl = document.getElementById("mealplan-error");
  const resultEl = document.getElementById("mealplan-result");
  const status = createFormStatus({ loadingEl, errorEl, submitBtn });

  restorePreferences();

  daysEl.addEventListener("change", () => savePrefs({ days: daysEl.value }));
  portionEl.addEventListener("change", () => savePrefs({ portion: portionEl.value }));
  healthyEl.addEventListener("change", () => savePrefs({ healthy: healthyEl.checked }));

  function restorePreferences() {
    const prefs = loadPrefs();
    setSelectValue(portionEl, prefs.portion);
    setSelectValue(daysEl, prefs.days);
    healthyEl.checked = Boolean(prefs.healthy);
  }

  const emptyEl = document.getElementById("mealplan-empty");
  const nextEl = document.getElementById("mealplan-next");

  const toolbarEl = document.getElementById("mealplan-toolbar");
  const editBtn = document.getElementById("mealplan-edit-btn");

  /* 계획 유무에 따라 빈 상태 안내 / 결과 / 다음 행동을 한 번에 맞춘다. */
  function setPlanVisible(hasPlan) {
    emptyEl.hidden = hasPlan;
    nextEl.hidden = !hasPlan;
    clearBtn.hidden = !hasPlan;
    toolbarEl.hidden = !hasPlan;
    if (!hasPlan) setEditMode(false);
  }

  const saved = loadSavedPlan();
  if (saved) {
    /* 세 끼로 나누기 전에 저장된 계획에는 meal이 없다. 저녁으로 본다 — 그때 계획한 게 저녁이었다. */
    planItems = saved.plan
      .filter((i) => i && i.menu)
      .map((i) => ({ ...i, meal: MEALS.includes(i.meal) ? i.meal : "저녁" }));
    planShoppingList = Array.isArray(saved.shoppingList) ? saved.shoppingList : [];
    /* 일수를 적어두기 전에 저장된 계획은 0이 된다 — 그때는 예전처럼 메뉴에서 역산한다. */
    planDays = Number(saved.days) || 0;
  }
  setPlanVisible(Boolean(saved));
  if (saved) renderPlan();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.setError("");
    resultEl.innerHTML = "";
    setPlanVisible(false);

    /* 서버는 예전처럼 문자열 배열을 받는다. 세 칸으로 나눈 것은 화면 사정이다.
       오래 둔 재료에는 며칠 됐는지가 붙어서, AI가 앞쪽 날짜에 배치한다. */
    const pantry = loadPantry().map(pantryPromptText);

    status.setLoading(true);
    const result = await postJson(
      "/api/mealplan",
      {
        days: Number(daysEl.value),
        portion: portionEl.value,
        healthy: healthyEl.checked,
        pantry,
      },
      MP_REQUEST_TIMEOUT_MS
    );
    status.setLoading(false);

    if (!result.ok) {
      status.setError(result.message);
      return;
    }

    const plan = result.data.plan || [];
    if (!plan.length) {
      status.setError("식단을 만들지 못했어요. 잠시 후 다시 시도해보세요.");
      return;
    }

    planItems = plan;
    planShoppingList = Array.isArray(result.data.shoppingList) ? result.data.shoppingList : [];
    planDays = Number(daysEl.value) || 0;
    savePlan(false);
    renderPlan();
    setPlanVisible(true);
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("저장된 식단 계획을 삭제할까요?")) return;
    localStorage.removeItem(MEALPLAN_KEY);
    planItems = [];
    planShoppingList = [];
    planDays = 0;
    resultEl.innerHTML = "";
    setPlanVisible(false);
  });

  editBtn.addEventListener("click", () => setEditMode(!editMode));

  /* 조작은 매번 새로 그리는 카드 위에서 일어나므로 컨테이너에 한 번만 건다. */
  resultEl.addEventListener("click", (e) => {
    const del = e.target.closest(".meal-delete");
    if (del) {
      deleteMeal(Number(del.dataset.index));
      /* 메뉴가 하나도 안 남아도 날짜 칸은 남겨둔다 — 거기에 다시 넣을 수 있어야 한다.
         계획을 진짜로 없애는 건 "계획 지우기"의 일이다. */
      if (!planItems.length && !planDays) setPlanVisible(false);
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

    /* 최근 추천받은 요리에서 골랐다 — 이름뿐 아니라 검색어·재료까지 그대로 가져온다.
       그래야 레시피 링크가 걸리고, 장보기를 다시 뽑을 때도 이 메뉴의 재료가 반영된다. */
    const recent = e.target.closest(".meal-add-recent-item");
    if (recent) {
      const picked = loadHistory()[Number(recent.dataset.historyIndex)];
      if (picked) addMeal(picked.name, picked.searchKeyword, picked.ingredients);
      return;
    }

    /* 빈 자리를 눌렀다 — 고른 메뉴를 여기로 옮긴다. */
    const drop = e.target.closest(".meal-drop");
    if (drop && selectedIndex !== null) {
      const from = selectedIndex;
      selectedIndex = null;
      moveMeal(from, drop.dataset.day, drop.dataset.meal);
      return;
    }

    const pick = e.target.closest(".meal-pick");
    if (!pick) return;
    const index = Number(pick.dataset.index);

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

/* 빈 자리에 메뉴 한 칸을 만든다. 재료는 묻지 않는다 — 21칸마다 재료까지 적게 하면
   손으로 넣는 편이 다시 계획하는 것보다 번거로워진다. 재료가 없으면 서버가
   "재료 정보 없음"으로 보고 장보기 목록을 뽑는다(api/mealplan.py). */
function addMeal(menu, searchKeyword, ingredients) {
  if (!addingSlot) return;

  const name = String(menu || "").trim();
  if (!name) {
    editNotice = "넣을 메뉴 이름을 적어주세요.";
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

  const btn = document.getElementById("mealplan-edit-btn");
  if (btn) {
    btn.textContent = on ? "다 바꿨어요" : "메뉴 바꾸기";
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

  if (!editMode) {
    el.hidden = true;
    return;
  }

  if (editNotice) {
    el.textContent = editNotice;
    editNotice = "";
    el.hidden = false;
    return;
  }

  const picked = selectedIndex !== null ? planItems[selectedIndex] : null;
  if (picked) {
    el.textContent = `"${picked.menu}"을(를) 어디로 옮길까요? 옮길 자리를 누르세요. (이미 메뉴가 있으면 서로 바뀝니다)`;
  } else if (addingSlot) {
    el.textContent = `${addingSlot.day} ${addingSlot.meal}에 넣을 메뉴를 적거나, 최근 추천받은 요리에서 고르세요.`;
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
    /* 메뉴를 다 지워도 며칠치였는지는 남겨야 그 날짜 칸에 다시 넣을 수 있다. */
    days: planDays,
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

/* 날짜 칸은 남아 있는 메뉴가 아니라 계획한 일수를 기준으로 만든다.
   3일차 메뉴를 다 지웠다고 3일차 칸이 사라지면, 거기로 다시 옮기거나 넣을 수가 없다.
   (planDays를 적어두기 전에 저장된 계획은 0이라, 예전처럼 메뉴에서 역산한 값이 이긴다) */
function dayLabels() {
  const last = Math.max(planDays, 0, ...planItems.map((i) => parseInt(i.day, 10) || 0));
  return Array.from({ length: last }, (_, n) => `${n + 1}일차`);
}

function renderPlan() {
  const resultEl = document.getElementById("mealplan-result");
  if (!resultEl) return;

  resultEl.innerHTML = `<div class="mealplan-days${editMode ? " is-editing" : ""}">${dayLabels()
    .map(
      (day) => `
      <article class="mealplan-day-card">
        <h3>${escapeHtml(day)}</h3>
        ${MEALS.map((meal) => mealSlotHtml(day, meal)).join("")}
      </article>`
    )
    .join("")}</div>`;

  renderEditStatus();
}

/* 읽을 때는 끼니·메뉴·레시피 링크만 보여준다.
   재료를 21칸에 모두 펼치면 100줄이 넘어 "이번 주 뭐 먹지"가 안 읽힌다.
   무엇을 사야 하는지는 장보기 화면이, 어떻게 만드는지는 레시피 링크가 이미 답한다.
   (재료 데이터 자체는 지우지 않는다 — 장보기를 다시 뽑을 때 서버로 보낸다) */
/* 21칸에 "만개의레시피에서 찾아보기 →"를 반복하면 링크 문구가 메뉴 이름보다 길어서
   화면이 링크 문구로 뒤덮인다. 반복 자체가 이미 의미를 알려주므로 이름을 링크로 만들고
   화살표만 붙인다. 링크 텍스트가 요리 이름이 되어 스크린리더에도 더 정확해진다.
   (레시피 추천 화면은 카드가 1~3장뿐이고 이 링크가 화면의 결론이라 문장을 그대로 둔다) */
function menuLinkHtml(item) {
  const name = escapeHtml(item.menu || "");
  const url = recipeSearchUrl(item.menu, item.searchKeyword);
  if (!url) return `<span class="meal-menu">${name}</span>`;

  return `<a class="meal-menu meal-menu-link" href="${escapeHtml(url)}"
    target="_blank" rel="noopener noreferrer"
    aria-label="${name} 레시피를 만개의레시피에서 찾아보기">${name}${EXTERNAL_LINK_ICON}</a>`;
}

/* 최근 추천받은 요리를 그대로 식단에 넣을 수 있게 늘어놓는다.
   손으로 이름을 적는 것보다 빠르고, 재료·검색어까지 딸려와서 결과도 정확하다.
   이력이 비어 있으면 아무것도 그리지 않는다 — 빈 목록은 정보가 아니라 노이즈다. */
function addRecentHtml() {
  const items = loadHistory();
  if (!items.length) return "";

  return `<div class="meal-add-recent">
    <p class="meal-add-recent-title">최근 추천받은 요리</p>
    ${items
      .map(
        (r, i) => `<button type="button" class="meal-add-recent-item" data-history-index="${i}">
          ${escapeHtml(r.name)}</button>`
      )
      .join("")}
  </div>`;
}

function mealAddFormHtml(day, meal) {
  return `<div class="meal-slot meal-slot-add">
    <label class="meal-add-label" for="meal-add-input">${escapeHtml(day)} ${meal}에 넣을 메뉴</label>
    <input type="text" id="meal-add-input" class="meal-add-input" autocomplete="off"
      placeholder="예: 김치볶음밥" />
    <div class="meal-add-actions">
      <button type="button" class="meal-add-confirm">넣기</button>
      <button type="button" class="link-button link-button-muted meal-add-cancel">취소</button>
    </div>
    ${addRecentHtml()}
  </div>`;
}

function mealSlotHtml(day, meal) {
  const index = planItems.findIndex((i) => i.day === day && i.meal === meal);
  const label = `<span class="meal-label meal-label-${MEAL_CLASS[meal] || "night"}">${meal}</span>`;

  if (index < 0) {
    if (addingSlot && addingSlot.day === day && addingSlot.meal === meal) {
      return mealAddFormHtml(day, meal);
    }
    /* 메뉴를 고른 상태에서는 옮길 자리로만 쓴다 — 옮기기와 넣기를 한 자리에 같이 두면
       무엇을 누르는 건지 알 수 없다. 고른 게 없을 때만 넣기가 나온다. */
    if (editMode && selectedIndex !== null) {
      return `<div class="meal-slot">
        <button type="button" class="meal-drop" data-day="${escapeHtml(day)}" data-meal="${meal}">
          ${label}<span class="meal-hint">여기로 옮기기</span>
        </button></div>`;
    }
    if (editMode) {
      return `<div class="meal-slot">
        <button type="button" class="meal-add" data-day="${escapeHtml(day)}" data-meal="${meal}"
          aria-label="${escapeHtml(day)} ${meal}에 메뉴 넣기">
          ${label}<span class="meal-hint">+ 메뉴 넣기</span>
        </button></div>`;
    }
    return `<div class="meal-slot meal-slot-empty">${label}
      <span class="meal-empty-text">비어 있음</span></div>`;
  }

  const item = planItems[index];
  const name = escapeHtml(item.menu || "");

  if (!editMode) {
    return `<div class="meal-slot"><div class="meal-head">${label}${menuLinkHtml(item)}</div></div>`;
  }

  const picked = selectedIndex === index;
  const hint = picked ? "고른 메뉴 · 다시 누르면 취소" : selectedIndex !== null ? "여기와 맞바꾸기" : "";

  return `
    <div class="meal-slot meal-slot-edit">
      <button type="button" class="meal-pick${picked ? " is-picked" : ""}" data-index="${index}"
        aria-pressed="${picked}">
        ${label}<span class="meal-menu">${name}</span>
        ${hint ? `<span class="meal-hint">${hint}</span>` : ""}
      </button>
      <button type="button" class="meal-delete" data-index="${index}" aria-label="${name} 삭제">×</button>
    </div>`;
}
