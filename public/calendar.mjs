// Calendar enhancements. Every control here is a plain link or form that
// works without this file; with it, weeks, friend overlays and planner
// changes swap in place (no page reload), and quick add searches as you type.

const root = document.documentElement;
root.classList.add("cal-js");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

const REGIONS = ["head", "friends", "grid", "budget", "plan"];
const region = (name, doc = document) => doc.querySelector(`[data-cal-region="${name}"]`);

let pending = null;

// Fetch a calendar URL and swap the page's regions for the new ones.
async function go(url, { push = true, kind = "nav" } = {}) {
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  const busy = kind === "plan" ? [region("plan")] : kind === "overlay" ? [region("grid")] : [region("grid"), region("budget")];
  busy.forEach((el) => el?.setAttribute("aria-busy", "true"));
  const planButton = document.querySelector("[data-plan-form] button[type=submit]");
  if (kind === "plan") planButton?.setAttribute("aria-busy", "true");
  let doc;
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "text/html" } });
    if (!res.ok || !res.url.includes("/calendar")) throw new Error(`calendar ${res.status}`);
    doc = new DOMParser().parseFromString(await res.text(), "text/html");
  } catch (err) {
    if (err.name === "AbortError") return;
    location.href = url;
    return;
  } finally {
    busy.forEach((el) => el?.removeAttribute("aria-busy"));
    planButton?.removeAttribute("aria-busy");
  }
  if (pending !== controller) return;
  settleFlip?.();
  // a week-to-week move turns the day cards over instead of cross-fading
  const dir = kind === "nav" && !reduced.matches ? flipDirection(region("grid"), region("grid", doc)) : 0;
  const swap = () => {
    for (const name of REGIONS) {
      if (dir && name === "grid") continue;
      const next = region(name, doc);
      const current = region(name);
      if (next && current) current.replaceWith(next);
    }
    syncQuick(doc);
    document.title = doc.title;
  };
  if (push) history.pushState({ cal: true }, "", url);
  // the pager is redrawn with the header; keep keyboard focus on the arrow
  const pagerDir = document.activeElement?.closest?.(".cal-pager [data-dir]")?.getAttribute("data-dir");
  if (dir) {
    flipWeek(region("grid"), region("grid", doc), dir);
    swap();
  } else {
    if (document.startViewTransition && !reduced.matches && kind === "nav") document.startViewTransition(swap);
    else swap();
    centreToday();
  }
  if (pagerDir) document.querySelector(`.cal-pager [data-dir="${pagerDir}"]`)?.focus({ preventScroll: true });
  if (kind === "plan") {
    const result = document.querySelector(".cal-plan");
    if (result && result.getBoundingClientRect().top > window.innerHeight * 0.8) {
      result.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
    }
  }
}

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target : null;

  const open = target?.closest("[data-quick-open]");
  if (open) {
    event.preventDefault();
    openQuick(open.getAttribute("data-quick-open"));
    return;
  }

  const link = target?.closest("a[data-cal-nav]");
  if (link) {
    event.preventDefault();
    go(link.href, { kind: link.getAttribute("data-cal-nav") || "nav" });
  }
});

// The planner form re-plans in place.
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.matches("[data-plan-form]")) {
    event.preventDefault();
    const url = new URL(form.action, location.href);
    url.search = new URLSearchParams(new FormData(form)).toString();
    url.hash = "";
    go(url.href, { kind: "plan" });
  } else if (form.matches("[data-quick-form]")) {
    event.preventDefault();
    searchNow();
  }
});

window.addEventListener("popstate", () => {
  if (location.pathname === "/calendar") go(location.href, { push: false });
});

/* ---------------- quick add ---------------- */

const quick = () => document.querySelector("[data-quick]");

function openQuick(day) {
  const panel = quick();
  if (!panel) return;
  const select = panel.querySelector("[data-quick-day]");
  if (select && day) {
    if (![...select.options].some((o) => o.value === day)) {
      const option = new Option(day, day);
      select.prepend(option);
    }
    select.value = day;
    syncChoice();
  }
  panel.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "center" });
  panel.classList.remove("is-flash");
  void panel.offsetWidth;
  panel.classList.add("is-flash");
  setTimeout(() => panel.querySelector("[data-quick-q]")?.focus({ preventScroll: true }), reduced.matches ? 0 : 420);
}

// Day, meal and share live in the search form; each result's own add form
// carries a copy, kept in step here so changing the day needs no reload.
function syncChoice() {
  const panel = quick();
  if (!panel) return;
  const day = panel.querySelector("[data-quick-day]");
  const meal = panel.querySelector("[data-quick-meal]");
  const share = panel.querySelector("[data-quick-share]");
  const dayLabel = day?.selectedOptions[0]?.textContent?.trim().replace(/^Today .*/, "Today") ?? "";
  panel.querySelectorAll('[data-sync="day"]').forEach((i) => (i.value = day.value));
  panel.querySelectorAll('[data-sync="meal"]').forEach((i) => (i.value = meal.value));
  panel.querySelectorAll('[data-sync="share"]').forEach((i) => (i.value = share?.checked ? "1" : "0"));
  panel.querySelectorAll("[data-when]").forEach((el) => (el.textContent = `${dayLabel}, ${meal.value}`));
  panel.querySelectorAll(".cal-add-btn").forEach((b) => {
    const title = b.closest(".cal-result")?.querySelector(".cal-result-title")?.textContent ?? "this";
    b.setAttribute("aria-label", `Add ${title} to ${day.selectedOptions[0]?.textContent?.trim()} ${meal.value}`);
  });
}

