/* HISTORY_KEY · HISTORY_LIMIT · loadHistory()는 식단 계획 화면도 읽으므로 shared.js에 있다. */
document.addEventListener("DOMContentLoaded", () => {
  initHistory();
  initRecipeCooked();
  initFavorites();

  const form = document.getElementById("recipe-form");
  if (!form) return;

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
  /* 기다리는 화면이 "최대 몇 초"를 말하려면 실제로 포기하는 시각을 알아야 한다.
     여기서 넘기지 않으면 화면과 AbortController가 서로 다른 마감을 갖게 된다. */
  const status = createFormStatus({ loadingEl, errorEl, submitBtn, timeoutMs: REQUEST_TIMEOUT_MS });

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
    status.setError("");
    fallbackEl.hidden = true;
    rerecommendBtn.hidden = true;
    resultEl.innerHTML = "";

    /* 오래 둔 재료에는 며칠 됐는지가 붙어서 나간다. AI가 그걸 먼저 쓰는 요리를 고른다. */
    const ingredients = loadPantry().map(pantryPromptText).join(", ");

    if (!ingredients) {
      status.setError(COPY.UI.emptyIngredients);
      /* 적을 곳이 화면에서 사라졌으므로 조회 바를 열어 그 자리로 보낸다. 문구만 띄우면
         무엇을 해야 하는지가 빠져 막다른 길이 된다. */
      const bar = document.getElementById("pantry-bar");
      if (bar) {
        bar.open = true;
        const input = document.getElementById("pantry-bar-input");
        if (input) input.focus();
      }
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
    status.setError(message);
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
    shownRecipes = recipes;
    resultEl.innerHTML = recipes.map((r, i) => recipeCardHtml(r, pantryNames, i)).join("");
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
/* data-name을 달아두는 이유는 재료를 뺀 뒤 이 목록만 다시 그리기 위해서다.
   원문(수량 포함)이 그대로 필요하고, 화면 글자에서 되읽으면 "사야 해요" 꼬리표가 섞인다. */
function ingredientLiHtml(name, pantryNames) {
  const safe = escapeHtml(name);
  if (!pantryNames.length) return `<li data-name="${safe}">${safe}</li>`;

  return isCovered(normalizeIngredient(name), pantryNames)
    ? `<li class="ing-has" data-name="${safe}">${safe}</li>`
    : `<li class="ing-missing" data-name="${safe}">${safe} <span class="ing-tag">${escapeHtml(
        COPY.UI.needToBuyBadge
      )}</span></li>`;
}

/* 지금 결과 영역에 그려져 있는 요리들. 별을 누르면 이름만으로는 저장할 수 없고
   재료·조리 순서·검색어까지 필요해서, 원본을 인덱스로 되찾으려고 들고 있는다
   (이력 목록이 historyItems를 들고 있는 것과 같은 이유). */
let shownRecipes = [];

/* 실제 레시피와 매칭된 카드. AI 생성 카드와 다른 점은 두 가지다.

   ① 조리 순서를 우리 화면에 적지 않는다. 데이터 라이선스(CC BY-NC-ND)의 ND 조건이라
      원문을 재구성해서 보여줄 수 없다 — 그래서 서버가 steps를 빈 배열로 내려보내고,
      화면은 그 자리에 원본으로 가는 링크를 주 행동으로 놓는다.
   ② 출처를 밝힌다. BY 조건이고, 사용자에게도 "이건 누가 지어낸 게 아니다"라는 정보다.

   링크는 서버가 준 recipeUrl(레시피 고유 주소)을 쓴다. 이름으로 만든 검색 URL과 다르다 —
   검색은 엉뚱한 결과가 나올 수 있지만 이건 그 레시피로 바로 간다. */
function matchedDetailHtml(r) {
  const url = r.recipeUrl;
  if (!url) return recipeSearchLinkHtml(r.name, r.searchKeyword);

  return `
      <p class="recipe-matched-note">${escapeHtml(COPY.UI.matchedNote)}</p>
      <a class="recipe-search-link recipe-matched-link" href="${escapeHtml(url)}"
        target="_blank" rel="noopener noreferrer">${escapeHtml(COPY.UI.matchedLink)}</a>
      <p class="recipe-source">${escapeHtml(COPY.UI.matchedSource)}</p>`;
}

function recipeCardHtml(r, pantryNames = [], index = 0) {
  return `
    <article class="recipe-card" data-recipe-index="${index}">
      <div class="recipe-card-head">
        <h3>${escapeHtml(r.name)}</h3>
        ${favoriteToggleHtml(r.name, `data-recipe-index="${index}"`)}
      </div>
      <p class="recipe-time">⏱ ${escapeHtml(r.time || "")}</p>
      <h4>재료</h4>
      <ul class="recipe-ingredients">${(r.ingredients || [])
        .map((i) => ingredientLiHtml(i, pantryNames))
        .join("")}</ul>
      ${
        (r.steps || []).length
          ? `<h4>조리 순서</h4>
      <ol>${r.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
      ${recipeSearchLinkHtml(r.name, r.searchKeyword)}`
          : matchedDetailHtml(r)
      }
      ${cookedHtml(r.ingredients, pantryNames)}
    </article>
  `;
}

/* 별은 결과 카드와 이력 목록 두 곳에 있고, 둘 다 다시 그려지는 영역 안이라 위임으로 받는다.
   누른 별만 제자리에서 갈아끼운다 — 카드를 다시 그리면 열어둔 "이거 해먹었어요"가 닫힌다. */
function initFavorites() {
  const statusEl = document.getElementById("favorite-status");

  function setStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.hidden = !message;
  }

  function syncButton(btn, name) {
    const on = isFavorite(name);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? COPY.FAVORITES.remove(name) : COPY.FAVORITES.add(name));
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".fav-toggle");
    if (!btn) return;

    /* 어느 목록에서 눌렀는지에 따라 원본이 있는 배열이 다르다. */
    const recipe =
      btn.dataset.recipeIndex !== undefined
        ? shownRecipes[Number(btn.dataset.recipeIndex)]
        : historyItems[Number(btn.dataset.historyIndex)];
    if (!recipe) return;

    const result = toggleFavorite(recipe);
    if (result.full) {
      setStatus(COPY.FAVORITES.full(FAVORITES_LIMIT));
      return;
    }
    if (!result.stored) {
      setStatus(COPY.FAVORITES.failed);
      return;
    }

    setStatus("");
    /* 같은 요리가 카드와 이력에 함께 떠 있을 수 있다. 누른 것만 고치면 둘이 어긋난다. */
    document.querySelectorAll(".fav-toggle").forEach((el) => {
      const name =
        el.dataset.recipeIndex !== undefined
          ? (shownRecipes[Number(el.dataset.recipeIndex)] || {}).name
          : (historyItems[Number(el.dataset.historyIndex)] || {}).name;
      if (name) syncButton(el, name);
    });
  });
}

