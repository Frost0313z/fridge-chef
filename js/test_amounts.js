/* 화면 쪽 자체 점검. 실행: node js/test_amounts.js

   수량 계산은 "무엇이 장보기 목록에서 사라지는가"를 정한다. 틀리면 살 것을 조용히 지우거나
   이미 산 것을 계속 띄운다 — 둘 다 사용자가 원인을 알 수 없는 종류의 고장이다.
   서버(api/shopping.py)와 같은 규칙이어야 하므로, 한쪽만 고쳤을 때 여기서 걸린다.

   브라우저 API는 이 파일이 최소한만 흉내낸다. 프레임워크 없이 assert만 쓰는 것은
   api/test_handlers.py와 같은 방침이다. */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const store = {};

const sandbox = {
  console,
  localStorage: {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
  },
  /* 스크립트가 로드되면서 거는 초기화는 여기서 아무것도 하지 않는다 — 화면이 없기 때문이다. */
  /* main.js가 로드되자마자 테마를 documentElement에 쓴다. 화면이 없으므로 받아만 둔다. */
  document: {
    addEventListener: () => {},
    getElementById: () => null,
    documentElement: { setAttribute: () => {}, getAttribute: () => null },
  },
  window: { matchMedia: () => ({ matches: false }) },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const file of ["js/copy.js", "js/main.js", "js/shared.js", "js/shopping.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), sandbox, { filename: file });
}

const {
  parseAmount, addAmounts, amountIn, formatAmount, splitIngredient, dayInfo,
  remainingAmount, buyIntoPantry, loadPantry,
  consumeFromPantry, undoRemove, removeFromPantry,
  missingIngredients, planShortages, pantryNamesFor,
  loadSavings, addSavings, undoSavings, chickenText,
  savingsTotal, savingsWeek, savingsMonth, weekStartISO, todayISO,
  loadFavorites, isFavorite, toggleFavorite,
} = sandbox;

/* copy.js의 COPY는 const라 전역 객체에 붙지 않는다(함수 선언만 붙는다).
   같은 컨텍스트 안에서 이름을 평가해 꺼내온다. */
const COPY = vm.runInContext("COPY", sandbox);
/* 상한값도 const라 같은 방식으로 꺼낸다 — 테스트가 숫자를 따로 적어두면 코드와 갈라진다. */
const FAVORITES_LIMIT = vm.runInContext("FAVORITES_LIMIT", sandbox);
const HISTORY_LIMIT = vm.runInContext("HISTORY_LIMIT", sandbox);

let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  const detail = ok ? "" : `  → ${JSON.stringify(actual)} (기대: ${JSON.stringify(expected)})`;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail}`);
}

function setPantry(items) {
  store["fridge-chef-pantry"] = JSON.stringify(items);
}

// 수량 읽기 — api/shopping.py의 parse_line과 같은 답이 나와야 한다.
check("계란 2개", parseAmount("계란 2개"), { value: 2, unit: "개" });
check("분수", parseAmount("대파 1/2대"), { value: 0.5, unit: "대" });
check("kg은 g으로 맞춘다", parseAmount("돼지고기 1.5kg"), { value: 1500, unit: "g" });
check("알과 개는 같은 것을 센다", parseAmount("계란 3알"), { value: 3, unit: "개" });
check("l은 ml로 맞춘다", parseAmount("우유 1l"), { value: 1000, unit: "ml" });
check("수량 없음은 0이 아니라 모름", parseAmount("두부"), null);
check("숫자 없는 수량 표현", parseAmount("김치 조금"), null);
// 레시피 데이터가 "적당량"류를 4천 번 넘게 쓴다. 안 떼면 "소금"과 "소금 적당량"이 갈라진다.
check("적당량도 수량 표현", parseAmount("소금 적당량"), null);
check("적당량은 이름에 남지 않는다", splitIngredient("소금 적당량").name, "소금");
check("취향껏도 마찬가지", splitIngredient("설탕 취향껏").name, "설탕");

// 이름 나누기 — 단위 목록을 늘렸을 때 이름이 깎이지 않는지.
check("대파 1단의 이름", splitIngredient("대파 1단").name, "대파");
check("통마늘의 통은 단위가 아니다", splitIngredient("통마늘").name, "통마늘");

// 더하기 — 못 더하면 숫자를 지어내지 않고 null.
check("4개 + 6개", addAmounts("4개", "6개"), "10개");
check("500ml + 1l", addAmounts("500ml", "1l"), "1500ml");
check("반 모 두 번은 한 모", addAmounts("1/2모", "1/2모"), "1모");
check("단위가 다르면 못 더한다", addAmounts("1팩", "500ml"), null);
check("한쪽 수량을 모르면 못 더한다", addAmounts("", "6개"), null);

check("같은 재료의 수량을 모은다", amountIn(["계란 4개", "두부 1모", "계란 2개"], "계란", "개"), 6);
check("단위가 다르면 세지 않는다", amountIn(["계란 4개"], "계란", "g"), 0);
check("살 수 있는 단위로 올린다", formatAmount(8.5, "개"), "9개");

// 목록이 냉장고를 따라가는가 — 원래 "지워지지도 않는다"가 문제였다.
const before = ["계란 4개", "양파 2개"];
const egg = { name: "계란", amount: "6개" };
/* 남은 양과 "그 뒤로 채운 양"을 함께 돌려준다. 뒤엣것이 없으면 근거 칸에서
   "계획 - 냉장고"가 줄에 적힌 수량과 안 맞아 보인다. */
const left = (item, now, at) => remainingAmount(item, now, at);

check("아직 안 샀으면 그대로", left(egg, before, before), { amount: "6개", filled: "" });
check("일부만 채우면 남은 만큼", left(egg, ["계란 6개"], before), { amount: "4개", filled: "2개" });
check("다 채우면 사라진다", left(egg, ["계란 10개"], before), null);
check("더 채워도 사라진다", left(egg, ["계란 20개"], before), null);
check("먹어서 줄어든 것은 더 사라고 하지 않는다", left(egg, ["계란 1개"], before), { amount: "6개", filled: "" });
check("스냅샷 없는 옛 계획은 손대지 않는다", left(egg, ["계란 99개"], undefined), { amount: "6개", filled: "" });
check("수량 모르는 줄은 새로 생기면 사라진다", left({ name: "두부", amount: "" }, ["두부"], []), null);
check("수량 모르는 줄은 없으면 남는다", left({ name: "두부", amount: "" }, [], []), { amount: "", filled: "" });

// 날짜 이름은 두 화면이 같은 말을 써야 한다 (식단 카드 제목 = 장보기 근거의 "언제")
check("시작일이 있으면 날짜와 요일", dayInfo("3일차", "2026-08-13").label, "8/15 (토)");
check("시작일을 모르면 예전 이름", dayInfo("3일차", null).label, "3일차");

// 샀어요 — 이 넷이 전부 고장 나 있었다.
setPantry([{ name: "계란", amount: "4개", addedAt: "2026-08-01" }]);
buyIntoPantry("계란", "6개");
check("이미 있으면 수량을 더한다", loadPantry()[0], { name: "계란", amount: "10개", addedAt: "2026-08-01" });

setPantry([{ name: "계란", amount: "", addedAt: null }]);
buyIntoPantry("계란", "6개");
check("냉장고 수량을 모르면 산 만큼 적는다", loadPantry()[0].amount, "6개");

setPantry([{ name: "돼지고기", amount: "1팩", addedAt: null }]);
const message = buyIntoPantry("돼지고기", "150g");
check("단위가 다르면 건드리지 않고", loadPantry()[0].amount, "1팩");
check("무엇을 고쳐야 하는지 말해준다", /합치지 못했어요/.test(message), true);

setPantry([]);
buyIntoPantry("대파", "1단");
check("없던 재료는 수량까지 함께 넣는다", `${loadPantry()[0].name} ${loadPantry()[0].amount}`, "대파 1단");

// 이거 해먹었어요 — 이름으로 통째로 빼고, 되돌리면 자리와 날짜까지 살아나야 한다.
const names = () => loadPantry().map((p) => p.name);

setPantry([
  { name: "계란", amount: "4개", addedAt: "2026-08-01" },
  { name: "대파", amount: "1단", addedAt: null },
  { name: "두부", amount: "", addedAt: null },
]);
check("수량과 무관하게 이름으로 뺀다", consumeFromPantry(["계란 2개"]).removed, ["계란"]);
check("뺀 뒤 냉장고", names(), ["대파", "두부"]);
check("되돌리면 원래 자리로", (undoRemove(), names()), ["계란", "대파", "두부"]);
check("넣은 날짜도 살아난다", loadPantry()[0].addedAt, "2026-08-01");

// 요리 하나가 재료 여럿을 쓴다. 되돌리기가 그 전부를 한 번에 되살려야 한다.
setPantry([
  { name: "계란", amount: "4개", addedAt: null },
  { name: "대파", amount: "1단", addedAt: null },
  { name: "두부", amount: "1모", addedAt: null },
  { name: "김치", amount: "", addedAt: null },
]);
check("여러 개를 한 번에", consumeFromPantry(["대파 1대", "김치 조금"]).removed, ["대파", "김치"]);
check("가운데와 끝이 빠진다", names(), ["계란", "두부"]);
check("되돌리면 둘 다 제자리", (undoRemove(), names()), ["계란", "대파", "두부", "김치"]);

// 냉장고에 없는 재료로 요리한 경우 — 그냥 무시한다(스펙 엣지 케이스 2번).
setPantry([{ name: "계란", amount: "4개", addedAt: null }]);
check("없는 재료는 뺄 것이 없다", consumeFromPantry(["연어 200g"]).removed, []);
check("냉장고는 그대로", names(), ["계란"]);

// 두 재료가 같은 줄을 가리켜도 한 줄만 빠진다("대파"와 "대파 흰부분").
setPantry([
  { name: "대파", amount: "1단", addedAt: null },
  { name: "계란", amount: "4개", addedAt: null },
]);
check("같은 줄은 한 번만", consumeFromPantry(["대파 1대", "대파 흰부분"]).removed, ["대파"]);
check("나머지는 남는다", names(), ["계란"]);

// 되돌리기 자리는 하나다 — 칩 삭제와 해먹었어요가 같은 곳을 쓴다.
setPantry([
  { name: "계란", amount: "4개", addedAt: null },
  { name: "대파", amount: "1단", addedAt: null },
]);
removeFromPantry(0);
check("칩 삭제도 같은 되돌리기를 쓴다", (undoRemove(), names()), ["계란", "대파"]);
check("두 번 되돌릴 것은 없다", undoRemove(), null);

// 계획 항목의 부족 판정 — 저장하지 않고 그때그때 센다. 완료 처리한 항목은 세지 않는다.
const asNames = (list) => pantryNamesFor(list.map((n) => ({ name: n })));
const fridge = asNames(["계란", "대파"]);

check("있는 재료는 안 센다", missingIngredients({ ingredients: ["계란 2개"] }, fridge), []);
check("없는 재료만 센다",
  missingIngredients({ ingredients: ["계란 2개", "연어 200g"] }, fridge), ["연어 200g"]);
check("해먹은 항목은 통째로 뺀다",
  missingIngredients({ ingredients: ["연어 200g"], done: true }, fridge), []);
check("냉장고가 비면 전부 부족",
  missingIngredients({ ingredients: ["계란 2개"] }, []), ["계란 2개"]);

const plan = [
  { day: "1일차", meal: "아침", menu: "계란말이", ingredients: ["계란 2개"] },
  { day: "1일차", meal: "저녁", menu: "연어구이", ingredients: ["연어 200g", "레몬 1개"] },
  { day: "2일차", meal: "점심", menu: "연어덮밥", ingredients: ["연어 100g", "밥 1공기"] },
  { day: "2일차", meal: "저녁", menu: "다 먹은 것", ingredients: ["가리비 3개"], done: true },
];
const shortages = planShortages(plan, fridge);

check("부족 재료를 이름으로 합친다", shortages.map((s) => s.name), ["연어", "레몬", "밥"]);
check("같은 재료는 한 줄로", shortages.filter((s) => s.name === "연어").length, 1);
check("어느 끼니에 쓰이는지 모은다",
  shortages.find((s) => s.name === "연어").uses.map((u) => u.menu), ["연어구이", "연어덮밥"]);
check("수량도 끼니별로 들고 온다",
  shortages.find((s) => s.name === "연어").uses.map((u) => u.amount), ["200g", "100g"]);
check("해먹은 항목의 재료는 안 올라온다", shortages.some((s) => s.name === "가리비"), false);
check("냉장고를 채우면 그 줄이 사라진다",
  planShortages(plan, asNames(["계란", "대파", "연어", "레몬", "밥"])).map((s) => s.name), []);
check("옛 저장분처럼 done이 없어도 미완료로 본다",
  planShortages([{ menu: "x", ingredients: ["연어 200g"] }], fridge).map((s) => s.name), ["연어"]);

// 절약 체감 — 누적은 오직 올라가기만 한다. 되돌리기만 직전 증가분을 취소한다.
const SAVINGS = "fridge-chef-savings";
const setSavings = (value) => { store[SAVINGS] = JSON.stringify(value); };
const days = () => loadSavings().days;

setSavings({ legacy: 0, days: {} });
check("처음은 0원", savingsTotal(), 0);
check("한 번 확인하면 13,000원", addSavings(), 13000);
check("두 번이면 26,000원", addSavings(), 26000);
check("오늘 날짜 하나에 모인다", Object.keys(days()), [todayISO()]);
check("되돌리면 직전 것만 취소", undoSavings(), 13000);
check("되돌리기는 한 번만 먹는다", undoSavings(), 13000);
check("깎여서 음수가 되지 않는다", savingsTotal() >= 0, true);

// 되돌려서 0이 된 날짜는 아무 일도 없던 날과 같으므로 남기지 않는다.
setSavings({ legacy: 0, days: {} });
addSavings();
undoSavings();
check("0이 된 날짜 키는 지운다", Object.keys(days()), []);

// 손상된 값 — 이 숫자들은 음수가 될 수 없다.
setSavings(-5000);
check("손상된 legacy는 0으로 본다", savingsTotal(), 0);
store[SAVINGS] = '"이상한값"';
check("숫자가 아니어도 0", savingsTotal(), 0);
setSavings({ legacy: 1000, days: { "2026-08-17": -3000, "엉뚱한키": 5000, "2026-08-18": 2000 } });
check("음수·엉뚱한 날짜 키는 버린다", days(), { "2026-08-18": 2000 });
check("남은 것만 누적에 든다", savingsTotal(), 3000);

/* 주 경계 — 월요일에 시작해서 일요일에 끝난다.
   2026-08-17은 월요일이고 2026-08-23이 그 주 일요일이다. */
check("월요일의 주 시작은 그날", weekStartISO("2026-08-17"), "2026-08-17");
check("일요일은 앞선 월요일이 주 시작", weekStartISO("2026-08-23"), "2026-08-17");
check("목요일도 같은 월요일", weekStartISO("2026-08-20"), "2026-08-17");
check("월요일 하루 전은 지난주", weekStartISO("2026-08-16"), "2026-08-10");

setSavings({
  legacy: 50000,
  days: {
    "2026-08-16": 13000, // 지난주 일요일
    "2026-08-17": 13000, // 이번 주 월요일
    "2026-08-20": 26000, // 이번 주 목요일
    "2026-08-23": 13000, // 이번 주 일요일
    "2026-08-24": 13000, // 다음 주 월요일
    "2026-07-30": 13000, // 지난달
  },
});
check("주간은 월~일만 센다", savingsWeek(null, "2026-08-20"), 52000);
check("주간 경계는 일요일까지", savingsWeek(null, "2026-08-23"), 52000);
check("다음 주 월요일이면 그 주만", savingsWeek(null, "2026-08-24"), 13000);
check("월간은 달력 기준", savingsMonth(null, "2026-08-20"), 78000);
check("지난달은 그달만", savingsMonth(null, "2026-07-30"), 13000);

/* 옛 저장분(숫자 하나)은 언제 쌓였는지 알 수 없다. 누적에는 들어가되 주간·월간에는 안 든다 —
   기존 이용자의 기록이 갑자기 0으로 보이면 안 되고, 이번 주 것으로 둔갑해서도 안 된다. */
check("legacy는 누적에 든다", savingsTotal(), 141000);
check("legacy는 주간에 안 든다", savingsWeek(null, "2026-08-20"), 52000);
check("legacy는 월간에 안 든다", savingsMonth(null, "2026-08-20"), 78000);

setSavings(91000);
check("옛 숫자 저장분을 legacy로 읽는다", loadSavings(), { legacy: 91000, days: {} });
check("옛 저장분도 누적은 그대로", savingsTotal(), 91000);
check("옛 저장분만 있으면 이번 주는 0", savingsWeek(null, "2026-08-20"), 0);
check("그래도 카드는 숨지 않는다(누적>0)", savingsTotal() > 0, true);

// 치킨 환산 — 소수점을 그대로 노출하지 않는다.
check("한 마리가 안 되면 격려", chickenText(13000), COPY.SAVINGS.chickenAlmost);
check("딱 떨어지면 그대로", chickenText(30000), "치킨 1마리 값이에요.");
check("조금 넘으면 넘었다고", chickenText(39000), "치킨 1마리 값을 넘었어요.");
check("거의 다 왔으면 다음 마리 기준", chickenText(52000), "치킨 2마리에 조금 못 미쳐요.");
check("소수점은 문구에 안 나온다", /\d+\.\d/.test(chickenText(52000)), false);

/* 즐겨찾기 — 이력과 달리 밀려나지 않는다. 같은 요리는 이력과 같은 규칙으로 알아본다. */
const FAV = "fridge-chef-favorites";
const kimchiJjigae = {
  name: "김치찌개",
  time: "20분",
  ingredients: ["김치 1/4포기"],
  steps: ["끓인다"],
  searchKeyword: "김치찌개",
  /* 실제 레시피 매칭 항목은 원본 주소가 곧 조리 순서다(steps가 비어 있다).
     즐겨찾기가 이 필드를 버리면 담아둔 뒤 링크가 사라진다. */
  recipeUrl: "",
};

store[FAV] = JSON.stringify([]);
check("처음은 비어 있다", loadFavorites(), []);
check("담으면 켜진다", toggleFavorite(kimchiJjigae).on, true);
check("담긴 것으로 읽힌다", isFavorite("김치찌개"), true);
check("이력과 같은 모양으로 저장한다", loadFavorites(), [kimchiJjigae]);
check("띄어쓰기가 달라도 같은 요리", isFavorite("김치 찌개"), true);
check("다시 누르면 빠진다", toggleFavorite(kimchiJjigae).on, false);
check("빠지면 목록도 빈다", loadFavorites(), []);
check("이름이 없으면 아무 일도 없다", toggleFavorite({ name: "" }).on, false);

// 이력은 5개에서 밀려나지만 즐겨찾기는 담아둔 것이 그대로 남는다 — 이 기능의 존재 이유다.
store[FAV] = JSON.stringify([]);
for (let i = 0; i < HISTORY_LIMIT + 3; i++) toggleFavorite({ name: `요리${i}` });
check("이력 상한에 밀려나지 않는다", loadFavorites().length, HISTORY_LIMIT + 3);
check("가장 최근에 담은 것이 앞", loadFavorites()[0].name, `요리${HISTORY_LIMIT + 2}`);

// 상한에 닿으면 조용히 버리지 않고 full로 알린다. 빼는 것은 가득 차 있어도 된다.
store[FAV] = JSON.stringify([]);
for (let i = 0; i < FAVORITES_LIMIT; i++) toggleFavorite({ name: `가득${i}` });
check("상한까지 담긴다", loadFavorites().length, FAVORITES_LIMIT);
check("넘치면 full로 알린다", toggleFavorite({ name: "하나더" }), {
  on: false,
  stored: true,
  full: true,
});
check("넘쳐도 목록은 그대로", loadFavorites().length, FAVORITES_LIMIT);
check("가득 차 있어도 뺄 수는 있다", toggleFavorite({ name: "가득0" }).on, false);
check("빼고 나면 다시 담긴다", toggleFavorite({ name: "하나더" }).on, true);

store[FAV] = '"이상한값"';
check("손상된 값은 빈 목록으로 본다", loadFavorites(), []);

/* 실제 레시피와 매칭된 항목은 steps가 비어 있고 원본 주소가 그 자리를 대신한다.
   즐겨찾기가 recipeUrl을 버리면 담아둔 뒤 다시 열었을 때 링크가 검색 URL로 떨어진다. */
store[FAV] = JSON.stringify([]);
toggleFavorite({ name: "순두부찌개", recipeUrl: "https://www.10000recipe.com/recipe/6841712", steps: [] });
check("매칭 레시피의 원본 주소를 잃지 않는다", loadFavorites()[0].recipeUrl, "https://www.10000recipe.com/recipe/6841712");

console.log(failed ? `\n${failed}개 실패` : "\nall passed");
process.exit(failed ? 1 : 0);
