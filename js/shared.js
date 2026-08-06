/* recipe.html과 mealplan.html이 공용으로 쓰는 재료함/선호값 저장 로직. main.js 다음, 페이지 전용 스크립트보다 먼저 로드해야 함. */

const PANTRY_KEY = "fridge-chef-pantry";
const PREFS_KEY = "fridge-chef-prefs";

function loadPantry() {
  try {
    const saved = JSON.parse(localStorage.getItem(PANTRY_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function savePantry(items) {
  localStorage.setItem(PANTRY_KEY, JSON.stringify(items));
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function savePrefs(partial) {
  const merged = { ...loadPrefs(), ...partial };
  localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
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
