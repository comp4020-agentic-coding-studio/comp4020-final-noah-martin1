// Progressive enhancement only: every page works without this file.

document.documentElement.classList.remove("no-js");

// The browser's time zone, so "what to cook now" means breakfast at 8 am
// where you are. Only the zone name ("Australia/Sydney"); nothing finer.
try {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && !document.cookie.split("; ").includes(`tz=${encodeURIComponent(tz)}`)) {
    document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
  }
} catch {}

// Theme: follow the system until someone picks. The toggle flips between
// light and dark relative to what's showing; the choice is remembered per
// browser. Pages with 3D scenes listen for "larder:theme" to relight.
(() => {
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => root.dataset.theme === "dark" || (root.dataset.theme !== "light" && media.matches);
  const announce = () => window.dispatchEvent(new CustomEvent("larder:theme", { detail: { dark: isDark() } }));
  media.addEventListener("change", () => {
    if (!root.dataset.theme) announce();
  });
  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-theme-toggle]") : null;
    if (!button) return;
    const next = isDark() ? "light" : "dark";
    // a soft cross-fade between palettes, skipped for reduced motion
    root.classList.add("theme-fading");
    setTimeout(() => root.classList.remove("theme-fading"), 500);
    root.dataset.theme = next;
    try {
      // picking what the system already shows means "follow the system" again
      if ((next === "dark") === media.matches) {
        localStorage.removeItem("larder-theme");
        delete root.dataset.theme;
      } else localStorage.setItem("larder-theme", next);
    } catch {}
    announce();
  });
})();

// On a phone the section tabs scroll sideways; start with the current one in view.
for (const current of document.querySelectorAll('.subnav a[aria-current="page"]')) {
  const strip = current.parentElement;
  if (strip.scrollWidth <= strip.clientWidth) continue;
  const tab = current.getBoundingClientRect();
  const box = strip.getBoundingClientRect();
  strip.scrollLeft += tab.left + tab.width / 2 - (box.left + box.width / 2);
}

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

// Recipe photos fade in once decoded, so tiles never flash half-drawn.
function revealImages(root = document) {
  root.querySelectorAll(".rx-photo img").forEach((img) => {
    if (img.complete && img.naturalWidth) img.classList.add("loaded");
    else {
      img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
      img.addEventListener("error", () => img.classList.add("loaded"), { once: true });
    }
  });
}
revealImages();

// Recipe browse: search as you type and filter without a page load. The grid
// shows outline placeholders while results arrive, then swaps them in.
const grid = document.querySelector("[data-recipe-grid]");
const searchForm = document.querySelector("[data-recipe-search]");
if (grid && searchForm instanceof HTMLFormElement) {
  const input = searchForm.querySelector('input[type="search"]');
  const count = document.querySelector("[data-results-count]");
  const heading = document.querySelector("[data-results-heading]");
  let pending = null;
  let timer = 0;

  async function load(url, push) {
    pending?.abort();
    pending = new AbortController();
    grid.setAttribute("aria-busy", "true");
    const partial = new URL(url, location.href);
    partial.searchParams.set("partial", "1");
    try {
      const [res] = await Promise.all([
        fetch(partial, { signal: pending.signal }),
        new Promise((r) => setTimeout(r, 260)),
      ]);
      const markup = await res.text();
      const skeletons = [...grid.querySelectorAll(".rx-skeleton")];
      grid.innerHTML = markup;
      skeletons.forEach((s) => grid.append(s));
      revealImages(grid);
      const n = Number(res.headers.get("x-result-count") ?? 0);
      if (count) count.textContent = `${n} recipe${n === 1 ? "" : "s"}`;
      const q = new URL(url, location.href).searchParams.get("q");
      if (heading && q) heading.textContent = `Results for “${q}”`;
      if (push) history.pushState({}, "", url);
    } catch (err) {
      if (err.name !== "AbortError") location.href = url;
      return;
    }
    grid.removeAttribute("aria-busy");
  }

  function urlFromForm() {
    const params = new URLSearchParams(new FormData(searchForm));
    if (!params.get("q")) params.delete("q");
    const qs = params.toString();
    return qs ? `/recipes?${qs}` : "/recipes";
  }

  input?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(urlFromForm(), true), 220);
  });
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    load(urlFromForm(), true);
  });
  window.addEventListener("popstate", () => location.reload());
}

