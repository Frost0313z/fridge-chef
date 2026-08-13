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

/* 재료 한 줄은 { name, amount, addedAt } 세 칸이다.
   addedAt은 냉장고에 넣은 날(YYYY-MM-DD)이고 사용자가 입력하지 않는다 — 넣을 때 자동으로 찍힌다.
   유통기한을 직접 적게 하면 자취생은 안 적는다. 넣은 날짜만 알아도 "뭐부터 먹지"는 답할 수 있다.

   세 칸으로 나누기 전에는 "계란 2개" 같은 문자열 하나였다. 옛 저장분은 읽을 때 변환하되
   저장은 건드리지 않는다 — 변환하다 실패해도 원본이 남아 있어야 냉장고가 비지 않는다.
   다음에 뭔가를 넣거나 지울 때 새 형식으로 자연히 넘어간다. */
function toPantryItem(raw) {
  if (raw && typeof raw === "object") {
    return {
      name: String(raw.name || "").trim(),
      amount: String(raw.amount || "").trim(),
      addedAt: typeof raw.addedAt === "string" ? raw.addedAt : null,
    };
  }
  /* 문자열도 객체도 아니면 재료가 아니다. String()으로 억지로 바꾸면 null이 "null"이라는
     이름의 재료가 되어 화면에 나타난다. 이름을 비워 두면 아래에서 걸러진다. */
  if (typeof raw !== "string") return { name: "", amount: "", addedAt: null };

  /* 옛 저장분은 언제 넣었는지 알 길이 없다. 오늘로 찍지 않고 모른다고 둔다 —
     2주 전에 넣은 것을 오늘 넣었다고 하면 "먼저 먹어라" 신호가 거꾸로 간다. */
  return { ...splitIngredient(raw), addedAt: null };
}

function loadPantry() {
  const saved = loadJson(PANTRY_KEY, []);
  if (!Array.isArray(saved)) return [];
  return saved.map(toPantryItem).filter((item) => item.name);
}

function savePantry(items) {
  return saveJson(PANTRY_KEY, items);
}

/* 화면과 프롬프트가 쓰는 한 줄 표기. 세 칸으로 나누기 전과 같은 모양이라
   서버로 보내는 값도, 이름 비교 규칙도 그대로 쓸 수 있다. */
function pantryText(item) {
  return item.amount ? `${item.name} ${item.amount}` : item.name;
}

/* AI에게 보낼 때만 쓰는 표기. 오래 둔 재료에만 며칠 됐는지를 덧붙인다.
   전부 붙이면 프롬프트만 길어진다 — AI가 오늘 넣은 계란까지 신경 쓸 이유는 없고,
   알아야 할 것은 "이건 곧 상하니 먼저 써라" 하나다. */
function pantryPromptText(item) {
  const age = pantryAgeText(item);
  return age ? `${pantryText(item)} (${age}에 넣음)` : pantryText(item);
}

/* toISOString()은 UTC 기준이라 한국에서 자정 무렵에 하루가 어긋난다.
   스웨덴 로캘이 쓰는 형식이 마침 YYYY-MM-DD라, 로컬 날짜를 그대로 얻는 데 쓴다. */
function todayISO() {
  return new Date().toLocaleDateString("sv-SE");
}

/* 넣은 지 며칠 됐는지. 날짜를 모르거나(옛 저장분) 값이 깨졌으면 null이다.
   양쪽 다 자정 기준으로 맞춰서 "몇 시에 넣었는지"가 결과를 흔들지 않게 한다. */
function daysSince(addedAt) {
  if (typeof addedAt !== "string") return null;
  const then = new Date(`${addedAt}T00:00:00`);
  if (isNaN(then.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - then) / 86400000);
}

/* 사람은 "며칠 됐나"로 생각하지 달력을 역산하지 않는다. 8월 1일보다 "11일 전"이 읽힌다. */
function pantryAgoLabel(addedAt) {
  const days = daysSince(addedAt);
  if (days === null) return "";
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  return `${days}일 전`;
}

/* 며칠부터 "오래됐다"고 볼 것인가. 갓 넣은 재료에 "0일 전"을 붙이면 노이즈가 되고
   정작 봐야 할 오래된 재료가 묻힌다. 대부분의 냉장 재료가 한 주쯤 지나면 신경 쓸
   시점이 되므로 7일로 둔다. */
