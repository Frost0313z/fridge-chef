document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("recipe-form");
  if (!form) return;

  const ingredientsEl = document.getElementById("ingredients");
  const headcountEl = document.getElementById("headcount");
  const timeLimitEl = document.getElementById("timeLimit");
  const submitBtn = document.getElementById("submit-btn");
  const loadingEl = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  const resultEl = document.getElementById("result");

  const REQUEST_TIMEOUT_MS = 20000;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();
    resultEl.innerHTML = "";

    const ingredients = ingredientsEl.value.trim();
    if (!ingredients) {
      showError("재료를 1개 이상 입력해주세요.");
      ingredientsEl.focus();
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setLoading(true);

    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredients,
          headcount: headcountEl.value,
          timeLimit: timeLimitEl.value,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        showError((data && data.message) || "오류가 발생했어요. 잠시 후 다시 시도해주세요.");
        return;
      }

      renderRecipes((data && data.recipes) || []);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        showError("응답이 지연되고 있어요. 잠시 후 다시 시도해주세요.");
      } else {
        showError("네트워크 연결을 확인하고 다시 시도해주세요.");
      }
    } finally {
      setLoading(false);
    }
  });

  function setLoading(isLoading) {
    loadingEl.hidden = !isLoading;
    submitBtn.disabled = isLoading;
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function renderRecipes(recipes) {
    if (!recipes.length) {
      showError("추천 결과를 만들지 못했어요. 재료를 다르게 입력해보세요.");
      return;
    }

    resultEl.innerHTML = recipes
      .map(
        (r) => `
      <article class="recipe-card">
        <h3>${escapeHtml(r.name)}</h3>
        <p class="recipe-time">⏱ ${escapeHtml(r.time || "")}</p>
        <h4>재료</h4>
        <ul>${(r.ingredients || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        <h4>조리 순서</h4>
        <ol>${(r.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
      </article>
    `
      )
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }
});
