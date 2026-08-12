/* 장보기 — 식단 계획을 세울 때 AI가 함께 뽑아둔 "부족한 재료" 목록을 보여준다.
   무엇을 살지는 수량 판단이 필요해서 서버(api/mealplan.py)가 정하고, 여기서는 그리기만 한다. */

const SHOPPING_HINT_AI = "식단에 필요한 양에서 냉장고에 있는 만큼을 빼고 남은 것만 모았어요.";
const SHOPPING_HINT_SUFFIX = "자동으로 담기지는 않고, 클릭하면 쿠팡 검색 결과가 새 탭에서 열려요.";

/* q만 붙인 최소 형태(`?q=계란`)로는 검색어가 반영되지 않고 빈 검색으로 열린다.
   쿠팡 검색 페이지가 채널 파라미터까지 있어야 초기 검색 상태를 세팅하기 때문에,
   쿠팡이 스스로 만드는 URL과 같은 형태로 맞춘다. */
function coupangSearchUrl(keyword) {
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&component=`;
}

const REFRESH_TIMEOUT_MS = 25000;

document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("shopping-list");
  if (!listEl) return;

  render();

  /* 식단을 고치면 목록이 계획과 어긋난다. 자동으로 다시 부르지 않고 버튼으로 두는 이유는,
     편집할 때마다 AI를 호출하면 느려지고 비용도 계속 나가기 때문이다. 부를 시점은 사용자가 정한다. */
  const refreshBtn = document.getElementById("shopping-refresh-btn");
  if (refreshBtn) refreshBtn.addEventListener("click", refreshShoppingList);

  /* 산 재료를 냉장고에 넣으면 그 자리에서 리스트가 줄어든다.
     냉장고 → 식단 → 장보기 → 냉장고로 고리가 닫히는 지점이다. */
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".shopping-bought-btn");
    if (!btn) return;

    /* 화면에는 원문("계란 2개")을 보여주지만 냉장고에는 수량을 뺀 이름("계란")을 넣는다.
       수량이 붙은 채로 들어가면 레시피 카드의 보유 표시(isCovered)가 어긋난다. */
    const name = btn.dataset.name;
    const pantry = loadPantry();
    /* 냉장고에 "계란 2개"처럼 수량이 붙어 있을 수 있어 문자열 일치로는 중복을 못 잡는다.
       정규화한 이름으로 비교해 같은 재료가 두 줄로 생기지 않게 한다. */
    const key = normalizeIngredient(name);
    if (key && !pantry.some((p) => normalizeIngredient(p) === key)) {
      pantry.push(name);
      savePantry(pantry);
    }
    render();
    renderPantryBar();
  });
});

function render() {
  const emptyEl = document.getElementById("shopping-empty");
  const emptyCtaEl = document.getElementById("shopping-empty-cta");
  const resultEl = document.getElementById("shopping-result");
  const staleEl = document.getElementById("shopping-stale");

  const saved = loadSavedPlan();
  const hasPlan = Boolean(saved);

  emptyEl.hidden = hasPlan;
  emptyCtaEl.hidden = hasPlan;
  resultEl.hidden = !hasPlan;
  if (!hasPlan) return;

  if (staleEl) staleEl.hidden = !saved.edited;
  renderShoppingList(saved, loadPantry());
}

/* 지금 저장된 계획을 그대로 서버에 보내 목록만 다시 받는다. 계획은 새로 만들지 않는다 —
   장을 다시 보려는 것이지 식단을 새로 짜려는 게 아니다. */
async function refreshShoppingList() {
  const btn = document.getElementById("shopping-refresh-btn");
  const loadingEl = document.getElementById("shopping-refresh-loading");
  const errorEl = document.getElementById("shopping-refresh-error");

  const saved = loadSavedPlan();
  if (!saved) return;

  btn.disabled = true;
  loadingEl.hidden = false;
  errorEl.hidden = true;

  const result = await postJson(
    "/api/shopping",
    { plan: saved.plan, pantry: loadPantry() },
    REFRESH_TIMEOUT_MS
  );

  loadingEl.hidden = true;
  btn.disabled = false;

  if (!result.ok) {
    errorEl.textContent = result.message;
    errorEl.hidden = false;
    return;
  }

  /* 성공했을 때만 edited를 지운다. 실패했는데 지우면 어긋난 목록을 맞는 것처럼 보여주게 된다. */
  saveJson(MEALPLAN_KEY, {
    ...saved,
    shoppingList: Array.isArray(result.data.shoppingList) ? result.data.shoppingList : [],
    edited: false,
  });
  render();
}

function renderShoppingList(saved, pantry) {
  const listEl = document.getElementById("shopping-list");
  const hintEl = document.getElementById("shopping-list-hint");
  if (!listEl) return;

  /* AI가 장보기 목록을 직접 뽑기 전에 저장된 계획에는 이 필드가 없다.
     빈 목록으로 그리면 "다 있어요"로 읽혀 사실과 어긋나므로, 다시 뽑도록 안내한다. */
  if (!Array.isArray(saved.shoppingList)) {
    listEl.innerHTML = `<li class="shopping-item-none">예전에 저장한 식단이라 장보기 목록이 없어요.
         <a href="mealplan.html">식단을 다시 계획하면 →</a> 부족한 재료를 뽑아드려요.</li>`;
    return;
  }

  if (hintEl) hintEl.textContent = `${SHOPPING_HINT_AI} ${SHOPPING_HINT_SUFFIX}`;

  /* localStorage는 사용자가 직접 고칠 수 있어 항목이 통째로 비어 있을 수 있다.
     그대로 i.name을 읽으면 페이지가 죽으므로 여기서 걸러낸다. */
  const shoppingList = saved.shoppingList
    .filter((i) => i && i.name)
    .map((i) => ({ label: [i.name, i.amount].filter(Boolean).join(" "), query: i.name }));

  if (!shoppingList.length) {
    /* 수량을 안 적으면 AI가 "충분히 있다"고 보고 아무것도 안 내놓는다.
       그 상태에서 "다 있어요"라고 하면 사실과 다르므로, 왜 비었는지를 알려준다. */
    const hasQuantity = pantry.some((p) => /\d/.test(p));
    listEl.innerHTML = hasQuantity
      ? `<li class="shopping-item-none">냉장고에 다 있어요! 따로 살 재료가 없어요 🎉</li>`
      : `<li class="shopping-item-none">살 게 없다고 나왔어요.
           냉장고에 "계란 2개"처럼 수량을 적으면 모자란 재료를 더 정확히 찾아드려요.
           <a href="pantry.html">냉장고 수정 →</a></li>`;
    return;
  }

  listEl.innerHTML = shoppingList
    .map(
      (item) => `
    <li class="shopping-item">
      <span>${escapeHtml(item.label)}</span>
      <span class="shopping-item-actions">
        <a href="${escapeHtml(coupangSearchUrl(item.query))}" target="_blank" rel="noopener" aria-label="${escapeHtml(item.query)} 쿠팡에서 검색">쿠팡에서 검색 →</a>
        <button type="button" class="shopping-bought-btn" data-name="${escapeHtml(item.query)}" aria-label="${escapeHtml(item.label)} 샀어요 - 냉장고에 넣기">샀어요</button>
      </span>
    </li>
  `
    )
    .join("");
}
