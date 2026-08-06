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
    toggle.addEventListener("click", () => {
      const isOpen = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });

    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        menu.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    updateThemeIcon(themeToggle);
    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(THEME_KEY, next);
      updateThemeIcon(themeToggle);
    });
  }
});

function updateThemeIcon(button) {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  button.textContent = isDark ? "☀️" : "🌙";
  button.setAttribute("aria-label", isDark ? "라이트 모드로 전환" : "다크 모드로 전환");
}