let searchTimer = 0;
let searchCtl = null;

async function searchNow() {
  const panel = quick();
  const form = panel?.querySelector("[data-quick-form]");
  const results = panel?.querySelector("[data-quick-results]");
  if (!form || !results) return;
  searchCtl?.abort();
  searchCtl = new AbortController();
  const params = new URLSearchParams(new FormData(form));
  params.set("partial", "quickadd");
  results.setAttribute("aria-busy", "true");
  try {
    const res = await fetch(`/calendar?${params}`, { signal: searchCtl.signal });
    if (!res.ok) throw new Error(String(res.status));
    const holder = document.createElement("div");
    holder.innerHTML = await res.text();
    const next = holder.querySelector("[data-quick-results]");
    if (next) results.replaceWith(next);
    syncChoice();
  } catch (err) {
    if (err.name !== "AbortError") results.removeAttribute("aria-busy");
  }
}

document.addEventListener("input", (event) => {
  const t = event.target;
  if (t instanceof HTMLInputElement && t.matches("[data-quick-q]")) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchNow, 220);
  }
});

document.addEventListener("change", (event) => {
  const t = event.target;
  if (t instanceof Element && t.matches("[data-quick-day], [data-quick-meal], [data-quick-share]")) syncChoice();
});

// After a week change, the quick-add form follows: its day list and the
// hidden week/overlay fields come from the new page; what you typed stays.
function syncQuick(doc) {
  const panel = quick();
  const next = doc.querySelector("[data-quick]");
  if (!panel || !next) return;
  const form = panel.querySelector("[data-quick-form]");
  const nextForm = next.querySelector("[data-quick-form]");
  form.querySelectorAll('input[type="hidden"]:not([name="share"])').forEach((i) => i.remove());
  nextForm.querySelectorAll('input[type="hidden"]:not([name="share"])').forEach((i) => form.prepend(i.cloneNode()));
  const day = form.querySelector("[data-quick-day]");
  const nextDay = nextForm.querySelector("[data-quick-day]");
  if (day && nextDay) {
    day.innerHTML = nextDay.innerHTML;
    day.value = nextDay.value;
  }
  searchNow();
}

/* ---------------- week change: the day cards flip over ---------------- */

// +1 going forward in time, -1 going back, 0 when the move isn't between two
// different weeks (month view, or the same week again)
function flipDirection(current, next) {
  if (!current?.matches(".cal-week") || !next?.matches(".cal-week")) return 0;
  if (current.children.length !== next.children.length) return 0;
  const first = (grid) => grid.querySelector(".cal-dnum")?.id ?? "";
  const a = first(current);
  const b = first(next);
  return a === b ? 0 : b > a ? 1 : -1;
}

// Each card turns away on its own axis, one after another, and the new day
// turns in on its back with a small overshoot, like a flip-board: columns
// (desktop) turn sideways, stacked rows (phones) flip over top to bottom. A
// second week change mid-flip settles this one at once first.
let settleFlip = null;

function flipWeek(current, next, dir) {
  const olds = [...current.children];
  const news = [...next.children];
  const placed = new Set();
  const outs = [];
  // no entrance animations mid-flip: the turn is the entrance (and the old
  // meals would otherwise replay their rise-in as the loading shimmer ends)
  for (const card of [...olds, ...news]) card.classList.add("is-flipped");
  // keep the scroll on today (phones), measured on the cards still showing
  centreToday(news.findIndex((c) => c.classList.contains("is-today")));
  // hold the row's height while cards change, then ease to the new week's
  const from = current.offsetHeight;
  current.style.minHeight = `${from}px`;
  const place = (i) => {
    if (placed.has(i)) return;
    placed.add(i);
    olds[i].replaceWith(news[i]);
    if (placed.size === olds.length) {
      current.replaceWith(next);
      next.replaceChildren(...news);
      const to = next.offsetHeight;
      if (to < from - 1) next.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      settleFlip = null;
    }
    return news[i];
  };
  const axis = olds[0] && olds[0].offsetWidth > olds[0].offsetHeight ? "X" : "Y";
  const turn = (deg) => `perspective(1100px) rotate${axis}(${axis === "X" ? -deg : deg}deg)`;
  olds.forEach((card, i) => {
    const out = card.animate(
      [{ transform: turn(0) }, { transform: turn(-90 * dir), opacity: 0.55 }],
      { duration: 200, delay: i * 40, easing: "cubic-bezier(0.55, 0, 0.8, 0.3)", fill: "forwards" },
    );
    outs.push(out);
    out.finished.then(() => {
      const card = place(i);
      card?.animate(
        [{ transform: turn(90 * dir), opacity: 0.55 }, { transform: turn(0), opacity: 1 }],
        { duration: 440, easing: "cubic-bezier(0.3, 1.35, 0.55, 1)" },
      );
    }, () => {});
  });
  settleFlip = () => {
    outs.forEach((a) => a.cancel());
    olds.forEach((_, i) => place(i));
  };
}

/* ---------------- phones: open the week on today ---------------- */

// `at` is the column to show (today's, or -1 for none) when the cards in the
// grid are about to be replaced; otherwise it's read from the grid
function centreToday(at) {
  const week = document.querySelector(".cal-week");
  if (!week || week.scrollWidth <= week.clientWidth + 4) return;
  const cols = [...week.children];
  const todayCol = at === undefined ? week.querySelector(".cal-day.is-today") : cols[at];
  const pad = parseFloat(getComputedStyle(week).paddingLeft) || 0;
  week.scrollLeft = todayCol ? todayCol.offsetLeft - pad : 0;
}

centreToday();
syncChoice();
