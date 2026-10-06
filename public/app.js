// Progressive enhancement only: every page works without this file.

// Confirm destructive forms: <form data-confirm="Delete this?">
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form instanceof HTMLFormElement && form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
    event.preventDefault();
  }
});

// Optional-ingredient checkboxes carry their row's index, so renumber after
// rows are added or removed.
function renumber(rows) {
  rows.querySelectorAll("[data-row]").forEach((row, i) => {
    const optional = row.querySelector('input[name="ing_optional"]');
    if (optional) optional.value = String(i);
  });
}

// Recipe editor: add / remove ingredient and step rows.
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const add = target?.closest("[data-add-row]");
  if (add) {
    const key = add.getAttribute("data-add-row");
    const rows = document.querySelector(`[data-rows="${key}"]`);
    const template = document.querySelector(`template[data-template="${key}"]`);
    if (!rows || !(template instanceof HTMLTemplateElement)) return;
    rows.append(template.content.cloneNode(true));
    renumber(rows);
    rows.lastElementChild?.querySelector("input, textarea")?.focus();
    return;
  }
  const remove = target?.closest("[data-remove-row]");
  if (remove) {
    const row = remove.closest("[data-row]");
    const rows = row?.parentElement;
    if (!row || !rows) return;
    // keep one empty row rather than none
    if (rows.querySelectorAll("[data-row]").length === 1) {
      row.querySelectorAll("input:not([type=checkbox]), textarea").forEach((el) => (el.value = ""));
      return;
    }
    row.remove();
    renumber(rows);
  }
});

// Close an open meal menu when clicking elsewhere or pressing Escape.
document.addEventListener("click", (event) => {
  document.querySelectorAll("details.meal-menu[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute("open");
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll("details.meal-menu[open]").forEach((menu) => {
    menu.removeAttribute("open");
    menu.querySelector("summary")?.focus();
  });
});

// Cook mode and cook-along: step through a recipe with buttons or ← / →.
// Without JS every step is listed; with it, cook mode shows one at a time.
document.querySelectorAll("[data-cook-mode]").forEach((root) => {
  const steps = [...root.querySelectorAll(".cook-steps li[data-step]")];
  if (!steps.length) return;
  root.classList.add("enhanced");
  const label = root.querySelector("[data-step-label]");
  const bar = root.querySelector("[data-step-progress]");
  const next = root.querySelector("[data-step-next]");
  let at = 0;

  function show(i) {
    at = Math.max(0, Math.min(i, steps.length));
    root.classList.toggle("finished", at === steps.length);
    steps.forEach((li, n) => {
      li.classList.toggle("current", n === at);
      li.classList.toggle("done", n < at);
    });
    if (label) label.textContent = String(Math.min(at + 1, steps.length));
    if (bar) bar.style.setProperty("--p", `${Math.round((Math.min(at + 1, steps.length) / steps.length) * 100)}%`);
    if (next) next.textContent = at === steps.length - 1 ? "Finish ✓" : "Next step →";
  }

  root.querySelector("[data-step-prev]")?.addEventListener("click", () => show(at - 1));
  next?.addEventListener("click", () => show(at + 1));
  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "ArrowRight") show(at + 1);
    if (event.key === "ArrowLeft") show(at - 1);
  });
  show(0);
});

// Step timers: the button counts down in place.
document.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-timer]") : null;
  if (!button || button.dataset.running) return;
  let left = Number(button.dataset.timer);
  const original = button.textContent;
  button.dataset.running = "1";
  const tick = () => {
    const m = Math.floor(left / 60);
    const s = String(left % 60).padStart(2, "0");
    button.textContent = left > 0 ? `${m}:${s} left` : "Time's up";
    if (left-- <= 0) {
      clearInterval(id);
      delete button.dataset.running;
      setTimeout(() => (button.textContent = original), 5000);
    }
  };
  const id = setInterval(tick, 1000);
  tick();
});

// Shopping list ticks are a per-browser convenience; storage may be
// unavailable (private mode), and the list still works without it.
const SHOP_KEY = "larder:shopping-ticks";
function readTicks() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHOP_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
const ticks = readTicks();
document.querySelectorAll("[data-shop-item]").forEach((box) => {
  box.checked = ticks.has(box.dataset.shopItem);
  box.addEventListener("change", () => {
    if (box.checked) ticks.add(box.dataset.shopItem);
    else ticks.delete(box.dataset.shopItem);
    try {
      localStorage.setItem(SHOP_KEY, JSON.stringify([...ticks]));
    } catch {
      // not remembered, but the tick still shows
    }
  });
});

document.querySelector("[data-print]")?.addEventListener("click", () => window.print());
