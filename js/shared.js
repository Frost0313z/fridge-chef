/* recipe.html과 mealplan.html이 공용으로 쓰는 재료함/선호값 저장 로직. main.js 다음, 페이지 전용 스크립트보다 먼저 로드해야 함. */

const PANTRY_KEY = "fridge-chef-pantry";
const PREFS_KEY = "fridge-chef-prefs";

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

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadPantry() {
  const saved = loadJson(PANTRY_KEY, []);
  return Array.isArray(saved) ? saved : [];
}

function savePantry(items) {
  saveJson(PANTRY_KEY, items);
}

function loadPrefs() {
  const saved = loadJson(PREFS_KEY, {});
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

function savePrefs(partial) {
  saveJson(PREFS_KEY, { ...loadPrefs(), ...partial });
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
    const newItems = rawValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!newItems.length) {
      setStatus("추가할 재료 이름을 입력해주세요.");
      return;
    }

    const added = [];
    const duplicated = [];
    newItems.forEach((item) => {
      if (pantry.includes(item)) {
        duplicated.push(item);
      } else {
        pantry.push(item);
        added.push(item);
      }
    });

    if (added.length) {
      savePantry(pantry);
      render();
    }

    if (added.length && duplicated.length) {
      setStatus(`${added.join(", ")}을(를) 추가했어요. ${duplicated.join(", ")}은(는) 이미 있어요.`);
    } else if (added.length) {
      setStatus(`${added.join(", ")}을(를) 재료함에 추가했어요.`);
    } else {
      setStatus(`${duplicated.join(", ")}은(는) 이미 재료함에 있어요.`);
    }
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

  chipsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".pantry-chip-remove");
    if (!btn) return;
    const index = Number(btn.dataset.index);
    const [removed] = pantry.splice(index, 1);
    savePantry(pantry);
    render();
    /* 칩이 사라지는 것 자체가 반응이지만, 직전 "추가했어요" 문구가 남아 있으면
       방금 한 일과 어긋나 보인다. 마지막 조작으로 갱신한다. */
    setStatus(`${removed}을(를) 재료함에서 뺐어요.`);
  });

  render();
}
