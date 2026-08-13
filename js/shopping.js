/* 장보기 — 식단 계획을 세울 때 서버가 함께 계산해둔 "부족한 재료" 목록을 보여준다.
   무엇을 얼마나 살지는 끼니마다의 재료를 더하고 냉장고에 있는 만큼 빼서 정해지고
   (api/shopping.py), 여기서는 그리기만 한다. */

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

    setStatus(buyIntoPantry(btn.dataset.name, btn.dataset.amount));
    render();
    renderPantryBar();
  });
});

/* 무슨 일이 있었는지 말해준다. 목록에서 줄이 사라지는 것도 반응이지만, 단위가 달라
   합치지 못한 경우처럼 목록이 그대로인 때가 있다. 그때 아무 말이 없으면 고장으로 읽힌다. */
function setStatus(message) {
  const statusEl = document.getElementById("shopping-status");
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.hidden = !message;
}

/* 산 것을 냉장고에 넣는다. 이미 있으면 수량을 더한다.
   예전에는 이미 있으면 아무것도 하지 않았다 — 수량이 모자라서 사러 간 바로 그 경우에
   버튼이 데이터도 화면도 건드리지 않아 완전히 무반응이었다.
   수량도 버리지 않는다. "대파 1단"을 "대파"로 넣으면 다음 계산이 그걸 "있다"로 읽어,
   장보기가 스스로 자기 입력을 망가뜨린다. */
function buyIntoPantry(name, amount) {
  /* 냉장고에 "계란 2개"처럼 수량이 붙어 있어 문자열 일치로는 중복을 못 잡는다.
     정규화한 이름으로 비교해 같은 재료가 두 줄로 생기지 않게 한다. */
  const key = normalizeIngredient(name);
  if (!key) return "";

  const pantry = loadPantry();
  const at = pantry.findIndex((p) => normalizeIngredient(p.name) === key);
  const bought = [name, amount].filter(Boolean).join(" ");

  if (at < 0) {
    pantry.push({ name, amount: amount || "", addedAt: todayISO() });
    return saveMessage(savePantry(pantry), `${bought}을(를) 냉장고에 넣었어요.`);
  }

  const current = pantry[at];
  const merged = addAmounts(current.amount, amount);
  if (merged) {
    /* 넣은 날짜는 그대로 둔다. 수량만 늘었는데 날짜가 새로 찍히면 2주 된 재료가
       오늘 넣은 것으로 둔갑해 "먼저 먹어라" 신호를 잃는다 (냉장고 화면과 같은 규칙). */
    pantry[at] = { ...current, amount: merged };
    return saveMessage(savePantry(pantry), `${current.name} ${current.amount} → ${merged}로 늘렸어요.`);
  }

  /* 냉장고 쪽 수량을 모르면("계란") 산 만큼이 최소한의 사실이다. 적게 잡는 쪽으로
     틀리는 편이 안전하므로 그대로 적는다(A1). */
  if (amount && !parseAmount(current.amount)) {
    pantry[at] = { ...current, amount };
    return saveMessage(savePantry(pantry), `${current.name}의 수량을 ${amount}로 적어뒀어요.`);
  }

  /* 단위가 서로 달라("1팩"과 "500ml") 더할 방법이 없다. 아무 숫자나 지어내지 않고,
     무엇을 직접 고쳐야 하는지 알려준다. */
  return `냉장고에 이미 "${current.name} ${current.amount}"이(가) 있어요.
    단위가 달라 ${amount}을(를) 합치지 못했어요. 냉장고에서 직접 고쳐주세요.`;
}

