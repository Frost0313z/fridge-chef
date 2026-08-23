const pages = ["index.html", "pantry.html", "recipe.html", "mealplan.html", "shopping.html"];
const widths = [320, 375, 414, 768];

async function main() {
  const targets = await fetch("http://127.0.0.1:9223/json").then((response) => response.json());
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("검증할 브라우저 페이지를 찾지 못했습니다.");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };
  await new Promise((resolve) => { socket.onopen = resolve; });

  const send = (method, params = {}) => new Promise((resolve) => {
    const requestId = ++id;
    pending.set(requestId, resolve);
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });

  await send("Page.enable");
  const failures = [];
  for (const width of widths) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height: 800, deviceScaleFactor: 1, mobile: true,
    });
    for (const page of pages) {
      await send("Page.navigate", { url: `http://127.0.0.1:8842/${page}` });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const response = await send("Runtime.evaluate", {
        expression: `(() => {
          const nav = document.querySelector(".nav-menu");
          const pantry = document.querySelector(".pantry-bar");
          return {
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            navBottom: Math.round(nav.getBoundingClientRect().bottom),
            navHeight: Math.round(nav.getBoundingClientRect().height),
            activeCount: document.querySelectorAll(".nav-menu [aria-current=page]").length,
            pantry: pantry ? {
              left: Math.round(pantry.getBoundingClientRect().left),
              right: Math.round(pantry.getBoundingClientRect().right),
              bottom: Math.round(pantry.getBoundingClientRect().bottom),
              height: Math.round(pantry.getBoundingClientRect().height),
            } : null,
          };
        })()`,
        returnByValue: true,
      });
      const result = response.result.result.value;
      if (result.scrollWidth > result.width) failures.push(`${width}px ${page}: 가로 넘침`);
      if (result.activeCount !== 1) failures.push(`${width}px ${page}: 현재 메뉴 표시 ${result.activeCount}개`);
      if (width <= 640 && result.navBottom !== 800) failures.push(`${width}px ${page}: 하단 내비게이션 위치 오류`);
      if (width <= 640 && result.pantry && result.pantry.bottom !== 736) {
        failures.push(`${width}px ${page}: 냉장고 버튼이 내비게이션 위에 있지 않음`);
      }
      if (page === "recipe.html" && width <= 640) {
        const opened = await send("Runtime.evaluate", {
          expression: `(() => {
            const pantry = document.querySelector(".pantry-bar");
            pantry.open = true;
            const rect = pantry.getBoundingClientRect();
            return { left: Math.round(rect.left), right: Math.round(rect.right) };
          })()`,
          returnByValue: true,
        });
        const rect = opened.result.result.value;
        if (rect.left !== 0 || rect.right !== width) failures.push(`${width}px recipe.html: 열린 냉장고 시트가 전체 폭이 아님`);
      }
      console.log(`${width}px ${page}: 통과`);
    }
  }
  socket.close();
  if (failures.length) throw new Error(failures.join("\n"));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
