/* 기능 페이지들이 공용으로 쓰는 저장·통신·재료함 로직.
   main.js 다음, 페이지 전용 스크립트보다 먼저 로드해야 함. */

const PANTRY_KEY = "fridge-chef-pantry";
const PREFS_KEY = "fridge-chef-prefs";
/* 식단 계획이 쓰고 장보기가 읽으므로 두 페이지가 공유한다. */
const MEALPLAN_KEY = "fridge-chef-mealplan";

/* localStorage에는 사용자가 개발자 도구로 직접 고칠 수도 있고, 예전 버전이 남긴 값이 들어 있을 수도 있다.
   JSON.parse가 던지거나 형이 달라도 화면이 죽지 않도록 읽기는 항상 이 함수를 거친다. */
function loadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/* 읽기만 막아두면 반쪽이다. 시크릿 모드나 저장 공간이 꽉 찬 브라우저에서는 setItem 자체가 예외를
   던지는데, 그대로 두면 재료 추가·삭제가 화면 반응 없이 죽는다. 성공 여부를 돌려줘서
   부르는 쪽이 사용자에게 알릴 수 있게 한다. */
function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function loadPantry() {
  const saved = loadJson(PANTRY_KEY, []);
  return Array.isArray(saved) ? saved : [];
}

function savePantry(items) {
  return saveJson(PANTRY_KEY, items);
}

