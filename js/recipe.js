const HISTORY_KEY = "fridge-chef-history";
const HISTORY_LIMIT = 5;
const RECIPE_TIMELIMIT_KEY = "fridge-chef-recipe-timelimit";

document.addEventListener("DOMContentLoaded", () => {
  initPantry();
  initHistory();

  const form = document.getElementById("recipe-form");
  if (!form) return;

  const ingredientsEl = document.getElementById("ingredients");
  const headcountEl = document.getElementById("headcount");
  const timeLimitEl = document.getElementById("timeLimit");
  const situationEl = document.getElementById("situation");
  const submitBtn = document.getElementById("submit-btn");
  const loadingEl = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  const resultEl = document.getElementById("result");

  const REQUEST_TIMEOUT_MS = 20000;

  restorePreferences();

  headcountEl.addEventListener("change", () => savePrefs({ headcount: headcountEl.value }));
  situationEl.addEventListener("change", () => savePrefs({ situation: situationEl.value }));
  timeLimitEl.addEventListener("change", () => localStorage.setItem(RECIPE_TIMELIMIT_KEY, timeLimitEl.value));

  function restorePreferences() {
    const prefs = loadPrefs();
    if (prefs.headcount) headcountEl.value = prefs.headcount;
    if (prefs.situation) situationEl.value = prefs.situation;
    const savedTimeLimit = localStorage.getItem(RECIPE_TIMELIMIT_KEY);
    if (savedTimeLimit) timeLimitEl.value = savedTimeLimit;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();
    resultEl.innerHTML = "";

    const pantryIngredients = loadPantry().join(", ");
    const extraIngredients = ingredientsEl.value.trim();
    const ingredients = [pantryIngredients, extraIngredients].filter(Boolean).join(", ");

    if (!ingredients) {
      showError("재료함에 재료를 등록하거나, 오늘 있는 재료를 1개 이상 입력해주세요.");
      ingredientsEl.focus();
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setLoading(true);

    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredients,
          headcount: headcountEl.value,
          timeLimit: timeLimitEl.value,
          situation: situationEl.value,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        showError((data && data.message) || "오류가 발생했어요. 잠시 후 다시 시도해주세요.");
        return;
      }

      renderRecipes((data && data.recipes) || []);
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

  function renderRecipes(recipes) {
    if (!recipes.length) {
      showError("추천 결과를 만들지 못했어요. 재료를 다르게 입력해보세요.");
      return;
    }

    resultEl.innerHTML = recipes.map(recipeCardHtml).join("");
    addToHistory(recipes);
  }
});

function recipeCardHtml(r) {
  return `
    <article class="recipe-card">
      <h3>${escapeHtml(r.name)}</h3>
      <p class="recipe-time">⏱ ${escapeHtml(r.time || "")}</p>
      <h4>재료</h4>
      <ul>${(r.ingredients || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
      <h4>조리 순서</h4>
      <ol>${(r.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
    </article>
  `;
}

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

function addToHistory(recipes) {
  let history = loadHistory();
  recipes.forEach((r) => {
    if (!r || !r.name) return;
    history = history.filter((h) => h.name !== r.name);
    history.unshift(r);
  });
  history = history.slice(0, HISTORY_LIMIT);
  saveHistory(history);
  renderHistory(history);
}

function renderHistory(history) {
  const listEl = document.getElementById("history-list");
  const emptyEl = document.getElementById("history-empty");
  if (!listEl) return;

  emptyEl.hidden = history.length > 0;
  listEl.innerHTML = history
    .map(
      (r, index) => `
    <button type="button" class="history-item" data-index="${index}">
      <span class="history-item-name">${escapeHtml(r.name)}</span>
      <span class="history-item-time">⏱ ${escapeHtml(r.time || "")}</span>
    </button>
  `
    )
    .join("");
}

function initHistory() {
  const listEl = document.getElementById("history-list");
  const clearBtn = document.getElementById("history-clear-btn");
  const resultEl = document.getElementById("result");
  if (!listEl) return;

  let history = loadHistory();
  renderHistory(history);

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".history-item");
    if (!btn) return;
    const index = Number(btn.dataset.index);
    const recipe = history[index];
    if (!recipe || !resultEl) return;
    resultEl.innerHTML = recipeCardHtml(recipe);
    resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  clearBtn.addEventListener("click", () => {
    if (!history.length) return;
    if (!confirm("최근 추천 이력을 전체 삭제할까요?")) return;
    history = [];
    saveHistory(history);
    renderHistory(history);
  });
}
