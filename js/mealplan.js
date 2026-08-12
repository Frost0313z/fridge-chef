/* MEALPLAN_KEY와 loadSavedPlan()은 장보기 페이지도 읽으므로 shared.js에 있다.
   장보기 리스트 계산·렌더는 js/shopping.js로 옮겼다. */
const MP_REQUEST_TIMEOUT_MS = 25000;

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
    if (prefs.portion) portionEl.value = prefs.portion;
    healthyEl.checked = Boolean(prefs.healthy);
    if (prefs.days) daysEl.value = prefs.days;
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
  setPlanVisible(Boolean(saved));
  if (saved) renderPlan(saved.plan);

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

    renderPlan(plan);
    saveSavedPlan(plan, result.data.shoppingList);
    setPlanVisible(true);
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("저장된 식단 계획을 삭제할까요?")) return;
    localStorage.removeItem(MEALPLAN_KEY);
    resultEl.innerHTML = "";
    setPlanVisible(false);
  });

});

/* 장보기 목록은 AI가 수량까지 따져 뽑아준 것이므로 계획과 함께 저장한다.
   장보기 페이지가 이걸 그대로 읽는다. */
function saveSavedPlan(plan, shoppingList) {
  saveJson(MEALPLAN_KEY, {
    plan,
    shoppingList: Array.isArray(shoppingList) ? shoppingList : [],
    savedAt: new Date().toISOString(),
  });
}

function renderPlan(plan) {
  const resultEl = document.getElementById("mealplan-result");
  resultEl.innerHTML = `<div class="mealplan-days">${plan.map(mealplanDayHtml).join("")}</div>`;
}

function mealplanDayHtml(d) {
  return `
    <article class="mealplan-day-card">
      <h3>${escapeHtml(d.day || "")}</h3>
      <p class="mealplan-menu">${escapeHtml(d.menu || "")}</p>
      <ul>${(d.ingredients || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
      ${recipeSearchLinkHtml(d.menu, d.searchKeyword)}
    </article>
  `;
}
