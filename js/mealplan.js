const MP_PANTRY_KEY = "fridge-chef-pantry";
const MEALPLAN_KEY = "fridge-chef-mealplan";
const MP_REQUEST_TIMEOUT_MS = 25000;

document.addEventListener("DOMContentLoaded", () => {
  renderPantrySummary();

  const form = document.getElementById("mealplan-form");
  if (!form) return;

  const daysEl = document.getElementById("days");
  const headcountEl = document.getElementById("mp-headcount");
  const situationEl = document.getElementById("mp-situation");
  const submitBtn = document.getElementById("mealplan-submit-btn");
  const clearBtn = document.getElementById("mealplan-clear-btn");
  const loadingEl = document.getElementById("mealplan-loading");
  const errorEl = document.getElementById("mealplan-error");
  const resultEl = document.getElementById("mealplan-result");

  const saved = loadSavedPlan();
  if (saved) {
    renderPlan(saved.plan);
    renderShoppingList(saved.plan, loadPantry());
    clearBtn.hidden = false;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();
    resultEl.innerHTML = "";
    document.getElementById("shopping-list-section").hidden = true;

    const pantry = loadPantry();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MP_REQUEST_TIMEOUT_MS);
    setLoading(true);

    try {
      const response = await fetch("/api/mealplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: Number(daysEl.value),
          headcount: headcountEl.value,
          situation: situationEl.value,
          pantry,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        showError((data && data.message) || "오류가 발생했어요. 잠시 후 다시 시도해주세요.");
        return;
      }

      const plan = (data && data.plan) || [];
      if (!plan.length) {
        showError("식단을 만들지 못했어요. 잠시 후 다시 시도해보세요.");
        return;
      }

      renderPlan(plan);
      renderShoppingList(plan, pantry);
      saveSavedPlan(plan);
      clearBtn.hidden = false;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        showError("응답이 지연되고 있어요. 잠시 후 다시 시도해주세요.");
      } else {
        showError("네트워크 연결을 확인하고 다시 시도해주세요.");
      }
    } finally {
      setLoading(false);
    }
  });

  clearBtn.addEventListener("click", () => {
    localStorage.removeItem(MEALPLAN_KEY);
    resultEl.innerHTML = "";
    document.getElementById("shopping-list-section").hidden = true;
    clearBtn.hidden = true;
  });

  function setLoading(isLoading) {
    loadingEl.hidden = !isLoading;
    submitBtn.disabled = isLoading;
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
});

function renderPantrySummary() {
  const chipsEl = document.getElementById("mealplan-pantry-chips");
  const emptyEl = document.getElementById("mealplan-pantry-empty");
  if (!chipsEl) return;

  const pantry = loadPantry();
  emptyEl.hidden = pantry.length > 0;
  chipsEl.innerHTML = pantry
    .map((item) => `<span class="pantry-chip pantry-chip-readonly">${mpEscapeHtml(item)}</span>`)
    .join("");
}

function loadPantry() {
  try {
    const saved = JSON.parse(localStorage.getItem(MP_PANTRY_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function loadSavedPlan() {
  try {
    const saved = JSON.parse(localStorage.getItem(MEALPLAN_KEY) || "null");
    return saved && Array.isArray(saved.plan) ? saved : null;
  } catch {
    return null;
  }
}

function saveSavedPlan(plan) {
  localStorage.setItem(MEALPLAN_KEY, JSON.stringify({ plan, savedAt: new Date().toISOString() }));
}

function renderPlan(plan) {
  const resultEl = document.getElementById("mealplan-result");
  resultEl.innerHTML = `<div class="mealplan-days">${plan.map(mealplanDayHtml).join("")}</div>`;
}

function mealplanDayHtml(d) {
  return `
    <article class="mealplan-day-card">
      <h3>${mpEscapeHtml(d.day || "")}</h3>
      <p class="mealplan-menu">${mpEscapeHtml(d.menu || "")}</p>
      <ul>${(d.ingredients || []).map((i) => `<li>${mpEscapeHtml(i)}</li>`).join("")}</ul>
    </article>
  `;
}

function renderShoppingList(plan, pantry) {
  const sectionEl = document.getElementById("shopping-list-section");
  const listEl = document.getElementById("shopping-list");
  if (!sectionEl || !listEl) return;

  const shoppingList = computeShoppingList(plan, pantry);

  if (!shoppingList.length) {
    listEl.innerHTML = `<li class="shopping-item-none">재료함만으로 충분해요! 따로 살 재료가 없어요 🎉</li>`;
  } else {
    listEl.innerHTML = shoppingList
      .map(
        (item) => `
      <li class="shopping-item">
        <span>${mpEscapeHtml(item)}</span>
        <a href="https://www.coupang.com/np/search?q=${encodeURIComponent(item)}" target="_blank" rel="noopener noreferrer">쿠팡에서 검색 →</a>
      </li>
    `
      )
      .join("");
  }

  sectionEl.hidden = false;
}

function computeShoppingList(plan, pantry) {
  const seen = new Set();
  const list = [];

  plan.forEach((d) => {
    (d.ingredients || []).forEach((ing) => {
      const key = String(ing).trim();
      if (!key || seen.has(key)) return;
      seen.add(key);

      const covered = pantry.some((p) => p && key.includes(p));
      if (!covered) list.push(key);
    });
  });

  return list;
}

function mpEscapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}
