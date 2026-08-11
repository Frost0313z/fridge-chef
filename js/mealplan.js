const MEALPLAN_KEY = "fridge-chef-mealplan";
const MEALPLAN_DAYS_KEY = "fridge-chef-mealplan-days";
const MP_REQUEST_TIMEOUT_MS = 25000;

/* 재료함이 비어 있으면 걸러낼 대상이 없어 식단의 모든 재료가 리스트에 담긴다.
   그 상태에서 "재료함에 없는 재료만 모았어요"라고 하면 걸러낸 적이 없는데 걸러낸 것처럼 들리고,
   첫 사용자가 정확히 이 경로를 밟는다. 그래서 문구를 상황에 따라 나눈다. */
const SHOPPING_HINT_FILTERED = "재료함에 없는 재료만 모았어요.";
const SHOPPING_HINT_NO_PANTRY =
  "재료함이 비어 있어서 식단에 필요한 재료를 모두 담았어요. 이미 가진 재료를 재료함에 등록하면 다음부터는 부족한 것만 보여드려요.";
const SHOPPING_HINT_SUFFIX = "자동으로 담기지는 않고, 클릭하면 쿠팡 검색 결과가 새 탭에서 열려요.";

document.addEventListener("DOMContentLoaded", () => {
  initPantry();

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
  const status = createFormStatus({ loadingEl, errorEl, submitBtn });

  restorePreferences();

  daysEl.addEventListener("change", () => localStorage.setItem(MEALPLAN_DAYS_KEY, daysEl.value));
  headcountEl.addEventListener("change", () => savePrefs({ headcount: headcountEl.value }));
  situationEl.addEventListener("change", () => savePrefs({ situation: situationEl.value }));

  function restorePreferences() {
    const prefs = loadPrefs();
    if (prefs.headcount) headcountEl.value = prefs.headcount;
    if (prefs.situation) situationEl.value = prefs.situation;
    const savedDays = localStorage.getItem(MEALPLAN_DAYS_KEY);
    if (savedDays) daysEl.value = savedDays;
  }

  const saved = loadSavedPlan();
  if (saved) {
    renderPlan(saved.plan);
    renderShoppingList(saved.plan, loadPantry());
    clearBtn.hidden = false;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.hideError();
    resultEl.innerHTML = "";
    document.getElementById("shopping-list-section").hidden = true;

    const pantry = loadPantry();

    status.setLoading(true);
    const result = await postJson(
      "/api/mealplan",
      {
        days: Number(daysEl.value),
        headcount: headcountEl.value,
        situation: situationEl.value,
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
    renderShoppingList(plan, pantry);
    saveSavedPlan(plan);
    clearBtn.hidden = false;
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("저장된 식단 계획을 삭제할까요?")) return;
    localStorage.removeItem(MEALPLAN_KEY);
    resultEl.innerHTML = "";
    document.getElementById("shopping-list-section").hidden = true;
    clearBtn.hidden = true;
  });

});

function loadSavedPlan() {
  const saved = loadJson(MEALPLAN_KEY, null);
  return saved && Array.isArray(saved.plan) ? saved : null;
}

function saveSavedPlan(plan) {
  saveJson(MEALPLAN_KEY, { plan, savedAt: new Date().toISOString() });
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
    </article>
  `;
}

function renderShoppingList(plan, pantry) {
  const sectionEl = document.getElementById("shopping-list-section");
  const listEl = document.getElementById("shopping-list");
  if (!sectionEl || !listEl) return;

  /* 제출 직후와 저장된 계획 복원, 두 경로가 모두 이 함수를 거치므로 여기서 한 번만 갱신하면 된다. */
  const hintEl = document.getElementById("shopping-list-hint");
  if (hintEl) {
    const reason = pantry.length ? SHOPPING_HINT_FILTERED : SHOPPING_HINT_NO_PANTRY;
    hintEl.textContent = `${reason} ${SHOPPING_HINT_SUFFIX}`;
  }

  const shoppingList = computeShoppingList(plan, pantry);

  if (!shoppingList.length) {
    listEl.innerHTML = `<li class="shopping-item-none">재료함만으로 충분해요! 따로 살 재료가 없어요 🎉</li>`;
  } else {
    listEl.innerHTML = shoppingList
      .map(
        (item) => `
      <li class="shopping-item">
        <span>${escapeHtml(item.label)}</span>
        <a href="https://www.coupang.com/np/search?q=${encodeURIComponent(item.query)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(item.query)} 쿠팡에서 검색">쿠팡에서 검색 →</a>
      </li>
    `
      )
      .join("");
  }

  sectionEl.hidden = false;
}

/* AI는 "계란 2개", "두부(반모)", "대파 1/2대"처럼 수량을 붙여서 답하는데
   재료함에는 보통 "계란", "두부"처럼 이름만 등록돼 있다. 비교 전에 수량·단위·괄호를 걷어낸다. */
const QUANTITY_PATTERN =
  /\d+(\.\d+)?(\/\d+)?\s*(g|kg|ml|l|개|알|장|줄|대|모|쪽|톨|컵|큰술|작은술|스푼|봉지|봉|팩|캔|공기|인분|주먹)?/g;

function normalizeIngredient(name) {
  return String(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(QUANTITY_PATTERN, " ")
    .replace(/\s+/g, "")
    .trim();
}

/* 이전 구현은 `식단재료.includes(재료함항목)` 한 방향이라, 재료함에 "파"가 있으면
   "파프리카"·"파스타"까지 보유로 간주해 장보기 리스트에서 빠지는 문제가 있었다.
   양방향으로 비교하되, 짧은 쪽이 1글자면 우연한 겹침이므로 포함 매칭을 인정하지 않는다.
   그 경우 리스트에 남아 "이미 있는 걸 또 사는" 쪽으로 틀리는데, 이는 "필요한 걸 안 사는" 쪽보다 안전하다. */
function isCovered(target, pantryNames) {
  if (!target) return false;
  return pantryNames.some((p) => {
    if (!p) return false;
    if (p === target) return true;
    const shorter = p.length <= target.length ? p : target;
    return shorter.length >= 2 && (target.includes(p) || p.includes(target));
  });
}

function computeShoppingList(plan, pantry) {
  const pantryNames = pantry.map(normalizeIngredient).filter(Boolean);
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