// Servings scaler on a recipe page: every amount rescales in place.
const FRACTIONS = [[1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"]];
function formatAmount(q, unit) {
  let num;
  if ((unit === "g" || unit === "ml") && q >= 20) num = String(Math.round(q / 5) * 5);
  else {
    const whole = Math.floor(q);
    const frac = q - whole;
    const glyph = FRACTIONS.find(([v]) => Math.abs(frac - v) < 0.04)?.[1];
    if (frac < 0.04) num = String(whole || "<1");
    else if (frac > 0.96) num = String(whole + 1);
    else if (glyph) num = `${whole || ""}${glyph}`;
    else num = String(Math.round(q * 10) / 10);
  }
  return unit ? `${num} ${unit}` : num;
}

document.querySelectorAll("[data-servings]").forEach((box) => {
  const base = Number(box.dataset.base);
  const value = box.querySelector("[data-servings-value]");
  const cost = document.querySelector("[data-scale-cost]");
  let serves = base;
  box.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("[data-servings-step]") : null;
    if (!btn) return;
    serves = Math.max(1, Math.min(50, serves + Number(btn.dataset.servingsStep)));
    value.textContent = String(serves);
    const scale = serves / base;
    document.querySelectorAll(".ing-amount[data-qty]").forEach((el) => {
      if (el.dataset.qty === "") return;
      el.textContent = formatAmount(Number(el.dataset.qty) * scale, el.dataset.unit);
    });
    if (cost) cost.textContent = `$${((Number(cost.dataset.base) * scale) / 100).toFixed(2)}`;
    document.querySelectorAll('a[href$="/cook"], a[href*="/cook?"]').forEach((a) => {
      const u = new URL(a.href);
      u.searchParams.set("serves", String(serves));
      a.href = u.pathname + u.search;
    });
  });
});

// Cook mode: one step at a time, with buttons, ← / → keys, or a swipe.
document.querySelectorAll("[data-cook-mode]").forEach((root) => {
  const steps = [...root.querySelectorAll("li[data-step]")];
  if (!steps.length) return;
  root.classList.add("enhanced");
  const bars = [...root.querySelectorAll(".cm-progress span")];
  const label = root.querySelector("[data-step-label]");
  const bar = root.querySelector("[data-step-progress]");
  const next = root.querySelector("[data-step-next]");
  const prev = root.querySelector("[data-step-prev]");
  let at = 0;

  function show(i) {
    const forward = i >= at;
    at = Math.max(0, Math.min(i, steps.length));
    root.classList.toggle("finished", at === steps.length);
    steps.forEach((li, n) => {
      li.classList.toggle("current", n === at);
      li.classList.toggle("back", n === at && !forward);
      li.classList.toggle("done", n < at);
    });
    bars.forEach((b, n) => b.classList.toggle("on", n <= at));
    if (label) label.textContent = String(Math.min(at + 1, steps.length));
    if (bar) bar.style.setProperty("--p", `${Math.round((Math.min(at + 1, steps.length) / steps.length) * 100)}%`);
    if (next) {
      next.hidden = at === steps.length;
      const text = next.querySelector("[data-next-label]");
      if (text) text.textContent = at === steps.length - 1 ? "Finish" : "Next step";
    }
    if (prev) prev.disabled = at === 0;
  }

  prev?.addEventListener("click", () => show(at - 1));
  next?.addEventListener("click", () => show(at + 1));
  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      show(at + 1);
    }
    if (event.key === "ArrowLeft") show(at - 1);
  });
  let startX = null;
  root.addEventListener("touchstart", (e) => (startX = e.touches[0].clientX), { passive: true });
  root.addEventListener("touchend", (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 60) show(at + (dx < 0 ? 1 : -1));
    startX = null;
  });
  show(0);
});

