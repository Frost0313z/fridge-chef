/* 장보기 — 저장된 식단 계획에서 냉장고에 없는 재료만 골라 보여준다.
   계산 로직(computeShoppingList)은 mealplan.js에서 그대로 옮겨왔다.
   정규화·양방향 매칭은 과거 버그를 고쳐 만든 규칙이라 이동하면서 손대지 않았다. */

/* 재료함이 비어 있으면 걸러낼 대상이 없어 식단의 모든 재료가 리스트에 담긴다.
   그 상태에서 "냉장고에 없는 재료만 모았어요"라고 하면 걸러낸 적이 없는데 걸러낸 것처럼 들리고,
   첫 사용자가 정확히 이 경로를 밟는다. 그래서 문구를 상황에 따라 나눈다. */
const SHOPPING_HINT_AI = "식단에 필요한 양에서 냉장고에 있는 만큼을 빼고 남은 것만 모았어요.";
const SHOPPING_HINT_FILTERED = "냉장고에 없는 재료만 모았어요.";
const SHOPPING_HINT_NO_PANTRY =
  "냉장고가 비어 있어서 식단에 필요한 재료를 모두 담았어요. 이미 가진 재료를 냉장고에 넣으면 다음부터는 부족한 것만 보여드려요.";
const SHOPPING_HINT_SUFFIX = "자동으로 담기지는 않고, 클릭하면 쿠팡 검색 결과가 새 탭에서 열려요.";

/* q만 붙인 최소 형태(`?q=계란`)로는 검색어가 반영되지 않고 빈 검색으로 열린다.
   쿠팡 검색 페이지가 채널 파라미터까지 있어야 초기 검색 상태를 세팅하기 때문에,
   쿠팡이 스스로 만드는 URL과 같은 형태로 맞춘다. */
function coupangSearchUrl(keyword) {
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&component=`;
}

document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("shopping-list");
  if (!listEl) return;

  render();

  /* 산 재료를 냉장고에 넣으면 그 자리에서 리스트가 줄어든다.
     냉장고 → 식단 → 장보기 → 냉장고로 고리가 닫히는 지점이다. */
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".shopping-bought-btn");
    if (!btn) return;

    /* 화면에는 원문("계란 2개")을 보여주지만 냉장고에는 정규화된 이름("계란")을 넣어야 한다.
       수량이 붙은 채로 들어가면 다음 계산에서 isCovered() 매칭이 어긋난다. */
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

  const saved = loadSavedPlan();
  const hasPlan = Boolean(saved);

  emptyEl.hidden = hasPlan;
  emptyCtaEl.hidden = hasPlan;
  resultEl.hidden = !hasPlan;
  if (!hasPlan) return;

  renderShoppingList(saved, loadPantry());
}

/* 살 것을 정하려면 수량을 따져야 한다 — "계란 2개"가 있어도 5일치에 8개가 필요하면 사야 한다.
   프론트의 이름 매칭으로는 이 구분이 불가능해서, 이제 AI가 목록을 직접 뽑아준다.
   이 필드가 없는 옛 저장분은 기존 이름 매칭으로 계산한다. */
function shoppingItemsFor(saved, pantry) {
  if (Array.isArray(saved.shoppingList)) {
    return {
      hint: SHOPPING_HINT_AI,
      items: saved.shoppingList.map((i) => ({
        label: [i.name, i.amount].filter(Boolean).join(" "),
        query: i.name,
      })),
    };
  }
  return {
    hint: pantry.length ? SHOPPING_HINT_FILTERED : SHOPPING_HINT_NO_PANTRY,
    items: computeShoppingList(saved.plan, pantry),
  };
}

function renderShoppingList(saved, pantry) {
  const listEl = document.getElementById("shopping-list");
  const hintEl = document.getElementById("shopping-list-hint");
  if (!listEl) return;

  const { hint, items: shoppingList } = shoppingItemsFor(saved, pantry);
  if (hintEl) hintEl.textContent = `${hint} ${SHOPPING_HINT_SUFFIX}`;

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

function computeShoppingList(plan, pantry) {
  const pantryNames = pantryNamesFor(pantry);
  const seen = new Set();
  const list = [];

  plan.forEach((d) => {
    (d.ingredients || []).forEach((ing) => {
      const label = String(ing).trim();
      const key = normalizeIngredient(label);
      if (!key || seen.has(key)) return;
      seen.add(key);

      /* 화면에는 수량이 붙은 원문("계란 2개")을 그대로 보여주되,
         쿠팡 검색은 수량을 뺀 이름("계란")으로 넘겨야 결과가 제대로 나온다. */
      if (!isCovered(key, pantryNames)) list.push({ label, query: key });
    });
  });

  return list;
}