function saveMessage(stored, message) {
  return stored ? message : "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요.";
}

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

  /* 보낸 냉장고와 스냅샷이 같은 순간의 것이어야 한다. 응답을 기다리는 사이에
     조회 바로 재료를 넣으면 나중에 읽은 냉장고는 계산에 쓰인 것과 달라진다. */
  const pantrySnapshot = loadPantry().map(pantryText);
  const result = await postJson(
    "/api/shopping",
    { plan: saved.plan, pantry: pantrySnapshot },
    REFRESH_TIMEOUT_MS
  );

  loadingEl.hidden = true;
  btn.disabled = false;

  if (!result.ok) {
    errorEl.textContent = result.message;
    errorEl.hidden = false;
    return;
  }

  /* 성공했을 때만 edited를 지운다. 실패했는데 지우면 어긋난 목록을 맞는 것처럼 보여주게 된다.
     냉장고 스냅샷도 목록과 함께 갱신한다 — 새 목록의 수량은 지금 냉장고 기준의 부족분이라,
     옛 스냅샷을 그대로 두면 이미 산 것을 또 뺀다. */
  saveJson(MEALPLAN_KEY, {
    ...saved,
    shoppingList: Array.isArray(result.data.shoppingList) ? result.data.shoppingList : [],
    pantryAt: pantrySnapshot,
    edited: false,
  });
  setStatus("");
  render();
}

/* 목록의 수량은 "목록을 뽑을 때의 냉장고" 기준으로 부족했던 양이다. 그 뒤로 냉장고에
   들어온 만큼을 빼서 지금 남은 양을 돌려준다. 다 채웠으면 null — 그 줄은 사라진다.
   그래야 "샀어요"가 실제로 목록을 줄이고, 냉장고 화면에서 직접 넣어도 똑같이 반영된다.

   스냅샷이 없는 옛 계획은 뺄 기준이 없으므로 목록을 그대로 둔다. 기준 없이 지금 냉장고와
   대조하면, 원래 갖고 있던 양까지 "방금 샀다"로 세어 필요한 재료를 목록에서 지워버린다. */
function remainingAmount(item, pantryLines, pantryAt) {
  const amount = item.amount || "";
  if (!Array.isArray(pantryAt)) return { amount, filled: "" };

  const need = parseAmount(amount);
  /* 수량을 모르거나("두부") 단위가 둘 이상이면("150g, 2개") 뺄셈을 할 수 없다.
     그때는 이름이 냉장고에 새로 생겼는지만 본다 — 없던 것이 생겼으면 사 온 것이다. */
  if (!need || amount.includes(",")) {
    const key = normalizeIngredient(item.name);
    const has = (lines) => lines.some((l) => normalizeIngredient(splitIngredient(l).name) === key);
    return has(pantryLines) && !has(pantryAt) ? null : { amount, filled: "" };
  }

  /* 줄어든 경우(냉장고에서 재료를 빼면 음수가 된다)까지 필요량에 더하지는 않는다.
     장보기 목록은 그때의 계획이 기준이고, 그 뒤에 먹어 없앤 양까지 여기서 다시 세면
     같은 재료를 두 번 사게 된다. */
  const gained = Math.max(
    0,
    amountIn(pantryLines, item.name, need.unit) - amountIn(pantryAt, item.name, need.unit)
  );
  const left = need.value - gained;
  if (left <= 0) return null;

  /* 그 뒤로 얼마나 채웠는지도 함께 돌려준다. 근거 칸에서 "계획 21개 − 냉장고 4개"만
     보여주면 17개가 나와야 하는데 줄에는 15개가 적혀 있어 셈이 안 맞아 보인다. */
  return { amount: formatAmount(left, need.unit), filled: gained > 0 ? formatAmount(gained, need.unit) : "" };
}