const PANTRY_AGE_NOTICE_DAYS = 7;

/* 오래된 것만 말한다. 목록은 넣은 순서 그대로라 오래된 재료가 이미 위에 있고,
   여기에 며칠 됐는지만 붙이면 "뭐부터 먹지"의 답이 된다. */
function pantryAgeText(item) {
  const days = daysSince(item.addedAt);
  return days !== null && days >= PANTRY_AGE_NOTICE_DAYS ? pantryAgoLabel(item.addedAt) : "";
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
/* 수량 뒤에 붙는 단위. 긴 것부터 시도해야 "kg"이 "g"로, "봉지"가 "봉"으로 잘리지 않는다.
   서버(api/shopping.py)의 _UNITS와 같은 목록이어야 한다 — 한쪽에만 단위를 추가하면
   화면이 수량으로 지운 글자를 서버는 이름의 일부로 읽어 같은 재료가 둘로 갈라진다. */
const AMOUNT_UNITS = [
  "g", "kg", "ml", "l", "개", "알", "장", "줄", "대", "모", "쪽", "톨", "컵",
  "큰술", "작은술", "스푼", "봉지", "봉", "팩", "캔", "공기", "인분", "주먹",
  "단", "통", "마리", "조각",
].sort((a, b) => b.length - a.length);

const NUMBER_SOURCE = "\\d+(?:\\.\\d+)?(?:\\/\\d+)?";

const QUANTITY_PATTERN = new RegExp(
  `${NUMBER_SOURCE}\\s*(?:${AMOUNT_UNITS.join("|")})?`,
  "g"
);

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

/* 이름과 수량을 나눠 돌려준다. 수량을 켜서 볼 때 둘을 다른 색으로 그리기 위한 것이다 —
   "계란 2개"가 한 덩어리로 보이면 훑을 때 이름과 숫자가 섞여 읽힌다.
   이름을 뺀 나머지를 수량으로 보지 않고, 수량으로 알아본 조각만 모은다.
   그래야 "닭  가슴살 200g"처럼 띄어쓰기가 불규칙해도 어긋나지 않는다. */
function splitIngredient(raw) {
  const text = String(raw).trim();
  const amount = []
    .concat(text.match(/\([^)]*\)/g) || [])
    .concat(text.match(QUANTITY_PATTERN) || [])
    .concat(text.match(VAGUE_AMOUNT_PATTERN) || [])
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

  const name = stripAmounts(text);
  /* 이름이 안 남으면(수량만 적은 입력) 원문을 이름으로 두고 수량은 비운다.
     같은 글자를 이름과 수량 양쪽에 두 번 그리지 않기 위해서다. */
  return name ? { name, amount } : { name: text, amount: "" };
}

/* 같은 것을 다르게 세는 말과, 배수만 다른 단위. 합칠 수 있어야 "계란 2개"와 "계란 3알"이
   5개로 모인다. api/shopping.py의 같은 표와 짝이다. 확실히 같은 것만 넣는다 —
   마늘 "1통"과 "1톨"은 양이 열 배 차이라 묶으면 안 된다. */
const UNIT_ALIASES = { 알: "개" };
const UNIT_SCALES = { kg: ["g", 1000], l: ["ml", 1000] };

const SINGLE_AMOUNT_PATTERN = new RegExp(
  `(${NUMBER_SOURCE})\\s*(${AMOUNT_UNITS.join("|")})?`
);

/* 수량 하나를 숫자와 단위로 읽는다. 못 읽으면 null이다 — "0"이 아니라 "모른다"이므로,
   부르는 쪽은 0으로 치지 말고 계산을 포기해야 한다.
   서버(api/shopping.py)의 parse_line과 같은 규칙이어야 한다. 한쪽만 고치면
   장보기는 6개를 사라고 해놓고 냉장고에는 다른 숫자가 들어간다. */
