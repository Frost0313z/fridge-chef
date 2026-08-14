/* HISTORY_KEY · HISTORY_LIMIT · loadHistory()는 식단 계획 화면도 읽으므로 shared.js에 있다. */
document.addEventListener("DOMContentLoaded", () => {
  initHistory();
  initCooked();

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
    const pantryIngredients = loadPantry().map(pantryPromptText).join(", ");
    const extraIngredients = ingredientsEl.value.trim();
    const ingredients = [pantryIngredients, extraIngredients].filter(Boolean).join(", ");

    if (!ingredients) {
      status.setError(COPY.UI.emptyIngredients);
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

/* 요리한 뒤 재료를 빼는 확인 단계.

   묻는 대상은 지금 냉장고에 있는 재료뿐이다. 없는 재료까지 늘어놓으면 뺄 것도 없는 줄에
   체크를 시키는 셈이고, 하나도 없으면 블록 자체를 그리지 않아 빈 상태 화면이 필요 없어진다.

   여닫기는 <details>에 맡긴다. 열고 닫는 자바스크립트도, 초점 가두기도 필요 없다 —
   조회 바와 자주 묻는 질문이 이미 쓰는 방식이다. */
function cookedHtml(r, pantryNames) {
  const mine = (r.ingredients || []).filter((i) => isCovered(normalizeIngredient(i), pantryNames));
  if (!mine.length) return "";

  return `
      <details class="cooked">
        <summary>${escapeHtml(COPY.COOKED.button)}</summary>
        <div class="cooked-body">
          <p class="cooked-question">${escapeHtml(COPY.COOKED.question)}</p>
          <p class="cooked-hint">${escapeHtml(COPY.COOKED.hint)}</p>
          <ul class="cooked-list">
            ${mine
              .map(
                (i) => `<li><label class="form-check">
              <input type="checkbox" checked data-name="${escapeHtml(i)}" />
              <span>${escapeHtml(i)}</span>
            </label></li>`
              )
              .join("")}
          </ul>
          <button type="button" class="cta-button cooked-confirm">${escapeHtml(
            COPY.COOKED.confirm
          )}</button>
          <p class="cooked-status" role="status" aria-live="polite" hidden></p>
        </div>
      </details>`;
}

function recipeCardHtml(r, pantryNames = []) {
  return `
    <article class="recipe-card">
      <h3>${escapeHtml(r.name)}</h3>
      <p class="recipe-time">⏱ ${escapeHtml(r.time || "")}</p>
      <h4>재료</h4>
      <ul class="recipe-ingredients">${(r.ingredients || [])
        .map((i) => ingredientLiHtml(i, pantryNames))
        .join("")}</ul>
      <h4>조리 순서</h4>
      <ol>${(r.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
      ${recipeSearchLinkHtml(r.name, r.searchKeyword)}
      ${cookedHtml(r, pantryNames)}
    </article>
  `;
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

function setCookedStatus(card, message, canUndo) {
  const el = card.querySelector(".cooked-status");
  if (!el) return;
  el.innerHTML = statusHtml(message, canUndo);
  el.hidden = !message;
}

/* 결과 영역은 추천을 받을 때마다 통째로 다시 그려진다. 카드마다 리스너를 달면
   그릴 때마다 다시 달아야 하므로, 바깥 상자 하나에서 위임으로 받는다. */
function initCooked() {
  const resultEl = document.getElementById("result");
  if (!resultEl) return;

  resultEl.addEventListener("click", (e) => {
    const card = e.target.closest(".recipe-card");
    if (!card) return;

    if (e.target.closest(".cooked-confirm")) {
      const names = Array.from(
        card.querySelectorAll(".cooked-list input:checked"),
        (input) => input.dataset.name
      );
      /* 전부 체크를 풀고 눌렀을 때. 아무 말 없이 끝나면 버튼이 고장 난 것으로 읽힌다(C3). */
      if (!names.length) {
        setCookedStatus(card, COPY.COOKED.nothing, false);
        return;
      }

      const result = consumeFromPantry(names);
      if (!result.stored) {
        setCookedStatus(card, COPY.COOKED.failed, false);
        return;
      }
      setCookedStatus(card, COPY.COOKED.done(result.removed.join(", ")), true);
      afterPantryChange(card);
      return;
    }

    if (e.target.closest(".undo-btn")) {
      const undone = undoRemove();
      if (!undone) return;
      setCookedStatus(
        card,
        undone.stored ? COPY.COOKED.undone(undone.name) : COPY.COOKED.failed,
        false
      );
      afterPantryChange(card);
    }
  });
}

/* 냉장고가 바뀌면 이 화면에서 그것을 보여주는 곳이 둘이다 — 카드의 보유 표시와 조회 바. */
function afterPantryChange(card) {
  refreshCardIngredients(card);
  renderPantryBar();
}

/* 이력 목록은 화면(버튼의 data-index)과 인덱스가 정확히 일치해야 클릭이 올바른 요리를 연다.
   초기 로드/새 추천/전체 삭제가 모두 이 하나의 배열을 갱신하도록 모듈 스코프에 둔다.
   (initHistory 안의 지역 변수로 두면 새 추천 후 화면만 바뀌고 배열은 옛 순서로 남아 클릭이 어긋난다) */
let historyItems = [];

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
