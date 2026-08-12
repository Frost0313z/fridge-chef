/* MEALPLAN_KEY와 loadSavedPlan()은 장보기 페이지도 읽으므로 shared.js에 있다.
   장보기 리스트 렌더는 js/shopping.js로 옮겼다. */
const MP_REQUEST_TIMEOUT_MS = 30000;

/* 서버(api/mealplan.py)의 MEALS와 순서·이름이 같아야 자리가 맞는다. */
const MEALS = ["아침", "점심", "저녁"];

/* 화면이 고쳐 쓰는 대상. 옮기기·삭제가 이 배열 하나만 바꾸고 다시 그린다. */
let planItems = [];
let planShoppingList = [];

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

  /* 계획 유무에 따라 빈 상태 안내 / 결과 / 다음 행동을 한 번에 맞춘다. */
  function setPlanVisible(hasPlan) {
    emptyEl.hidden = hasPlan;
    nextEl.hidden = !hasPlan;
    clearBtn.hidden = !hasPlan;
  }

  const saved = loadSavedPlan();
  if (saved) {
    /* 세 끼로 나누기 전에 저장된 계획에는 meal이 없다. 저녁으로 본다 — 그때 계획한 게 저녁이었다. */
    planItems = saved.plan
      .filter((i) => i && i.menu)
      .map((i) => ({ ...i, meal: MEALS.includes(i.meal) ? i.meal : "저녁" }));
    planShoppingList = Array.isArray(saved.shoppingList) ? saved.shoppingList : [];
  }
  setPlanVisible(Boolean(saved));
  if (saved) renderPlan();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.hideError();
    resultEl.innerHTML = "";
    setPlanVisible(false);

    const pantry = loadPantry();

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
      status.showError(result.message);
      return;
    }

    const plan = result.data.plan || [];
    if (!plan.length) {
      status.showError("식단을 만들지 못했어요. 잠시 후 다시 시도해보세요.");
      return;
    }

    planItems = plan;
    planShoppingList = Array.isArray(result.data.shoppingList) ? result.data.shoppingList : [];
    savePlan(false);
    renderPlan();
    setPlanVisible(true);
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("저장된 식단 계획을 삭제할까요?")) return;
    localStorage.removeItem(MEALPLAN_KEY);
    planItems = [];
    planShoppingList = [];
    resultEl.innerHTML = "";
    setPlanVisible(false);
  });

  /* 옮기기와 삭제는 매번 새로 그리는 카드 위에서 일어나므로 컨테이너에 한 번만 건다. */
  resultEl.addEventListener("change", (e) => {
    const select = e.target.closest(".meal-move");
    if (!select || !select.value) return;
    const [day, meal] = select.value.split("|");
    moveMeal(Number(select.dataset.index), day, meal);
  });

  resultEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".meal-delete");
    if (!btn) return;
    deleteMeal(Number(btn.dataset.index));
    if (!planItems.length) setPlanVisible(false);
  });
});

/* 계획을 고치면 장보기 목록은 더 이상 이 계획의 것이 아니다.
   edited로 표시해두고, 장보기 화면이 "다시 뽑기"를 권한다. */
function savePlan(edited) {
  return saveJson(MEALPLAN_KEY, {
    plan: planItems,
    shoppingList: planShoppingList,
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

/* 날짜 칸은 남아 있는 메뉴가 아니라 계획의 마지막 날짜를 기준으로 만든다.
   3일차 메뉴를 다 지웠다고 3일차 칸이 사라지면, 거기로 다시 옮길 수가 없다. */
function dayLabels() {
  const last = Math.max(0, ...planItems.map((i) => parseInt(i.day, 10) || 0));
  return Array.from({ length: last }, (_, n) => `${n + 1}일차`);
}

function renderPlan() {
  const resultEl = document.getElementById("mealplan-result");
  if (!resultEl) return;

  const days = dayLabels();
  resultEl.innerHTML = `<div class="mealplan-days">${days
    .map(
      (day) => `
      <article class="mealplan-day-card">
        <h3>${escapeHtml(day)}</h3>
        ${MEALS.map((meal) => mealSlotHtml(day, meal)).join("")}
      </article>`
    )
    .join("")}</div>`;
}

function mealSlotHtml(day, meal) {
  const index = planItems.findIndex((i) => i.day === day && i.meal === meal);
  const label = `<span class="meal-label">${meal}</span>`;

  if (index < 0) {
    return `<div class="meal-slot meal-slot-empty">${label}
      <span class="meal-empty-text">비어 있음 — 다른 끼니를 여기로 옮길 수 있어요</span></div>`;
  }

  const item = planItems[index];
  return `
    <div class="meal-slot">
      <div class="meal-head">
        ${label}
        <span class="meal-menu">${escapeHtml(item.menu || "")}</span>
      </div>
      <ul class="meal-ingredients">${(item.ingredients || [])
        .map((i) => `<li>${escapeHtml(i)}</li>`)
        .join("")}</ul>
      ${recipeSearchLinkHtml(item.menu, item.searchKeyword)}
      <div class="meal-actions">
        <label class="meal-move-label">
          <span class="visually-hidden">${escapeHtml(item.menu || "")} 옮길 자리</span>
          <select class="meal-move" data-index="${index}">
            <option value="">옮기기…</option>
            ${moveOptionsHtml(day, meal)}
          </select>
        </label>
        <button type="button" class="meal-delete" data-index="${index}"
          aria-label="${escapeHtml(item.menu || "")} 삭제">삭제</button>
      </div>
    </div>`;
}

/* 자기 자리를 뺀 모든 칸을 목적지로 제시한다. 이미 찬 자리는 맞바꾼다는 걸 미리 알려준다. */
function moveOptionsHtml(fromDay, fromMeal) {
  return dayLabels()
    .map((day) => {
      const options = MEALS.filter((meal) => !(day === fromDay && meal === fromMeal))
        .map((meal) => {
          const taken = planItems.some((i) => i.day === day && i.meal === meal);
          const text = taken ? `${day} ${meal} (맞바꾸기)` : `${day} ${meal}`;
          return `<option value="${escapeHtml(day)}|${meal}">${escapeHtml(text)}</option>`;
        })
        .join("");
      return `<optgroup label="${escapeHtml(day)}">${options}</optgroup>`;
    })
    .join("");
}
