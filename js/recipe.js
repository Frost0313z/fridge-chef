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
  const status = createFormStatus({ loadingEl, errorEl, submitBtn });

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
    status.hideError();
    resultEl.innerHTML = "";

    const pantryIngredients = loadPantry().join(", ");
    const extraIngredients = ingredientsEl.value.trim();
    const ingredients = [pantryIngredients, extraIngredients].filter(Boolean).join(", ");

    if (!ingredients) {
      status.showError("재료함에 재료를 등록하거나, 오늘 있는 재료를 1개 이상 입력해주세요.");
      ingredientsEl.focus();
      return;
    }

    status.setLoading(true);
    const result = await postJson(
      "/api/recommend",
      {
        ingredients,
        headcount: headcountEl.value,
        timeLimit: timeLimitEl.value,
        situation: situationEl.value,
      },
      REQUEST_TIMEOUT_MS
    );
    status.setLoading(false);

    if (!result.ok) {
      status.showError(result.message);
      return;
    }

    renderRecipes(result.data.recipes || []);
  });

  function renderRecipes(recipes) {
    if (!recipes.length) {
      status.showError("추천 결과를 만들지 못했어요. 재료를 다르게 입력해보세요.");
      return;
    }

    /* 보유 판정은 렌더 시점에 다시 계산한다 — 저장된 식단을 복원할 때 장보기 리스트를
       다시 계산하는 것과 같은 규칙으로, 항상 "지금의 재료함" 기준이 되게 한다. */
    const pantryNames = pantryNamesFor(loadPantry());
    resultEl.innerHTML = recipes.map((r) => recipeCardHtml(r, pantryNames)).join("");
    addToHistory(recipes);
  }
});

/* 주간 식단은 재료함과 대조해 없는 재료만 골라주는데, 레시피 추천 카드는 재료를 나열만 해서
   사용자가 "양파가 나한테 있었나"를 직접 기억해야 했다. 서비스가 아는 걸 다시 묻지 않도록
   장보기 리스트와 같은 판정(isCovered)으로 표시한다.
   재료함이 비어 있으면 전부 "사야 해요"가 되어 정보가 아니라 노이즈이므로 표시하지 않는다. */
function ingredientLiHtml(name, pantryNames) {
  const safe = escapeHtml(name);
  if (!pantryNames.length) return `<li>${safe}</li>`;

  return isCovered(normalizeIngredient(name), pantryNames)
    ? `<li class="ing-has">${safe}</li>`
    : `<li class="ing-missing">${safe} <span class="ing-tag">사야 해요</span></li>`;
}

function recipeCardHtml(r, pantryNames = []) {
  return `
    <article class="recipe-card">
      <h3>${escapeHtml(r.name)}</h3>
      <p class="recipe-time">⏱ ${escapeHtml(r.time || "")}</p>
      <h4>재료</h4>
      <ul>${(r.ingredients || []).map((i) => ingredientLiHtml(i, pantryNames)).join("")}</ul>
      <h4>조리 순서</h4>
      <ol>${(r.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
    </article>
  `;
}

/* 이력 목록은 화면(버튼의 data-index)과 인덱스가 정확히 일치해야 클릭이 올바른 요리를 연다.
   초기 로드/새 추천/전체 삭제가 모두 이 하나의 배열을 갱신하도록 모듈 스코프에 둔다.
   (initHistory 안의 지역 변수로 두면 새 추천 후 화면만 바뀌고 배열은 옛 순서로 남아 클릭이 어긋난다) */
let historyItems = [];

function loadHistory() {
  const saved = loadJson(HISTORY_KEY, []);
  return Array.isArray(saved) ? saved : [];
}

function setHistory(items) {
  historyItems = items.slice(0, HISTORY_LIMIT);
  saveJson(HISTORY_KEY, historyItems);
  renderHistory();
}

function addToHistory(recipes) {
  let next = historyItems;
  recipes.forEach((r) => {
    if (!r || !r.name) return;
    next = next.filter((h) => h.name !== r.name);
    next.unshift(r);
  });
  setHistory(next);
}

function renderHistory() {
  const listEl = document.getElementById("history-list");
  const emptyEl = document.getElementById("history-empty");
  if (!listEl) return;

  emptyEl.hidden = historyItems.length > 0;
  listEl.innerHTML = historyItems
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

  historyItems = loadHistory();
  renderHistory();

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".history-item");
    if (!btn) return;
    const recipe = historyItems[Number(btn.dataset.index)];
    if (!recipe || !resultEl) return;
    resultEl.innerHTML = recipeCardHtml(recipe, pantryNamesFor(loadPantry()));
    scrollToEl(resultEl);
  });

  clearBtn.addEventListener("click", () => {
    if (!historyItems.length) return;
    if (!confirm("최근 추천 이력을 전체 삭제할까요?")) return;
    setHistory([]);
  });
}
