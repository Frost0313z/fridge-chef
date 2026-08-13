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
  document: { addEventListener: () => {}, getElementById: () => null },
  window: { matchMedia: () => ({ matches: false }) },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const file of ["js/shared.js", "js/shopping.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), sandbox, { filename: file });
}

const {
  parseAmount, addAmounts, amountIn, formatAmount, splitIngredient, dayInfo,
  remainingAmount, buyIntoPantry, loadPantry,
} = sandbox;

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

console.log(failed ? `\n${failed}개 실패` : "\nall passed");
process.exit(failed ? 1 : 0);