/* 재료를 뺐으니 이 카드의 보유 표시도 지금 냉장고 기준으로 다시 그린다.
   카드를 통째로 다시 그리지 않는 이유는, 방금 띄운 결과 문구와 되돌리기 버튼이
   같이 사라지기 때문이다. */
function refreshCardIngredients(card) {
  const listEl = card.querySelector(".recipe-ingredients");
  if (!listEl) return;
  const names = Array.from(listEl.querySelectorAll("li"), (li) => li.dataset.name);
  const pantryNames = pantryNamesFor(loadPantry());
  listEl.innerHTML = names.map((n) => ingredientLiHtml(n, pantryNames)).join("");
}

/* 냉장고가 바뀌면 이 화면에서 다시 그려야 하는 것은 카드의 보유 표시다
   (조회 바는 공용 initCooked이 이미 갱신한다). */
function initRecipeCooked() {
  initCooked(document.getElementById("result"), (root) =>
    refreshCardIngredients(root.closest(".recipe-card"))
  );
}

/* 이력 목록은 화면(버튼의 data-index)과 인덱스가 정확히 일치해야 클릭이 올바른 요리를 연다.
   초기 로드/새 추천/전체 삭제가 모두 이 하나의 배열을 갱신하도록 모듈 스코프에 둔다.
   (initHistory 안의 지역 변수로 두면 새 추천 후 화면만 바뀌고 배열은 옛 순서로 남아 클릭이 어긋난다) */
let historyItems = [];

/* recipeKey()는 js/shared.js에 있다 — 즐겨찾기도 같은 규칙으로 같은 요리를 알아봐야 한다. */

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
  /* 별을 항목 버튼 안에 넣을 수 없어서(대화형 요소는 겹칠 수 없다) 한 겹 감싸고 나란히 둔다 —
     식단 편집 모드의 [고르기][삭제] 짝과 같은 짜임이다. */
  listEl.innerHTML = historyItems
    .map(
      (r, index) => `
    <div class="history-entry">
      <button type="button" class="history-item" data-index="${index}">
        <span class="history-item-name">${escapeHtml(r.name)}</span>
        <span class="history-item-time">⏱ ${escapeHtml(r.time || "")}</span>
      </button>
      ${favoriteToggleHtml(r.name, `data-history-index="${index}"`)}
    </div>
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
    shownRecipes = [recipe];
    resultEl.innerHTML = recipeCardHtml(recipe, pantryNamesFor(loadPantry()), 0);
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