function renderShoppingList(saved, pantry) {
  const listEl = document.getElementById("shopping-list");
  const hintEl = document.getElementById("shopping-list-hint");
  if (!listEl) return;

  /* AI가 장보기 목록을 직접 뽑기 전에 저장된 계획에는 이 필드가 없다.
     빈 목록으로 그리면 "다 있어요"로 읽혀 사실과 어긋나므로, 다시 뽑도록 안내한다.
     이때는 목록이 아예 없으므로 "무엇을 모았는지" 설명(HTML에 고정된 문구)도 함께 숨긴다. */
  const hasList = Array.isArray(saved.shoppingList);
  if (hintEl) hintEl.hidden = !hasList;
  if (!hasList) {
    listEl.innerHTML = `<li class="shopping-item-none">예전에 저장한 식단이라 장보기 목록이 없어요.
         <a href="mealplan.html">식단을 다시 계획하면 →</a> 부족한 재료를 뽑아드려요.</li>`;
    return;
  }

  /* localStorage는 사용자가 직접 고칠 수 있어 항목이 통째로 비어 있을 수 있다.
     그대로 i.name을 읽으면 페이지가 죽으므로 여기서 걸러낸다.
     남은 양이 null이면 다 채운 것이므로 줄을 지운다 — 목록이 냉장고를 따라간다. */
  const pantryLines = pantry.map(pantryText);
  const shoppingList = saved.shoppingList
    .filter((i) => i && i.name)
    .map((i) => ({ item: i, left: remainingAmount(i, pantryLines, saved.pantryAt) }))
    .filter((row) => row.left !== null)
    .map(({ item, left }) => ({
      label: [item.name, left.amount].filter(Boolean).join(" "),
      query: item.name,
      amount: left.amount,
      why: whyHtml(item, left.filled, saved.startDate),
    }));

  if (!shoppingList.length) {
    /* 수량을 안 적으면 AI가 "충분히 있다"고 보고 아무것도 안 내놓는다.
       그 상태에서 "다 있어요"라고 하면 사실과 다르므로, 왜 비었는지를 알려준다. */
    const hasQuantity = pantry.some((p) => /\d/.test(p.amount));
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
      <div class="shopping-item-row">
        <span>${escapeHtml(item.label)}</span>
        <span class="shopping-item-actions">
          <a href="${escapeHtml(coupangSearchUrl(item.query))}" target="_blank" rel="noopener" aria-label="${escapeHtml(item.query)} 쿠팡에서 검색">쿠팡에서 검색 →</a>
          <button type="button" class="shopping-bought-btn" data-name="${escapeHtml(item.query)}"
            data-amount="${escapeHtml(item.amount)}" aria-label="${escapeHtml(item.label)} 샀어요 - 냉장고에 넣기">샀어요</button>
        </span>
      </div>
      ${item.why}
    </li>
  `
    )
    .join("");
}

/* "왜 이걸 사야 하나요?" — 이 줄이 나온 계산을 그대로 펼쳐 보인다.

   숫자만 던지면 사용자는 맞는지 틀리는지 판단할 방법이 없다. 특히 "냉장고에 있는데 왜
   또 사라고 하지?"는 근거를 봐야만 풀린다 — 단위가 달라 뺄 수 없었다는 것이 답인 경우가 있다.
   접어두는 이유는 평소에 필요한 답은 "무엇을 살까" 하나뿐이기 때문이다([C2], [C10]).
   근거는 의심이 들 때만 펼치면 된다.

   숫자는 서버가 계산한 그대로 쓴다. 화면에서 다시 세면 목록의 수량과 근거가 어긋날 수 있고,
   그러면 근거가 오히려 불신을 만든다. */
function whyHtml(item, filled, startDate) {
  const uses = Array.isArray(item.uses) ? item.uses.filter((u) => u && u.menu) : [];
  if (!uses.length && !item.need) return "";

  const lines = [];
  if (item.need) lines.push(`계획 전체에 <strong>${escapeHtml(item.need)}</strong> 필요해요.`);
  if (item.have && item.subtracted) {
    lines.push(`냉장고에 ${escapeHtml(item.have)} 있어서 뺐어요.`);
  } else if (item.have) {
    /* 있는데 못 뺀 경우. 이 한 줄이 없으면 "있는데 왜 또 사라고 해?"로 끝난다. */
    lines.push(`냉장고에 ${escapeHtml(item.have)} 있지만 단위가 달라 빼지 못했어요.`);
  } else {
    lines.push("냉장고에는 없어요.");
  }
  if (filled) lines.push(`그 뒤로 ${escapeHtml(filled)}를 채웠어요.`);

  const useList = uses
    .map((use) => {
      const day = dayInfo(String(use.day || ""), startDate).label;
      const when = [day, use.meal].filter(Boolean).join(" ");
      const amount = use.amount ? ` — ${escapeHtml(use.amount)}` : "";
      return `<li>${escapeHtml(when)} · ${escapeHtml(use.menu)}${amount}</li>`;
    })
    .join("");

  return `<details class="shopping-why">
    <summary>왜 사야 하나요?</summary>
    <p class="shopping-why-sum">${lines.join(" ")}</p>
    ${useList ? `<ul class="shopping-why-uses">${useList}</ul>` : ""}
  </details>`;
}
