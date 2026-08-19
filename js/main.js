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

/* toISOString()은 UTC 기준이라 한국에서 자정 무렵에 하루가 어긋난다.
   스웨덴 로캘이 쓰는 형식이 마침 YYYY-MM-DD라, 로컬 날짜를 그대로 얻는 데 쓴다.

   shared.js가 아니라 여기 있는 이유는 아래 절약 기록과 같다 — 홈은 shared.js를 안 부르는데
   날짜 규칙이 갈라지면 자정 언저리에 냉장고의 addedAt과 절약 기록의 날짜가 어긋난다.
   main.js는 다섯 페이지 모두에서 shared.js보다 먼저 실린다. */
function todayISO() {
  return new Date().toLocaleDateString("sv-SE");
}

/* 저장 형태는 { legacy, days }다.

   days는 "YYYY-MM-DD" → 그날 쌓인 금액. 냉장고의 addedAt과 같은 날짜 형식을 쓴다.
   날짜를 붙여야 "이번 주 얼마"를 셀 수 있다 — 누적 숫자 하나로는 이번 주에 한 번도
   안 해먹었는지, 원래 그만큼인지 구분이 안 된다.

   legacy는 날짜별로 쪼개기 전에 쌓아둔 총액이다. 버리지 않는 이유는 그동안 모은 것이
   화면에서 0으로 보이면 안 되기 때문이고, 주간·월간에 넣지 않는 이유는 그 돈이 언제
   쌓였는지 알 방법이 없어서다. 누적에만 더한다.

   사용자가 개발자 도구로 고칠 수도 있고 옛 값이 들어 있을 수도 있다. 숫자가 아니거나
   음수인 값은 0으로 본다 — 이 값들은 음수가 될 수 없다. */
function loadSavings() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(SAVINGS_KEY));
  } catch {
    return { legacy: 0, days: {} };
  }

  /* 날짜별로 쪼개기 전의 저장분. 숫자 하나가 통째로 들어 있다. */
  if (typeof raw === "number") return { legacy: positive(raw), days: {} };
  if (!raw || typeof raw !== "object") return { legacy: 0, days: {} };

  const days = {};
  Object.entries(raw.days || {}).forEach(([date, won]) => {
    const value = positive(Number(won));
    if (isDateKey(date) && value) days[date] = value;
  });
  return { legacy: positive(Number(raw.legacy)), days };
}

