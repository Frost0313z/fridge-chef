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
  if (!input || !chipsEl) return;

  let pantry = loadPantry();

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
    if (!newItems.length) return;

    let changed = false;
    newItems.forEach((item) => {
      if (!pantry.includes(item)) {
        pantry.push(item);
        changed = true;
      }
    });

    if (changed) {
      savePantry(pantry);
      render();
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
    pantry.splice(index, 1);
    savePantry(pantry);
    render();
  });

  render();
}
