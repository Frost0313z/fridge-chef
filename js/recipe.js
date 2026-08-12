const HISTORY_KEY = "fridge-chef-history";
const HISTORY_LIMIT = 5;

document.addEventListener("DOMContentLoaded", () => {
  initHistory();

  const form = document.getElementById("recipe-form");
  if (!form) return;

  const ingredientsEl = document.getElementById("ingredients");
  const portionEl = document.getElementById("portion");
  const timeLimitEl = document.getElementById("timeLimit");
  const healthyEl = document.getElementById("healthy");
  const submitBtn = document.getElementById("submit-btn");
  const loadingEl = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  const resultEl = document.getElementById("result");
  const fallbackEl = document.getElementById("error-fallback");
  const fallbackBtn = document.getElementById("error-history-btn");
  const rerecommendBtn = document.getElementById("rerecommend-btn");

  const REQUEST_TIMEOUT_MS = 20000;
  const status = createFormStatus({ loadingEl, errorEl, submitBtn });

  restorePreferences();

  portionEl.addEventListener("change", () => savePrefs({ portion: portionEl.value }));
  healthyEl.addEventListener("change", () => savePrefs({ healthy: healthyEl.checked }));
  timeLimitEl.addEventListener("change", () => savePrefs({ timeLimit: timeLimitEl.value }));

  function restorePreferences() {
    const prefs = loadPrefs();
    setSelectValue(portionEl, prefs.portion);
    setSelectValue(timeLimitEl, prefs.timeLimit);
    healthyEl.checked = Boolean(prefs.healthy);
  }

  /* 오류 문구가 "잠시 후 다시 시도해주세요"로 끝나면 지금 저녁을 정해야 하는 사람에게는
     막다른 길이다. 이력이 이미 브라우저에 있으므로 그쪽으로 갈 길을 열어준다. */
  fallbackBtn.addEventListener("click", () => scrollToEl(document.querySelector(".history")));

  /* 추천 3개가 다 안 당기는 건 정상이다. 폼까지 되돌아가지 않고 바로 다시 받게 한다.
     requestSubmit()이면 아래 submit 핸들러를 그대로 탄다.

     이때만 최근 추천 요리를 제외 목록으로 보낸다 — 같은 요청을 그대로 다시 보내면 AI가
     같은 요리를 다시 줄 이유가 충분해서, 버튼 문구("다른 요리")가 거짓이 된다.
     반대로 폼을 직접 제출하는 건 조건을 바꿔 새로 묻는 것이므로 제외하지 않는다. */
  let excludeRecent = false;
  rerecommendBtn.addEventListener("click", () => {
    excludeRecent = true;
    form.requestSubmit();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.hideError();
    fallbackEl.hidden = true;
    rerecommendBtn.hidden = true;
    resultEl.innerHTML = "";

    const pantryIngredients = loadPantry().map(pantryText).join(", ");
    const extraIngredients = ingredientsEl.value.trim();
    const ingredients = [pantryIngredients, extraIngredients].filter(Boolean).join(", ");

    if (!ingredients) {
      status.showError("냉장고에 재료를 넣거나, 오늘 있는 재료를 1개 이상 입력해주세요.");
      ingredientsEl.focus();
      return;
    }

    const exclude = excludeRecent ? historyItems.map((h) => h.name) : [];
    excludeRecent = false;

    status.setLoading(true);
    const result = await postJson(
      "/api/recommend",
      {
        ingredients,
        portion: portionEl.value,
        timeLimit: timeLimitEl.value,
        healthy: healthyEl.checked,
        exclude,
      },
      REQUEST_TIMEOUT_MS
    );
    status.setLoading(false);

    if (!result.ok) {
      showErrorWithFallback(result.message);
      return;
    }

    renderRecipes(result.data.recipes || []);
  });

  /* 빈 입력은 사용자가 바로 고칠 수 있으므로 대안을 권하지 않는다.
     AI/네트워크 실패처럼 사용자가 손쓸 수 없는 경우에만, 그리고 볼 이력이 있을 때만 권한다. */
  function showErrorWithFallback(message) {
    status.showError(message);
    fallbackEl.hidden = historyItems.length === 0;
  }

  function renderRecipes(recipes) {
    if (!recipes.length) {
      showErrorWithFallback("추천 결과를 만들지 못했어요. 재료를 다르게 입력해보세요.");
      return;
    }

    /* 보유 판정은 렌더 시점에 다시 계산한다 — 저장된 식단을 복원할 때 장보기 리스트를
       다시 계산하는 것과 같은 규칙으로, 항상 "지금의 재료함" 기준이 되게 한다. */
    const pantryNames = pantryNamesFor(loadPantry());
    resultEl.innerHTML = recipes.map((r) => recipeCardHtml(r, pantryNames)).join("");
    document.getElementById("result-empty").hidden = true;
    addToHistory(recipes);

    /* 이력 클릭으로 과거 요리를 열었을 때는 노출하지 않는다 - 그 요리에 대한 재추천이 아니다. */
    rerecommendBtn.hidden = false;
    scrollToEl(resultEl);
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
      ${recipeSearchLinkHtml(r.name, r.searchKeyword)}
    </article>
  `;
}

/* 이력 목록은 화면(버튼의 data-index)과 인덱스가 정확히 일치해야 클릭이 올바른 요리를 연다.
   초기 로드/새 추천/전체 삭제가 모두 이 하나의 배열을 갱신하도록 모듈 스코프에 둔다.
   (initHistory 안의 지역 변수로 두면 새 추천 후 화면만 바뀌고 배열은 옛 순서로 남아 클릭이 어긋난다) */
let historyItems = [];

/* 이름 없는 항목이 하나라도 섞이면 아래 비교와 렌더에서 예외가 나고,
   그 예외가 추천 결과 렌더를 중간에 끊어버린다. 읽을 때 한 번 걸러둔다. */
function loadHistory() {
  const saved = loadJson(HISTORY_KEY, []);
  return Array.isArray(saved) ? saved.filter((r) => r && r.name) : [];
}

/* 서버의 dedupe_key와 같은 규칙 — "김치볶음밥"과 "김치 볶음밥"을 같은 요리로 본다. */
function recipeKey(name) {
  return String(name || "").replace(/\s/g, "");
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
    next = next.filter((h) => recipeKey(h.name) !== recipeKey(r.name));
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
    document.getElementById("result-empty").hidden = true;

    /* 과거 요리를 다시 연 것이므로 "다른 요리 추천받기"는 맥락에 맞지 않는다. */
    const rerecommendBtn = document.getElementById("rerecommend-btn");
    if (rerecommendBtn) rerecommendBtn.hidden = true;

    scrollToEl(resultEl);
  });

  clearBtn.addEventListener("click", () => {
    if (!historyItems.length) return;
    if (!confirm("최근 추천 이력을 전체 삭제할까요?")) return;
    setHistory([]);
  });
}