function parseAmount(text) {
  const match = String(text || "").match(SINGLE_AMOUNT_PATTERN);
  if (!match) return null;

  const raw = match[1];
  let value;
  if (raw.includes("/")) {
    const [top, bottom] = raw.split("/").map(Number);
    value = bottom ? top / bottom : NaN;
  } else {
    value = Number(raw);
  }
  if (!isFinite(value)) return null;

  let unit = match[2] || "";
  unit = UNIT_ALIASES[unit] || unit;
  if (UNIT_SCALES[unit]) {
    value *= UNIT_SCALES[unit][1];
    unit = UNIT_SCALES[unit][0];
  }
  return { value, unit };
}

/* 살 수 있는 단위로 올려 적는다. 0.5모가 필요해도 반 모는 못 사고,
   "2.0개"가 아니라 "2개"라고 적어야 목록으로 읽힌다.
   0.5 + 0.5가 0.999...로 떨어져도 2개가 되지 않도록 여유를 두고 올린다. */
function formatAmount(value, unit) {
  return `${Math.ceil(value - 1e-9)}${unit}`;
}

/* 두 수량을 더한다. 단위가 다르거나 못 읽으면 null 이다 — 숫자를 지어내지 않는다. */
function addAmounts(a, b) {
  const left = parseAmount(a);
  const right = parseAmount(b);
  if (!left || !right || left.unit !== right.unit) return null;
  return formatAmount(left.value + right.value, left.unit);
}

/* 재료 줄 목록("계란 4개", ...)에서 그 재료의 수량을 단위별로 합친다.
   못 읽은 수량은 0으로 세지 않고 빼둔다 — 모르는 것을 없는 것으로 만들면 안 된다. */