function loadPrefs() {
  const saved = loadJson(PREFS_KEY, {});
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

function savePrefs(partial) {
  return saveJson(PREFS_KEY, { ...loadPrefs(), ...partial });
}

/* select에 목록에 없는 값을 대입하면 조용히 선택이 비고(value === "") 그 상태로 제출된다.
   저장된 설정은 사용자가 고칠 수 있는 localStorage에서 오므로 값이 실제 선택지인지 확인한다. */
function setSelectValue(el, value) {
  if (el && value && Array.from(el.options).some((o) => o.value === value)) el.value = value;
}

/* textContent -> innerHTML 방식은 & < > 만 바꾸고 따옴표는 그대로 두기 때문에,
   escape 결과를 aria-label="..." 같은 속성값에 넣으면 따옴표 하나로 속성이 깨진다.
   재료명은 실제로 속성 안에 들어가므로 따옴표까지 직접 치환한다. */
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/* AI는 "계란 2개", "두부(반모)", "대파 1/2대"처럼 수량을 붙여서 답하는데
   재료함에는 보통 "계란", "두부"처럼 이름만 등록돼 있다. 비교 전에 수량·단위·괄호를 걷어낸다.
   (주간 식단의 장보기 리스트와 레시피 추천 카드의 보유 표시가 같은 규칙을 써야 하므로 여기 둔다) */
const QUANTITY_PATTERN =
  /\d+(\.\d+)?(\/\d+)?\s*(g|kg|ml|l|개|알|장|줄|대|모|쪽|톨|컵|큰술|작은술|스푼|봉지|봉|팩|캔|공기|인분|주먹)?/g;

function normalizeIngredient(name) {
  return String(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(QUANTITY_PATTERN, " ")
    .replace(/\s+/g, "")
    .trim();
}

/* 한 방향 비교(`식단재료.includes(재료함항목)`)는 재료함에 "파"가 있으면
   "파프리카"·"파스타"까지 보유로 간주해버린다. 양방향으로 비교하되,
   짧은 쪽이 1글자면 우연한 겹침이므로 포함 매칭을 인정하지 않는다.
   그 경우 "이미 있는 걸 또 사는" 쪽으로 틀리는데, 이는 "필요한 걸 안 사는" 쪽보다 안전하다. */
function isCovered(target, pantryNames) {
  if (!target) return false;
  return pantryNames.some((p) => {
    if (!p) return false;
    if (p === target) return true;
    const shorter = p.length <= target.length ? p : target;
    return shorter.length >= 2 && (target.includes(p) || p.includes(target));
  });
}

/* 재료함 목록을 비교용으로 한 번에 정규화한다. 화면을 그릴 때마다 다시 부르므로
   "지금의 재료함" 기준이 항상 반영된다. */
function pantryNamesFor(pantry) {
  return pantry.map(normalizeIngredient).filter(Boolean);
}

/* AI가 주는 조리 순서는 3~5줄이라 실제로 요리하기엔 얕고, 카드에서 흐름이 끝난다.
   사진·계량·후기가 있는 레시피 사이트로 넘겨 그 공백을 메운다.
   장보기 리스트의 쿠팡 링크와 같은 규칙 — 검색 결과까지만 보내고 그 이상은 하지 않는다.

   검색어로 요리 이름을 그대로 쓰면 안 된다. 만개의레시피는 긴 검색어를 단어별로 느슨하게
   매칭해서, "냉장고털이 두부 계란 덮밥"으로 검색하면 결과가 0건이 아니라 3만 건의
   무관한 레시피가 나온다. 그래서 AI에게 짧은 검색용 이름(searchKeyword)을 따로 받고,
   없으면(옛 저장 데이터 포함) 요리 이름으로 대체한다. */
function recipeSearchUrl(name, searchKeyword) {
  const query = (searchKeyword || name || "").trim();
  return query ? `https://www.10000recipe.com/recipe/list.html?q=${encodeURIComponent(query)}` : "";
}

function recipeSearchLinkHtml(name, searchKeyword) {
  const url = recipeSearchUrl(name, searchKeyword);
  if (!url) return "";

  const query = (searchKeyword || name || "").trim();
  return `<a class="recipe-search-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"
    aria-label="${escapeHtml(query)} 레시피를 만개의레시피에서 찾아보기">만개의레시피에서 찾아보기 →</a>`;
}

/* 새 탭으로 나간다는 표시. 이모지 대신 SVG인 이유는 두 가지다 — 이모지는 기기마다 모양이 달라
   크기·정렬이 흔들리고, 이 서비스는 이미 이모지를 쓰는 자리가 많아 규칙을 정해야 할 상태다
   (UI/UX 원칙 체크리스트 10번). 5줄이면 되는 것에 아이콘 라이브러리를 들이지 않는다. */
const EXTERNAL_LINK_ICON = `<svg class="ext-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M6.5 3H13v6.5M13 3 7.5 8.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* scrollIntoView에 behavior:'smooth'를 하드코딩하면 모션을 줄이도록 설정한 사용자에게도
   부드러운 스크롤이 걸린다. CSS의 prefers-reduced-motion 처리와 동작을 맞춘다. */
function scrollToEl(el) {
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/* 두 AI 페이지가 하던 fetch + AbortController + 오류 분기가 완전히 같은 코드였다.
   호출 쪽은 성공/실패와 "화면에 그대로 띄울 한국어 문구"만 받아가면 되도록 여기서 모두 처리한다. */
async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return { ok: false, message: (data && data.message) || "오류가 발생했어요. 잠시 후 다시 시도해주세요." };
    }
    return { ok: true, data: data || {} };
  } catch (err) {
    return {
      ok: false,
      message:
        err.name === "AbortError"
          ? "응답이 지연되고 있어요. 잠시 후 다시 시도해주세요."
          : "네트워크 연결을 확인하고 다시 시도해주세요.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/* 로딩 표시 / 에러 문구 / 제출 버튼 잠금 — 두 폼이 쓰는 세트를 한 번에 만들어준다. */
function createFormStatus({ loadingEl, errorEl, submitBtn }) {
  return {
    setLoading(isLoading) {
      loadingEl.hidden = !isLoading;
      submitBtn.disabled = isLoading;
    },
    showError(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    },
    hideError() {
      errorEl.hidden = true;
      errorEl.textContent = "";
    },
  };
}

/* 접혀 있어도 지금 뭐가 들었는지 알 수 있어야 한다. 앞의 두 개만 보여주고 나머지는 개수로 줄인다.
   냉장고 페이지의 재료함과 다른 페이지의 조회 바가 같은 문구를 써야 하므로 여기 둔다. */
function pantrySummaryText(pantry) {
  if (!pantry.length) return "(비어 있음 · 등록해두면 다음부터 편해요)";
  const head = pantry.slice(0, 2).join(", ");
  const rest = pantry.length - 2;
  return rest > 0 ? `(${head} 외 ${rest}개)` : `(${head})`;
}

/* 냉장고에 재료를 넣는 유일한 경로. 냉장고 페이지와 조회 바가 함께 쓴다.
   저장까지 하고 무슨 일이 있었는지를 돌려준다 — 문구는 부르는 쪽이 정한다. */
function addToPantry(rawValue) {
  const items = String(rawValue)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.length) return { empty: true, added: [], duplicated: [], stored: true };

  const pantry = loadPantry();
  const added = [];
  const duplicated = [];
  items.forEach((item) => {
    if (pantry.includes(item)) duplicated.push(item);
    else {
      pantry.push(item);
      added.push(item);
    }
  });

  return { empty: false, added, duplicated, stored: added.length ? savePantry(pantry) : true };
}

/* 다섯 경우 모두 말해준다. 아무 말 없이 끝나면 사용자는 버튼이 고장 났다고 읽는다(C3). */
function addResultMessage({ empty, added, duplicated, stored }) {
  if (empty) return "추가할 재료 이름을 입력해주세요.";
  if (!stored) return "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요.";
  if (added.length && duplicated.length) {
    return `${added.join(", ")}을(를) 추가했어요. ${duplicated.join(", ")}은(는) 이미 있어요.`;
  }
  if (added.length) return `${added.join(", ")}을(를) 냉장고에 넣었어요.`;
  return `${duplicated.join(", ")}은(는) 이미 냉장고에 있어요.`;
}

/* 조작 결과를 다음 렌더 한 번만 보여주고 지운다. 다른 이유로 다시 그릴 때
   (장보기의 "샀어요" 등) 방금 한 일과 무관한 문구가 남아 있으면 어긋나 보인다. */
let pantryBarStatus = "";

/* 레시피 추천·식단 계획·장보기는 모두 "지금 냉장고에 뭐가 있는지"를 알아야 판단이 된다.
   한 줄 요약만으로는 "외 3개"가 뭔지 몰라 부족하므로, 펼치면 전체 목록이 보이는 조회 바를 둔다.

   추가는 여기서도 된다. 흐름 중간에 "아 양파도 있지" 하고 냉장고로 넘어가면 적던 재료와
   추천 결과가 날아가기 때문이다. 반대로 삭제는 냉장고에서만 한다 — 되돌릴 수 없는 조작에만
   마찰을 남긴다(A4). */
function renderPantryBar() {
  const barEl = document.getElementById("pantry-bar");
  if (!barEl) return;

  const pantry = loadPantry();
  const summaryEl = document.getElementById("pantry-bar-summary");
  const bodyEl = document.getElementById("pantry-bar-body");

  if (summaryEl) summaryEl.textContent = pantrySummaryText(pantry);
  if (!bodyEl) return;

  const status = pantryBarStatus;
  pantryBarStatus = "";

  bodyEl.innerHTML = `
    ${
      pantry.length
        ? `<div class="pantry-chips">${pantry
            .map((item) => `<span class="pantry-chip pantry-chip-readonly">${escapeHtml(item)}</span>`)
            .join("")}</div>`
        : `<p class="pantry-bar-empty">아직 등록된 재료가 없어요. 아래에 적으면 바로 들어가요.</p>`
    }
    <div class="pantry-bar-add">
      <input type="text" id="pantry-bar-input" autocomplete="off"
        placeholder="재료 추가 (쉼표로 여러 개)" aria-label="냉장고에 추가할 재료" />
      <button type="button" id="pantry-bar-add-btn">추가</button>
    </div>
    <p class="pantry-bar-status" role="status"${status ? "" : " hidden"}>${escapeHtml(status)}</p>
    <p class="pantry-bar-link">지우거나 정리하려면 <a href="pantry.html">냉장고 →</a></p>`;
}

function initPantryBar() {
  const barEl = document.getElementById("pantry-bar");
  if (!barEl) return;

  /* 바 안쪽은 다시 그릴 때마다 통째로 바뀌므로, 남아 있는 바깥에 한 번만 건다. */
  barEl.addEventListener("click", (e) => {
    if (e.target.closest("#pantry-bar-add-btn")) submitPantryBar();
  });
  barEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.closest("#pantry-bar-input")) {
      e.preventDefault(); // 폼 밖이라 제출될 일은 없지만, 줄바꿈도 만들지 않는다
      submitPantryBar();
    }
  });
}

function submitPantryBar() {
  const input = document.getElementById("pantry-bar-input");
  if (!input) return;

  pantryBarStatus = addResultMessage(addToPantry(input.value));
  renderPantryBar();
  /* 다시 그리면서 입력칸이 새 요소로 바뀐다. 연달아 넣을 수 있게 초점을 돌려준다. */
  const next = document.getElementById("pantry-bar-input");
  if (next) next.focus();
}

function initPantry() {
  const input = document.getElementById("pantry-input");
  const addBtn = document.getElementById("pantry-add-btn");
  const chipsEl = document.getElementById("pantry-chips");
  const emptyEl = document.getElementById("pantry-empty");
  const statusEl = document.getElementById("pantry-status");
  if (!input || !chipsEl) return;

  let pantry = loadPantry();

  /* 조작 결과를 문구로 알린다. 이전에는 중복이나 빈 입력일 때 아무것도 그리지 않고 끝나서,
     사용자 입장에서는 버튼을 눌렀는데 화면이 그대로라 고장으로 보였다.
     setTimeout으로 스스로 사라지게 하지 않는다 — 다음 조작 때 교체되는 편이
     스크린리더에서도 놓치지 않고, 불필요한 움직임도 만들지 않는다. */
  function setStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.hidden = !message;
  }

  function render() {
    emptyEl.hidden = pantry.length > 0;
    chipsEl.innerHTML = pantry
      .map(
        (item, index) => `
      <span class="pantry-chip">
        ${escapeHtml(item)}
        <button type="button" class="pantry-chip-remove" data-index="${index}" aria-label="${escapeHtml(item)} 삭제">×</button>
      </span>
    `
      )
      .join("");
  }

  function addItems(rawValue) {
    const result = addToPantry(rawValue);
    /* 저장된 것을 다시 읽어 그린다. 저장에 실패했다면 화면에도 나타나지 않아야
       "넣었어요"와 실제가 어긋나지 않는다. */
    if (result.added.length) {
      pantry = loadPantry();
      render();
    }
    setStatus(addResultMessage(result));
  }

  addBtn.addEventListener("click", () => {
    addItems(input.value);
    input.value = "";
    input.focus();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addItems(input.value);
      input.value = "";
      input.focus();
    }
  });

  /* 첫 방문자는 빈 입력란 앞에서 "뭘 적어야 하지"로 멈춘다.
     placeholder를 읽고 자기 냉장고를 떠올려 타이핑하는 대신, 눌러서 바로 넣게 한다. */
  if (emptyEl) {
    emptyEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".pantry-example");
      if (!btn) return;
      addItems(btn.dataset.name);
    });
  }

  chipsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".pantry-chip-remove");
    if (!btn) return;
    const index = Number(btn.dataset.index);
    const [removed] = pantry.splice(index, 1);
    const stored = savePantry(pantry);
    render();
    /* 칩이 사라지는 것 자체가 반응이지만, 직전 "추가했어요" 문구가 남아 있으면
       방금 한 일과 어긋나 보인다. 마지막 조작으로 갱신한다. */
    setStatus(
      stored
        ? `${removed}을(를) 냉장고에서 뺐어요.`
        : "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요."
    );
  });

  render();
}

function loadSavedPlan() {
  const saved = loadJson(MEALPLAN_KEY, null);
  return saved && Array.isArray(saved.plan) ? saved : null;
}

/* 페이지마다 초기화 호출을 적어두면 페이지가 늘 때 빠뜨리기 쉽다.
   해당 요소가 있는 페이지에서만 알아서 동작하게 둔다. */
document.addEventListener("DOMContentLoaded", () => {
  initPantry(); // 냉장고 페이지 (요소가 없으면 즉시 반환)
  renderPantryBar(); // 나머지 기능 페이지의 조회 바
  initPantryBar();
});
