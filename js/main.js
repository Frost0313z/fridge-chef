const THEME_KEY = "fridge-chef-theme";

(function applyStoredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const theme = stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

document.addEventListener("DOMContentLoaded", () => {
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
  button.setAttribute("aria-label", isDark ? "라이트 모드로 전환" : "다크 모드로 전환");
}
