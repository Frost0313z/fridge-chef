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

/* 숫자 없는 수량 표현. 입력칸이 "김치 조금"을 예시로 권하는데 이걸 떼지 않으면
   "김치"와 "김치 조금"이 다른 재료로 취급돼, 권한 대로 적은 사람만 중복이 쌓인다. */
const VAGUE_AMOUNT_PATTERN = /(조금|약간|살짝|많이|넉넉히|한줌|두줌)/g;

/* 수량·단위·괄호를 걷어내고 재료 이름만 남긴다. 띄어쓰기는 살린다("닭 가슴살"). */
function stripAmounts(raw) {
  return String(raw)
    .replace(/\([^)]*\)/g, " ")
    .replace(QUANTITY_PATTERN, " ")
    .replace(VAGUE_AMOUNT_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* 비교용. 띄어쓰기 차이("닭 가슴살"과 "닭가슴살")까지 같게 본다. */
function normalizeIngredient(name) {
  return stripAmounts(name).replace(/\s+/g, "");
}

/* 화면용. 수량을 숨기는 모드에서 쓴다. 수량뿐인 입력처럼 남는 게 없으면 원문을 그대로 쓴다 —
   빈 칩을 그리는 것보다 이상한 이름이라도 보여주는 편이 낫다. */
function ingredientDisplayName(raw) {
  return stripAmounts(raw) || String(raw).trim();
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

/* 서버(api/mealplan.py)가 프롬프트에 넣는 재료 개수 상한과 같은 값이어야 한다.
   한쪽만 고치면 화면이 사실과 다른 말을 하게 되므로 양쪽 주석으로 묶어둔다. */
const MEALPLAN_PANTRY_LIMIT = 30;

/* 상한을 넘으면 뒤쪽 재료가 식단 계획에서 조용히 빠진다. 조용히 빠지는 것이 문제였다 —
   사용자는 "분명 넣었는데 장보기에 또 떴다"로 겪으면서 원인을 알 방법이 없었다.
   버려지는 쪽이 최근에 넣은 재료라는 점까지 말해줘야 무엇을 정리할지 판단할 수 있다. */
function pantryLimitNoticeHtml(pantry) {
  const over = pantry.length - MEALPLAN_PANTRY_LIMIT;
  if (over <= 0) return "";

  return `<p class="pantry-limit-note">재료가 ${pantry.length}개예요.
    <strong>식단 계획</strong>에는 먼저 넣은 ${MEALPLAN_PANTRY_LIMIT}개만 쓰여서,
    최근에 넣은 ${over}개는 빠집니다. 안 쓰는 재료를 지우면 최근 것까지 반영돼요.
    (레시피 추천은 개수 제한 없이 전부 씁니다.)</p>`;
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
  if (!items.length) return { empty: true, added: [], updated: [], unchanged: [], stored: true };

  const pantry = loadPantry();
  const added = [];
  const updated = [];
  const unchanged = [];

  items.forEach((item) => {
    /* 이름이 같으면 같은 재료다. "계란"과 "계란 2개"를 두 줄로 쌓지 않는다. */
    const key = normalizeIngredient(item);
    const at = pantry.findIndex((p) => normalizeIngredient(p) === key);

    if (at < 0) {
      pantry.push(item);
      added.push(item);
    } else if (pantry[at] === item) {
      unchanged.push(item);
    } else {
      /* 다시 넣는 행위는 "지금은 이만큼이다"라는 최신 선언으로 본다.
         막으면 수량을 고칠 방법이 없어지고, 물어보면 매번 한 단계가 늘어난다. */
      updated.push({ from: pantry[at], to: item });
      pantry[at] = item;
    }
  });

  const changed = added.length || updated.length;
  return { empty: false, added, updated, unchanged, stored: changed ? savePantry(pantry) : true };
}

/* 방금 뺀 재료. 되돌리기 버튼을 그릴지도 이 값으로 판단한다.
   페이지를 옮기면 사라진다 — 되돌리기는 "방금 한 일"에만 걸리는 게 맞다. */
let lastRemoved = null;

/* 지우는 것도 한 곳에서 한다. 냉장고 화면과 조회 바가 같은 함수를 쓴다. */
function removeFromPantry(index) {
  const pantry = loadPantry();
  if (!(index >= 0 && index < pantry.length)) return null;

  const [removed] = pantry.splice(index, 1);
  const stored = savePantry(pantry);
  /* 저장이 안 됐으면 되돌릴 것도 없다 (원래 값이 그대로 남아 있다). */
  lastRemoved = stored ? { name: removed, index } : null;
  return { removed, stored };
}

/* 확인창 대신 되돌리기를 둔다. 확인창은 맞게 지우는 99번을 방해하고,
   되돌리기는 틀린 1번만 구제한다. 이쪽이 A4가 실제로 요구하는 형태다. */
function undoRemove() {
  if (!lastRemoved) return null;

  const pantry = loadPantry();
  pantry.splice(Math.min(lastRemoved.index, pantry.length), 0, lastRemoved.name);
  const stored = savePantry(pantry);
  const name = lastRemoved.name;
  lastRemoved = null;
  return { name, stored };
}

/* 평소에는 이름만 보여준다. 훑는 목적은 "뭐가 있는지"지 몇 개인지가 아니고,
   30개에 수량까지 붙으면 화면이 수량으로 뒤덮인다. 수량은 켜서 본다.
   (같은 재료가 한 줄로 합쳐지기 때문에 숨겨도 안전하다 — 합치기가 없으면
   "계란 2개"와 "계란 5개"가 둘 다 "계란"으로 보여 같은 게 둘인 것처럼 된다) */
function showAmounts() {
  return Boolean(loadPrefs().showAmounts);
}

/* 칩만 돌려준다. 감싸는 상자는 부르는 쪽이 이미 갖고 있다
   (냉장고 화면은 #pantry-chips, 조회 바는 새로 그리는 div). */
function pantryChipsHtml(pantry, withAmounts) {
  return pantry
    .map((item, index) => {
      /* 화면에서 수량을 숨겨도 삭제는 원본 기준이고, 스크린리더에는 원문을 그대로 읽어준다. */
      const label = withAmounts ? item : ingredientDisplayName(item);
      return `
      <span class="pantry-chip">
        ${escapeHtml(label)}
        <button type="button" class="pantry-chip-remove" data-index="${index}"
          aria-label="${escapeHtml(item)} 삭제">×</button>
      </span>`;
    })
    .join("");
}

/* 문구 옆에 되돌리기를 붙일 수 있게 텍스트가 아니라 HTML로 그린다. */
function statusHtml(message, canUndo) {
  if (!message) return "";
  return `${escapeHtml(message)}${
    canUndo ? ` <button type="button" class="link-button undo-btn">되돌리기</button>` : ""
  }`;
}

/* 무슨 일이 있었는지 빠짐없이 말해준다. 아무 말 없이 끝나면 사용자는 버튼이 고장 났다고 읽고(C3),
   특히 "합쳐졌다"는 조용히 넘어가면 안 된다 — 사용자 눈에는 새로 넣은 것이 사라진 것처럼 보인다. */
function addResultMessage({ empty, added, updated, unchanged, stored }) {
  if (empty) return "추가할 재료 이름을 입력해주세요.";
  if (!stored) return "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요.";

  const parts = [];
  if (added.length) parts.push(`${added.join(", ")}을(를) 냉장고에 넣었어요.`);
  if (updated.length) {
    parts.push(
      `이미 있던 ${updated.map((u) => `${u.from} → ${u.to}`).join(", ")}(으)로 바꿨어요.`
    );
  }
  if (unchanged.length) parts.push(`${unchanged.join(", ")}은(는) 이미 그대로 있어요.`);
  return parts.join(" ");
}

/* 조작 결과를 다음 렌더 한 번만 보여주고 지운다. 다른 이유로 다시 그릴 때
   (장보기의 "샀어요" 등) 방금 한 일과 무관한 문구가 남아 있으면 어긋나 보인다. */
let pantryBarStatus = "";

/* 레시피 추천·식단 계획·장보기는 모두 "지금 냉장고에 뭐가 있는지"를 알아야 판단이 된다.
   한 줄 요약만으로는 "외 3개"가 뭔지 몰라 부족하므로, 펼치면 전체 목록이 보이는 조회 바를 둔다.

   추가도 삭제도 여기서 된다. 흐름 중간에 "아 양파도 있지" 하고 냉장고로 넘어가면 적던 재료와
   추천 결과가 날아가기 때문이다. 대신 삭제에는 되돌리기를 붙인다 — 페이지를 옮기게 하는 것은
   마찰이 아니라 그냥 불편이고, 실수를 막아주지도 않는다(A4). */
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
        ? `<div class="pantry-chips">${pantryChipsHtml(pantry, showAmounts())}</div>`
        : `<p class="pantry-bar-empty">아직 등록된 재료가 없어요. 아래에 적으면 바로 들어가요.</p>`
    }
    ${pantryLimitNoticeHtml(pantry)}
    <div class="pantry-bar-add">
      <input type="text" id="pantry-bar-input" autocomplete="off"
        placeholder="재료 추가 (쉼표로 여러 개)" aria-label="냉장고에 추가할 재료" />
      <button type="button" id="pantry-bar-add-btn">추가</button>
    </div>
    <p class="pantry-bar-status" role="status"${status ? "" : " hidden"}>${statusHtml(
      status,
      Boolean(lastRemoved)
    )}</p>`;
}

function initPantryBar() {
  const barEl = document.getElementById("pantry-bar");
  if (!barEl) return;

  /* 바 안쪽은 다시 그릴 때마다 통째로 바뀌므로, 남아 있는 바깥에 한 번만 건다. */
  barEl.addEventListener("click", (e) => {
    if (e.target.closest("#pantry-bar-add-btn")) {
      submitPantryBar();
      return;
    }

    if (e.target.closest(".undo-btn")) {
      const undone = undoRemove();
      if (undone) {
        pantryBarStatus = undone.stored
          ? `${undone.name}을(를) 다시 넣었어요.`
          : "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요.";
        renderPantryBar();
      }
      return;
    }

    const removeBtn = e.target.closest(".pantry-chip-remove");
    if (!removeBtn) return;
    const result = removeFromPantry(Number(removeBtn.dataset.index));
    if (!result) return;
    pantryBarStatus = result.stored
      ? `${result.removed}을(를) 냉장고에서 뺐어요.`
      : "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요.";
    renderPantryBar();
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
  function setStatus(message, canUndo) {
    if (!statusEl) return;
    statusEl.innerHTML = statusHtml(message, canUndo);
    statusEl.hidden = !message;
  }

  const limitEl = document.getElementById("pantry-limit-note");

  function render() {
    emptyEl.hidden = pantry.length > 0;
    chipsEl.innerHTML = pantryChipsHtml(pantry, showAmounts());
    if (limitEl) {
      limitEl.innerHTML = pantryLimitNoticeHtml(pantry);
      limitEl.hidden = pantry.length <= MEALPLAN_PANTRY_LIMIT;
    }
  }

  function addItems(rawValue) {
    const result = addToPantry(rawValue);
    /* 저장된 것을 다시 읽어 그린다. 저장에 실패했다면 화면에도 나타나지 않아야
       "넣었어요"와 실제가 어긋나지 않는다. */
    if (result.added.length || result.updated.length) {
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

    const result = removeFromPantry(Number(btn.dataset.index));
    if (!result) return;
    pantry = loadPantry();
    render();
    /* 칩이 사라지는 것 자체가 반응이지만, 직전 "추가했어요" 문구가 남아 있으면
       방금 한 일과 어긋나 보인다. 마지막 조작으로 갱신한다. */
    setStatus(
      result.stored
        ? `${result.removed}을(를) 냉장고에서 뺐어요.`
        : "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요.",
      result.stored
    );
  });

  /* 평소에는 이름만, 필요할 때만 수량까지. 선택은 기억한다 — 매번 다시 켜게 하지 않는다. */
  const amountToggle = document.getElementById("pantry-amount-toggle");

  function syncAmountToggle() {
    if (!amountToggle) return;
    const on = showAmounts();
    amountToggle.textContent = on ? "수량 숨기기" : "수량 보기";
    amountToggle.setAttribute("aria-pressed", String(on));
    amountToggle.classList.toggle("is-on", on);
  }

  if (amountToggle) {
    syncAmountToggle();
    amountToggle.addEventListener("click", () => {
      savePrefs({ showAmounts: !showAmounts() });
      syncAmountToggle();
      render();
    });
  }

  /* 되돌리기는 상태 문구 안에 함께 그려지므로 그 줄에 건다. */
  if (statusEl) {
    statusEl.addEventListener("click", (e) => {
      if (!e.target.closest(".undo-btn")) return;
      const undone = undoRemove();
      if (!undone) return;
      pantry = loadPantry();
      render();
      setStatus(
        undone.stored
          ? `${undone.name}을(를) 다시 넣었어요.`
          : "브라우저에 저장하지 못했어요. 시크릿 창이라면 일반 창에서 다시 열어주세요."
      );
    });
  }

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
