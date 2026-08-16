const THEME_KEY = "fridge-chef-theme";

/* ==========================================================================
   절약 체감 — "이거 해먹었어요"를 누를 때마다 쌓이는 개인 기록

   shared.js가 아니라 여기 있는 이유는 홈(index.html)이 shared.js를 불러오지 않기
   때문이다. main.js는 5개 페이지 모두에 실려서, 쌓는 쪽(추천·식단)과 보는 쪽(홈)이
   같은 함수를 쓸 수 있다.

   계정도 서버도 없다. 이 기기의 localStorage에만 쌓인다.
   ========================================================================== */
const SAVINGS_KEY = "fridge-chef-savings";

/* 배달 한 끼의 실질 비용 추정치. 외식 백반 평균가에 배달앱 이중가격제 마크업과
   배달비·수수료를 더해 잡은 값이다(근거는 docs/spec-auto-restock.md).
   정확한 통계가 아니므로 "평균 이만큼 아낀다"는 서비스 차원의 숫자로 쓰지 않는다 —
   개인이 자기 기록을 보는 값이고, 화면에도 추정치임을 적어둔다.
   MVP는 조정 UI 없이 고정값으로 간다. */
const SAVED_PER_MEAL = 13000;

/* 2026년 들어 치킨 한 마리가 3만 원대에 진입했다는 보도 기준. */
const CHICKEN_PRICE = 30000;

/* 사용자가 개발자 도구로 고칠 수도 있고 옛 값이 들어 있을 수도 있다.
   숫자가 아니거나 음수면 0으로 본다 — 이 값은 음수가 될 수 없다. */
function loadSavings() {
  try {
    const raw = Number(JSON.parse(localStorage.getItem(SAVINGS_KEY)));
    return isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

function storeSavings(value) {
  try {
    localStorage.setItem(SAVINGS_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* 방금 한 번의 확인으로 늘어난 금액. 되돌리기가 딱 그만큼만 취소한다 — 실수 정정이지
   "오늘 배달 시켰으니 깎는" 것이 아니다. undoRemove의 lastRemoved와 같은 방식으로
   직전 것 하나만 기억하고, 페이지를 옮기면 사라진다. */
let lastSaved = 0;

function addSavings() {
  const next = loadSavings() + SAVED_PER_MEAL;
  if (!storeSavings(next)) return loadSavings();
  lastSaved = SAVED_PER_MEAL;
  return next;
}

function undoSavings() {
  if (!lastSaved) return loadSavings();
  /* 음수로 내려가지 않게 막는다. 저장이 실패했거나 값이 손상됐을 때 빼기만 성공하면
     기록이 거꾸로 간다. */
  const next = Math.max(0, loadSavings() - lastSaved);
  lastSaved = 0;
  storeSavings(next);
  return next;
}

/* 치킨 몇 마리인지. 소수점을 그대로 노출하지 않고 말로 푼다. */
function chickenText(total) {
  const whole = Math.floor(total / CHICKEN_PRICE);
  const rest = total / CHICKEN_PRICE - whole;

  if (whole === 0) return COPY.SAVINGS.chickenAlmost;
  if (rest === 0) return COPY.SAVINGS.chickenExact(whole);
  /* 다음 마리에 가까우면 "거의 다 왔다"로, 아니면 "넘었다"로 말한다.
     둘 다 올라가는 방향이라 어느 쪽도 깎아내리지 않는다. */
  return rest < 0.5 ? COPY.SAVINGS.chickenOver(whole) : COPY.SAVINGS.chickenNear(whole + 1);
}

/* 홈의 절약 카드. 0원일 때는 통째로 감춘다 — "0원 아꼈어요"는 축하가 아니라 핀잔이다. */
function renderSavings() {
  const section = document.getElementById("savings");
  if (!section) return;

  const total = loadSavings();
  section.hidden = total <= 0;
  if (!total) return;

  const amountEl = document.getElementById("savings-amount");
  const chickenEl = document.getElementById("savings-chicken");
  if (amountEl) amountEl.textContent = COPY.SAVINGS.amount(total);
  if (chickenEl) chickenEl.textContent = chickenText(total);
}

(function applyStoredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const theme = stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

document.addEventListener("DOMContentLoaded", () => {
  renderSavings(); // 홈에만 있는 카드 (요소가 없으면 즉시 반환)

  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("nav-menu");

  if (toggle && menu) {
    const closeMenu = () => {
      if (!menu.classList.contains("open")) return;
      menu.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    };

    toggle.addEventListener("click", () => {
      const isOpen = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });

    menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

    /* 모바일에서 메뉴를 연 뒤 닫는 방법이 햄버거 버튼 재클릭뿐이었다.
       Esc 키와 바깥 영역 클릭으로도 닫히게 해서 갇힌 느낌을 없앤다. */
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const wasOpen = menu.classList.contains("open");
      closeMenu();
      if (wasOpen) toggle.focus();
    });

    document.addEventListener("click", (e) => {
      if (menu.contains(e.target) || toggle.contains(e.target)) return;
      closeMenu();
    });
  }

  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    updateThemeIcon(themeToggle);
    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      /* 시크릿 모드에서는 setItem이 예외를 던진다. 막지 않으면 아이콘 갱신까지 같이 죽어
         화면은 어두워졌는데 버튼은 그대로인 상태가 된다. 저장만 포기하고 전환은 살린다. */
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {}
      updateThemeIcon(themeToggle);
    });
  }
});

function updateThemeIcon(button) {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  button.textContent = isDark ? "☀️" : "🌙";
  button.setAttribute("aria-label", COPY.UI.darkModeToggle);
}