function positive(value) {
  return isFinite(value) && value > 0 ? value : 0;
}

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function storeSavings(record) {
  try {
    localStorage.setItem(SAVINGS_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/* 누적은 절대 줄지 않는 숫자다(되돌리기가 방금 것을 취소하는 경우만 예외).
   legacy를 여기에만 더하는 이유는 위 loadSavings 주석 참고. */
function savingsTotal(record) {
  const rec = record || loadSavings();
  return Object.values(rec.days).reduce((sum, won) => sum + won, rec.legacy);
}

/* 이번 주는 월요일에 시작한다. getDay()는 일요일이 0이라 월요일 기준으로 돌려놓는다.
   전부 로컬 시간이다 — 사용자가 "이번 주"라고 느끼는 것은 자기 시계 기준이다. */
function weekStartISO(todayIso) {
  const date = new Date(`${todayIso || todayISO()}T00:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toLocaleDateString("sv-SE");
}

/* 날짜 키가 YYYY-MM-DD로 자릿수가 고정이라 문자열 비교가 곧 날짜 비교다. */
function savingsWeek(record, todayIso) {
  const rec = record || loadSavings();
  const from = weekStartISO(todayIso);
  const to = addDaysISO(from, 6);
  return Object.entries(rec.days)
    .filter(([date]) => date >= from && date <= to)
    .reduce((sum, [, won]) => sum + won, 0);
}

function savingsMonth(record, todayIso) {
  const rec = record || loadSavings();
  const prefix = (todayIso || todayISO()).slice(0, 7);
  return Object.entries(rec.days)
    .filter(([date]) => date.startsWith(prefix))
    .reduce((sum, [, won]) => sum + won, 0);
}

function addDaysISO(iso, days) {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("sv-SE");
}

/* 방금 한 번의 확인으로 늘어난 금액과 그것이 붙은 날짜. 되돌리기가 딱 그만큼만 취소한다 —
   실수 정정이지 "오늘 배달 시켰으니 깎는" 것이 아니다. undoRemove의 lastRemoved와 같은
   방식으로 직전 것 하나만 기억하고, 페이지를 옮기면 사라진다. */
let lastSaved = null;

/* 돌려주는 값은 예전과 같은 "지금까지 누적"이다 — 확인 직후 문구(COPY.SAVINGS.inline)가
   그 숫자를 쓴다. */
function addSavings() {
  const record = loadSavings();
  const today = todayISO();
  record.days[today] = (record.days[today] || 0) + SAVED_PER_MEAL;
  if (!storeSavings(record)) return savingsTotal();
  lastSaved = { date: today, won: SAVED_PER_MEAL };
  return savingsTotal(record);
}

function undoSavings() {
  if (!lastSaved) return savingsTotal();

  const record = loadSavings();
  const { date, won } = lastSaved;
  lastSaved = null;
  /* 음수로 내려가지 않게 막는다. 저장이 실패했거나 값이 손상됐을 때 빼기만 성공하면
     기록이 거꾸로 간다. 0이 된 날짜는 아예 지운다 — 아무 일도 없던 날과 같다. */
  const rest = Math.max(0, (record.days[date] || 0) - won);
  if (rest) record.days[date] = rest;
  else delete record.days[date];

  storeSavings(record);
  return savingsTotal(record);
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

/* 지금 카드가 보고 있는 기간. 기본은 주간이고 저장하지 않는다 — 페이지를 새로 열면
   언제나 이번 주부터다. 냉장고의 "자세히"는 목록을 훑는 내내 유지돼야 해서 기억하지만,
   이쪽은 한 번 들여다보는 것이라 다음 방문까지 끌고 갈 이유가 없다. */
let savingsShowMonth = false;

/* 홈의 절약 카드. 제목과 큰 숫자가 함께 기간을 따라가고, 그 밖의 숫자는 화면에 두지 않는다 —
   주간·월간·누적을 한꺼번에 늘어놓으면 어느 것이 지금 내 성적인지 읽는 데 시간이 걸린다.

   치킨 환산은 월간에만 붙인다. 주간은 13,000원 단위라 한 마리(30,000원)를 못 채우는 주가
   많고, 그러면 "조금만 더 모으면"만 반복돼 말이 죽는다.

   카드를 감출지는 누적으로 판단한다. 한 번도 안 눌러본 사람에게 "0원 아꼈어요"는 축하가
   아니라 핀잔이라 통째로 감추지만, 그건 이번 주에만 안 해먹은 사람과 다른 이야기다 —
   뒤엣것까지 감추면 어제까지 보이던 카드가 소리 없이 사라진다. 누적에는 날짜를 모르는
   옛 저장분(legacy)도 들어가므로, 예전부터 쓰던 사람의 카드가 이 판단에서 빠지지 않는다. */
function renderSavings() {
  const section = document.getElementById("savings");
  if (!section) return;

  const record = loadSavings();
  section.hidden = savingsTotal(record) <= 0;
  if (section.hidden) return;

  const month = savingsShowMonth;
  const won = month ? savingsMonth(record) : savingsWeek(record);

  const titleEl = document.getElementById("savings-title");
  if (titleEl) titleEl.textContent = month ? COPY.SAVINGS.titleMonth : COPY.SAVINGS.titleWeek;

  const amountEl = document.getElementById("savings-amount");
  if (amountEl) amountEl.textContent = COPY.SAVINGS.amount(won);

  const chickenEl = document.getElementById("savings-chicken");
  if (chickenEl) {
    chickenEl.textContent = month ? chickenText(won) : "";
    chickenEl.hidden = !month;
  }

  const toggle = document.getElementById("savings-range-toggle");
  if (toggle) {
    toggle.textContent = month ? COPY.SAVINGS.rangeToWeek : COPY.SAVINGS.rangeToMonth;
    toggle.setAttribute("aria-pressed", String(month));
    toggle.classList.toggle("is-on", month);
  }
}

/* ==========================================================================
   기록 옮기기 — 내보내기 / 가져오기

   계정도 서버도 없어서 이 브라우저를 벗어나면 전부 사라진다. 냉장고야 다시 적으면 되지만
   "지금까지 아낀 돈"은 다시 만들 수 없는 기록이라, 브라우저를 바꾸는 순간 0이 된다.
   파일 하나로 들고 다니게 해서 그 구멍을 막는다.

   여기(홈)에 두는 이유는 테마 토글과 같다 — 한 번 하고 마는 설정성 조작은 기능 화면이
   아니라 홈에 모은다.

   담는 기준을 키 목록이 아니라 접두사로 잡는 이유는, 나중에 저장 키가 하나 늘었을 때
   여기를 같이 고치는 것을 잊으면 그 데이터만 조용히 안 따라오기 때문이다. */
const STORAGE_PREFIX = "fridge-chef-";

/* 스키마가 바뀌면 올린다. 파일에 적어두지 않으면 나중에 옛 파일을 읽을 때 무엇이 다른지
   알 방법이 없다. */
const BACKUP_VERSION = 1;

function backupKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
}

/* 값을 파싱하지 않고 저장된 문자열 그대로 담는다. 읽어서 다시 쓰는 과정이 없으면
   되돌릴 때 원본과 한 글자도 달라지지 않는다. */
function collectBackup() {
  const data = {};
  backupKeys().forEach((key) => {
    data[key] = localStorage.getItem(key);
  });
  return { version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

/* 파일에서 읽은 것이 우리 파일이 맞는지 본다. 무엇이 틀렸는지에 따라 다른 말을 해야
   사용자가 다음에 할 일을 안다(A2의 "원인별로 다르게 말한다"). */
function readBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: COPY.BACKUP.broken };
  }

  if (!parsed || typeof parsed !== "object" || typeof parsed.version !== "number") {
    return { error: COPY.BACKUP.notOurs };
  }
  if (parsed.version > BACKUP_VERSION) return { error: COPY.BACKUP.tooNew };
  if (!parsed.data || typeof parsed.data !== "object") return { error: COPY.BACKUP.notOurs };

  /* 우리 접두사가 붙은 것만 받는다. 파일이 손을 탔더라도 남의 키를 이 브라우저에
     심지 않는다. */
  const data = {};
  Object.entries(parsed.data).forEach(([key, value]) => {
    if (key.startsWith(STORAGE_PREFIX) && typeof value === "string") data[key] = value;
  });
  if (!Object.keys(data).length) return { error: COPY.BACKUP.empty };

  return { data };
}

/* 덮어쓰기다. 지금 것을 먼저 지우는 이유는, 남겨두면 파일에 없는 키가 그대로 살아남아
   "파일 그대로"가 아니게 되기 때문이다. */
function restoreBackup(data) {
  const snapshot = {};
  backupKeys().forEach((key) => { snapshot[key] = localStorage.getItem(key); });
  try {
    backupKeys().forEach((key) => localStorage.removeItem(key));
    Object.entries(data).forEach(([key, value]) => localStorage.setItem(key, value));
    return true;
  } catch {
    /* 실패하면 쓰다 만 상태로 남기지 않는다 — 지웠던 원래 값을 되돌리고,
       새로 쓰다 만 키 중 원래 없던 것은 지운다. */
    backupKeys().forEach((key) => {
      if (!(key in snapshot)) localStorage.removeItem(key);
    });
    Object.entries(snapshot).forEach(([key, value]) => localStorage.setItem(key, value));
    return false;
  }
}

function initBackup() {
  const exportBtn = document.getElementById("backup-export");
  const importBtn = document.getElementById("backup-import");
  const fileEl = document.getElementById("backup-file");
  const statusEl = document.getElementById("backup-status");
  if (!exportBtn || !importBtn || !fileEl) return;

  function setStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.hidden = !message;
  }

  exportBtn.addEventListener("click", () => {
    const backup = collectBackup();
    if (!Object.keys(backup.data).length) {
      setStatus(COPY.BACKUP.nothing);
      return;
    }

    const fileName = `${STORAGE_PREFIX}${todayISO()}.json`;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(COPY.BACKUP.exported(fileName));
  });

  /* 파일 선택창은 <input type="file">만 열 수 있다. 그 입력칸을 그대로 두면 생김새를
     맞출 수 없고, <label>로 감싸면 키보드 초점이 갈 곳이 없어진다. 버튼이 대신 연다. */
  importBtn.addEventListener("click", () => fileEl.click());

  fileEl.addEventListener("change", async () => {
    const file = fileEl.files && fileEl.files[0];
    /* 같은 파일을 다시 골랐을 때도 change가 오게 값을 비운다. */
    fileEl.value = "";
    if (!file) return;

    let text = "";
    try {
      text = await file.text();
    } catch {
      setStatus(COPY.BACKUP.broken);
      return;
    }

    const result = readBackup(text);
    if (result.error) {
      setStatus(result.error);
      return;
    }

    /* 되돌릴 수 없는 조작이라 여기서 한 번 묻는다(A4). 확인 전에는 아무것도 지우지 않는다. */
    if (!confirm(COPY.BACKUP.confirm)) {
      setStatus(COPY.BACKUP.canceled);
      return;
    }

    if (!restoreBackup(result.data)) {
      setStatus(COPY.BACKUP.failed);
      return;
    }

    setStatus(COPY.BACKUP.imported);
    location.reload();
  });
}

(function applyStoredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const theme = stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

document.addEventListener("DOMContentLoaded", () => {
  renderSavings(); // 홈에만 있는 카드 (요소가 없으면 즉시 반환)

  initBackup(); // 홈에만 있는 구역 (요소가 없으면 즉시 반환)

  const savingsToggle = document.getElementById("savings-range-toggle");
  if (savingsToggle) {
    savingsToggle.addEventListener("click", () => {
      savingsShowMonth = !savingsShowMonth;
      renderSavings();
    });
  }

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