function amountIn(lines, name, unit) {
  const key = normalizeIngredient(name);
  return lines.reduce((sum, line) => {
    if (normalizeIngredient(splitIngredient(line).name) !== key) return sum;
    const parsed = parseAmount(line);
    return parsed && parsed.unit === unit ? sum + parsed.value : sum;
  }, 0);
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
  return pantry.map((item) => normalizeIngredient(item.name)).filter(Boolean);
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

/* 로딩 표시 / 에러 문구 / 제출 버튼 잠금 — 두 폼이 쓰는 세트를 한 번에 만들어준다.
   빈 문구를 넣는 것이 곧 지우는 것이다 — 숨기기를 따로 두면 "문구는 남았는데 숨김"이 가능해진다. */
function createFormStatus({ loadingEl, errorEl, submitBtn }) {
  return {
    setLoading(isLoading) {
      loadingEl.hidden = !isLoading;
      submitBtn.disabled = isLoading;
    },
    setError(message) {
      errorEl.textContent = message || "";
      errorEl.hidden = !message;
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
  const head = pantry.slice(0, 2).map((item) => item.name).join(", ");
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
  const today = todayISO();

  items.forEach((raw) => {
    /* 이름이 같으면 같은 재료다. "계란"과 "계란 2개"를 두 줄로 쌓지 않는다. */
    const key = normalizeIngredient(raw);
    const at = pantry.findIndex((p) => normalizeIngredient(p.name) === key);

    if (at < 0) {
      pantry.push({ ...splitIngredient(raw), addedAt: today });
      added.push(raw);
      return;
    }

    const current = pantry[at];
    if (pantryText(current) === raw) {
      unchanged.push(raw);
      return;
    }

    /* 다시 넣는 행위는 "지금은 이만큼이다"라는 최신 선언으로 본다.
       막으면 수량을 고칠 방법이 없어지고, 물어보면 매번 한 단계가 늘어난다. */
    updated.push({ from: pantryText(current), to: raw });
    /* 넣은 날짜는 그대로 둔다. 수량만 고쳤는데 날짜가 새로 찍히면 2주 된 두부가
       오늘 넣은 것으로 둔갑해 "먼저 먹어라" 신호를 잃는다. */
    pantry[at] = { ...splitIngredient(raw), addedAt: current.addedAt };
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
  /* 저장이 안 됐으면 되돌릴 것도 없다 (원래 값이 그대로 남아 있다).
     되돌릴 때 넣은 날짜까지 살아나야 하므로 항목을 통째로 들고 있는다. */
  lastRemoved = stored ? { item: removed, index } : null;
  return { removed: pantryText(removed), stored };
}

/* 확인창 대신 되돌리기를 둔다. 확인창은 맞게 지우는 99번을 방해하고,
   되돌리기는 틀린 1번만 구제한다. 이쪽이 A4가 실제로 요구하는 형태다. */
function undoRemove() {
  if (!lastRemoved) return null;

  const pantry = loadPantry();
  pantry.splice(Math.min(lastRemoved.index, pantry.length), 0, lastRemoved.item);
  const stored = savePantry(pantry);
  const name = pantryText(lastRemoved.item);
  lastRemoved = null;
  return { name, stored };
}

/* 평소에는 이름만 보여준다. 훑는 목적은 "뭐가 있는지"지 몇 개인지가 아니고,
   30개에 수량과 날짜까지 붙으면 화면이 곁가지로 뒤덮인다. 필요할 때 켜서 본다.
   (같은 재료가 한 줄로 합쳐지기 때문에 숨겨도 안전하다 — 합치기가 없으면
   "계란 2개"와 "계란 5개"가 둘 다 "계란"으로 보여 같은 게 둘인 것처럼 된다)

   저장 키는 showAmounts 그대로 둔다. 수량만 보여주던 시절에 정한 이름인데,
   지금 바꾸면 이미 켜둔 사용자의 설정이 초기화된다. */
function showDetails() {
  return Boolean(loadPrefs().showAmounts);
}

/* 칩만 돌려준다. 감싸는 상자는 부르는 쪽이 이미 갖고 있다
   (냉장고 화면은 #pantry-chips, 조회 바는 새로 그리는 div). */
function pantryChipsHtml(pantry, withDetails) {
  return pantry
    .map((item, index) => {
      /* 오래된 재료에만 붙는다. 자세히 보기와 무관하게 항상 보인다 —
         "몇 개 있나"는 골라 볼 정보지만 "이거 상하겠다"는 놓치면 안 되는 정보다. */
      const badge = pantryAgeText(item);

      /* 자세히 보기에서 이름 뒤에 붙는 것들. 배지가 이미 며칠 됐는지 말하고 있으면
         같은 말을 두 번 하지 않는다. */
      const meta = withDetails
        ? [item.amount, badge ? "" : pantryAgoLabel(item.addedAt)].filter(Boolean).join(" · ")
        : "";

      /* 화면에서 곁가지를 숨겨도 삭제는 원본 기준이고, 스크린리더에는 원문을 읽어준다. */
      return `
      <span class="pantry-chip">
        ${escapeHtml(item.name)}
        ${meta ? `<span class="pantry-chip-meta">${escapeHtml(meta)}</span>` : ""}
        ${badge ? `<span class="pantry-chip-age">${badge}</span>` : ""}
        <button type="button" class="pantry-chip-remove" data-index="${index}"
          aria-label="${escapeHtml(pantryText(item))} 삭제">×</button>
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
        ? `<div class="pantry-chips">${pantryChipsHtml(pantry, showDetails())}</div>`
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

/* 손이 몇 px 흔들리는 것과 끌어 올리는 것을 가른다 (js/mealplan.js의 가로 밀기와 같은 값). */
const SHEET_DRAG_THRESHOLD_PX = 6;

/* 아래에서 위로 끌어 여는 시트.

   탭으로 여닫는 것은 <details>의 기본 동작 그대로 둔다 — 키보드(Enter/Space)와 스크린리더
   모두 그 위에서 이미 동작하고, 여닫힘 상태도 알아서 알려준다. 끌기는 그 위에 얹기만 한다.

   끄는 동안 손을 따라오게 하려면 내용이 실제로 그려져 있어야 하므로, 문턱을 넘는 순간
   details를 먼저 열고 시트를 그만큼 아래로 내려둔다(열렸지만 화면 밖). 그 상태에서
   translateY를 줄여가면 아래에서 올라오는 것으로 보인다. */
function initPantryBarDrag(barEl) {
  const summaryEl = barEl.querySelector("summary");
  const bodyEl = barEl.querySelector(".pantry-bar-body");
  if (!summaryEl || !bodyEl) return;

  let pointerId = null;
  let startY = 0;
  let height = 0;
  let openedAtStart = false;
  let dragged = false;

  function settle(open) {
    barEl.classList.add("is-settling");
    barEl.style.transform = open ? "translateY(0)" : `translateY(${height}px)`;

    const finish = () => {
      barEl.classList.remove("is-settling");
      barEl.style.transform = "";
      if (!open) barEl.open = false;
    };

    /* 모션을 줄이도록 설정한 사용자에게는 전환이 걸리지 않아 transitionend가 오지 않는다.
       그 경우를 기다리면 시트가 열린 채로 굳는다. */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else barEl.addEventListener("transitionend", finish, { once: true });
  }

  summaryEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    pointerId = e.pointerId;
    startY = e.clientY;
    openedAtStart = barEl.open;
    dragged = false;
  });

  summaryEl.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;

    const movedUp = startY - e.clientY;
    if (!dragged) {
      if (Math.abs(movedUp) < SHEET_DRAG_THRESHOLD_PX) return;
      dragged = true;
      barEl.classList.remove("is-settling");
      barEl.classList.add("is-dragging");
      if (!barEl.open) barEl.open = true;
      height = bodyEl.offsetHeight;
      summaryEl.setPointerCapture(pointerId);
    }

    /* 열려 있었으면 내리는 방향으로, 닫혀 있었으면 올리는 방향으로 따라온다.
       0(다 열림)과 height(다 닫힘) 사이를 벗어나지 않게 묶는다. */
    const offset = openedAtStart ? -movedUp : height - movedUp;
    barEl.style.transform = `translateY(${Math.min(Math.max(offset, 0), height)}px)`;
  });

  function endDrag(e) {
    if (e.pointerId !== pointerId) return;
    if (summaryEl.hasPointerCapture(pointerId)) summaryEl.releasePointerCapture(pointerId);
    pointerId = null;
    if (!dragged) return;

    barEl.classList.remove("is-dragging");
    /* 손을 뗀 자리가 곧 의도다. 절반을 넘겨 올렸으면 열고, 아니면 되돌린다 —
       조금 끌었다 놓았을 때 열려버리면 실수로 여는 일이 잦아진다. */
    const offset = parseFloat(barEl.style.transform.replace(/[^\d.-]/g, "")) || 0;
    settle(offset < height / 2);
  }

  summaryEl.addEventListener("pointerup", endDrag);
  summaryEl.addEventListener("pointercancel", endDrag);

  /* 끌고 손을 떼면 click이 따라 나오고, summary의 click은 <details>를 도로 토글한다.
     끌어서 연 시트가 그 자리에서 닫혀버리므로 막는다. 그냥 탭이면(문턱 아래) 손대지 않는다.
     dragged는 다음 pointerdown이 false로 시작하므로 여기서 되돌리지 않는다. */
  summaryEl.addEventListener("click", (e) => {
    if (dragged) e.preventDefault();
  });

  /* iOS는 키보드가 올라와도 fixed 요소를 밀어 올려주지 않아, 시트 안의 입력칸이 키보드
     뒤로 숨는다. 재료를 적는 것이 이 시트의 본래 목적이므로 그러면 기능이 없는 것과 같다.
     보이는 영역이 줄어든 만큼 시트를 올린다. */
  if (window.visualViewport) {
    const lift = () => {
      const view = window.visualViewport;
      const hidden = window.innerHeight - view.height - view.offsetTop;
      barEl.style.bottom = hidden > 0 ? `${hidden}px` : "";
    };
    window.visualViewport.addEventListener("resize", lift);
    window.visualViewport.addEventListener("scroll", lift);
  }
}

function initPantryBar() {
  const barEl = document.getElementById("pantry-bar");
  if (!barEl) return;

  initPantryBarDrag(barEl);

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
    chipsEl.innerHTML = pantryChipsHtml(pantry, showDetails());
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
    const on = showDetails();
    amountToggle.textContent = on ? "간단히" : "자세히";
    amountToggle.setAttribute("aria-pressed", String(on));
    amountToggle.classList.toggle("is-on", on);
  }

  if (amountToggle) {
    syncAmountToggle();
    amountToggle.addEventListener("click", () => {
      savePrefs({ showAmounts: !showDetails() });
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

/* ── 식단 날짜 이름 ────────────────────────────────────────────────────────────
   식단 계획과 장보기가 함께 쓴다. 장보기의 "왜 사야 하나요?"가 어느 끼니에 쓰이는지를
   말할 때 같은 표기여야 한다 — 한쪽만 "1일차"로 남으면 없앤 혼란이 되살아난다. */
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/* 저장된 시각(UTC ISO)에서 그 자리의 날짜만 꺼낸다.
   toISOString()은 UTC라 한국에서 자정 무렵 하루가 어긋난다. 스웨덴 로캘이 마침
   YYYY-MM-DD라 로컬 날짜를 그대로 얻는 데 쓴다 (todayISO와 같은 이유). */
function localDateOf(iso) {
  const at = new Date(iso);
  return isNaN(at.getTime()) ? null : at.toLocaleDateString("sv-SE");
}

/* 계획의 1일차(startDate)로부터 n일 뒤. 시작일을 모르는 옛 계획은 null이다. */
function dayDate(startDate, offset) {
  if (!startDate) return null;
  const date = new Date(`${startDate}T00:00:00`);
  if (isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + offset);
  return date;
}

/* 오늘·내일에만 배지를 붙인다. 달력을 역산하지 않고 곧바로 읽히는 것이 이 둘뿐이고,
   모든 칸에 배지를 달면 7칸이 배지로 뒤덮여 정작 오늘이 묻힌다.
   지난주에 짠 계획이면 아무 칸에도 안 붙는데, 그 자체가 "묵은 계획"이라는 신호다. */
function nearBadge(date) {
  const days = Math.round((date - new Date(`${todayISO()}T00:00:00`)) / 86400000);
  if (days === 0) return "오늘";
  if (days === 1) return "내일";
  return "";
}

/* "1일차"는 자리를 가리키는 **열쇠**다 — 저장분·서버 프롬프트·편집이 모두 이 값으로 칸을
   찾는다. 열쇠를 실제 날짜로 바꾸면 저장해둔 계획이 통째로 어긋나고, 날짜가 지날 때마다
   열쇠까지 따라 바뀌어야 한다. 그래서 열쇠는 그대로 두고 화면에 붙는 이름만 날짜로 만든다.

   사람은 "3일차 저녁"으로 기억하지 않는다. "목요일 저녁"으로 기억한다.
   요일만 적으면 다음 주 목요일과 헷갈리므로 날짜를 함께 적는다. */
function dayInfo(key, startDate) {
  const date = dayDate(startDate, (parseInt(key, 10) || 1) - 1);
  if (!date) return { key, label: key, badge: "", aria: key };

  const label = `${date.getMonth() + 1}/${date.getDate()} (${WEEKDAYS[date.getDay()]})`;
  const badge = nearBadge(date);
  /* 스크린리더는 배지를 따로 읽지 못하고 지나칠 수 있어, 읽어줄 이름에는 먼저 넣는다. */
  return { key, label, badge, aria: badge ? `${badge} ${label}` : label };
}

function loadSavedPlan() {
  const saved = loadJson(MEALPLAN_KEY, null);
  return saved && Array.isArray(saved.plan) ? saved : null;
}

/* 추천 이력은 레시피 추천 화면이 쌓지만, 식단 계획 화면도 읽는다 —
   빈 자리에 메뉴를 넣을 때 "최근 추천받은 요리"에서 고를 수 있게 하기 위해서다.
   저장된 항목이 요리 하나를 통째로 담고 있어(이름·검색어·재료) 그대로 식단 칸에 넣을 수 있다.

   이름 없는 항목이 하나라도 섞이면 렌더에서 예외가 나고, 그 예외가 화면을 중간에 끊는다.
   읽을 때 한 번 걸러둔다. */
const HISTORY_KEY = "fridge-chef-history";
const HISTORY_LIMIT = 5;

function loadHistory() {
  const saved = loadJson(HISTORY_KEY, []);
  return Array.isArray(saved) ? saved.filter((r) => r && r.name) : [];
}

/* 페이지마다 초기화 호출을 적어두면 페이지가 늘 때 빠뜨리기 쉽다.
   해당 요소가 있는 페이지에서만 알아서 동작하게 둔다. */
document.addEventListener("DOMContentLoaded", () => {
  initPantry(); // 냉장고 페이지 (요소가 없으면 즉시 반환)
  renderPantryBar(); // 나머지 기능 페이지의 조회 바
  initPantryBar();
});