// Step timers: the chip counts down in place, then nudges when time's up.
document.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-timer]") : null;
  if (!button || button.dataset.running) return;
  let left = Number(button.dataset.timer);
  const text = button.querySelector("span") ?? button;
  const original = text.textContent;
  button.dataset.running = "1";
  const tick = () => {
    const m = Math.floor(left / 60);
    const s = String(left % 60).padStart(2, "0");
    text.textContent = left > 0 ? `${m}:${s} left` : "Time's up!";
    if (left-- <= 0) {
      clearInterval(id);
      navigator.vibrate?.([200, 100, 200]);
      setTimeout(() => {
        text.textContent = original;
        delete button.dataset.running;
      }, 6000);
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

// Opening a recipe: the tile's photo grows into the recipe page's big photo
// (cross-document view transitions; other browsers just navigate). Only the
// clicked tile gets the shared name, since one recipe can show twice on a page.
(() => {
  if (!("onpagereveal" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  window.addEventListener("pageswap", (event) => {
    const to = event.activation?.entry?.url;
    if (!event.viewTransition || !to) return;
    const id = /\/recipes\/(\d+)\/?$/.exec(new URL(to).pathname)?.[1];
    if (!id) return;
    // a recipe page's own photo carries the name in CSS; hand it to the tile
    document.querySelector(".rd-photo")?.style.setProperty("view-transition-name", "none");
    const href = `a.rx-tile[href="/recipes/${id}"]`;
    const tile = document.querySelector(`${href}[data-pressed] .rx-photo`) ?? document.querySelector(`${href} .rx-photo`);
    if (tile) tile.style.viewTransitionName = "recipe-photo";
  });
  document.addEventListener("pointerdown", (event) => {
    const tile = event.target instanceof Element ? event.target.closest("a.rx-tile") : null;
    document.querySelectorAll("a.rx-tile[data-pressed]").forEach((t) => t !== tile && t.removeAttribute("data-pressed"));
    tile?.setAttribute("data-pressed", "");
  });
  // coming back from the history cache, nothing keeps a stale name
  window.addEventListener("pageshow", () => {
    document.querySelectorAll(".rx-photo, .rd-photo").forEach((el) => el.style.removeProperty("view-transition-name"));
  });
})();

// The landing page's photo stack leans gently toward the pointer.
(() => {
  const stack = document.querySelector(".ld-stack");
  if (!stack || window.matchMedia("(prefers-reduced-motion: reduce), (hover: none)").matches) return;
  let frame = 0;
  stack.addEventListener("pointermove", (event) => {
    const r = stack.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width - 0.5;
    const y = (event.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      stack.style.setProperty("--rx", `${(-y * 7).toFixed(2)}deg`);
      stack.style.setProperty("--ry", `${(x * 9).toFixed(2)}deg`);
    });
  });
  stack.addEventListener("pointerleave", () => {
    stack.style.setProperty("--rx", "0deg");
    stack.style.setProperty("--ry", "0deg");
  });
})();

// Recipe photo: upload the chosen file straight away, show it, and send its
// reference with the form instead of the file. Without this script the form
// posts the file itself (multipart) and the server checks it the same way.
(function () {
  const field = document.querySelector("[data-photo-field]");
  if (!field) return;
  const form = field.closest("form");
  const input = field.querySelector("[data-photo-input]");
  const ref = field.querySelector("[data-photo-ref]");
  const preview = field.querySelector("[data-photo-preview]");
  const status = field.querySelector("[data-photo-status]");
  const help = status.textContent;
  let uploading = null;

  function say(text, bad) {
    status.textContent = text;
    status.classList.toggle("photo-bad", !!bad);
  }

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return say("That file isn't a JPEG, PNG or WebP photo.", true);
    if (file.size > 5 * 1024 * 1024) return say("That photo is over 5 MB. Try a smaller one.", true);
    const url = URL.createObjectURL(file);
    preview.innerHTML = "";
    const img = document.createElement("img");
    img.src = url;
    img.alt = "The photo you chose";
    preview.append(img);
    preview.classList.add("is-loading");
    say("Uploading…");
    uploading = fetch("/images", { method: "POST", body: file, headers: { "content-type": file.type, accept: "application/json" } })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "That photo couldn't be uploaded.");
        ref.value = body.url;
        input.required = false;
        say(`Photo added (${body.width} × ${body.height}).`);
        return true;
      })
      .catch((err) => {
        ref.value = ref.defaultValue;
        say(err.message === "Failed to fetch" ? "Couldn't reach Larder. The photo will upload with the form instead." : err.message, true);
        return false;
      })
      .finally(() => preview.classList.remove("is-loading"));
  });

  form.addEventListener("submit", async (e) => {
    if (!uploading) return;
    e.preventDefault();
    const ok = await uploading;
    uploading = null;
    // uploaded: send the reference, not the file again
    if (ok) input.disabled = true;
    else if (!input.files.length) return;
    form.submit();
  });
  if (!ref.value) status.textContent = help;
})();
