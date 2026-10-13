// Household pages, live. Progressive enhancement only: every page works as
// plain forms and links without this file.
//
// - Every ~4 s while the tab is visible it asks /household/state for the
//   house's version number. When it moves (anyone claimed, added, planned…),
//   it fetches the current page and swaps in each [data-hh-region] whose
//   markup changed, with a one-off glow, and shows a small toast for what
//   other people did.
// - Forms marked [data-hh-action] (claims, "use tonight", calendar menus)
//   submit in the background and swap the result in, so the page doesn't jump.
// - Copy buttons for the invite code.

const root = document.querySelector("[data-hh-root]");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ---------- copy the invite code ---------- */

document.querySelectorAll("[data-copy]").forEach((button) => {
  if (!navigator.clipboard) return;
  button.hidden = false;
  const label = button.textContent;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy";
    }
    setTimeout(() => (button.textContent = label), 1800);
  });
});

if (root) {
  let version = Number(root.dataset.hhVersion || 0);
  let busy = false;
  let timer = 0;
  let failures = 0;
  const live = document.querySelector("[data-hh-live]");
  const toasts = document.querySelector("[data-hh-toasts]");

  /* ---------- swapping regions ---------- */

  function regions(doc) {
    const out = new Map();
    doc.querySelectorAll("[data-hh-region]").forEach((el) => out.set(el.dataset.hhRegion, el));
    return out;
  }

  // Keep whatever the person is typing or has open; never yank focus.
  function isBusyRegion(el) {
    const active = document.activeElement;
    if (active && el.contains(active) && active.matches("input, select, textarea")) return true;
    return !!el.querySelector("details[open]");
  }

  function swap(doc, { glow }) {
    const fresh = regions(doc);
    let changed = 0;
    let skipped = 0;
    for (const [key, el] of regions(document)) {
      const next = fresh.get(key);
      if (!next || next.innerHTML === el.innerHTML) continue;
      if (isBusyRegion(el)) {
        skipped++;
        continue;
      }
      el.replaceWith(next);
      changed++;
      if (glow && !reduced.matches) {
        const target = next.matches(".panel, .hh-ticker, .stats, .cal-week") ? next : next.querySelector(".panel") ?? next;
        target.classList.remove("hh-updated");
        void target.offsetWidth;
        target.classList.add("hh-updated");
        setTimeout(() => target.classList.remove("hh-updated"), 1700);
      }
    }
    // a region left alone while someone was using it refreshes on the next poll
    const v = skipped ? 0 : Number(doc.querySelector("[data-hh-root]")?.dataset.hhVersion || 0);
    if (v) {
      version = v;
      root.dataset.hhVersion = String(v);
    }
    // a flash rendered with the response replaces the old one
    const flash = doc.querySelector("main > .flash");
    const old = document.querySelector("main > .flash");
    if (flash) {
      if (old) old.replaceWith(flash);
      else document.querySelector("main")?.prepend(flash);
    }
    return changed;
  }

  async function refresh(glow) {
    const res = await fetch(location.pathname + location.search, { headers: { accept: "text/html" }, cache: "no-store" });
    if (!res.ok || res.redirected) {
      // left the house, or it closed: the full page says what happened
      location.reload();
      return;
    }
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    if (!doc.querySelector("[data-hh-root]")) {
      location.reload();
      return;
    }
    swap(doc, { glow });
  }

  /* ---------- toasts ---------- */

  function toast(event) {
    if (!toasts) return;
    const el = document.createElement("div");
    el.className = `hh-toast${event.nudge ? " is-nudge" : ""}`;
    const dot = document.createElement("span");
    dot.className = "live-dot";
    const text = document.createElement("span");
    const who = document.createElement("strong");
    who.textContent = event.who;
    text.append(who, ` ${event.text}`);
    el.append(dot, text);
    toasts.append(el);
    while (toasts.children.length > 3) toasts.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), reduced.matches ? 0 : 320);
    }, 5200);
  }

  /* ---------- polling ---------- */

  async function poll() {
    if (busy || document.hidden) return schedule();
    busy = true;
    try {
      const res = await fetch(`/household/state?since=${version}`, { cache: "no-store" });
      if (res.status === 404) {
        location.reload();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const state = await res.json();
      failures = 0;
      if (live) live.hidden = false;
      if (state.version !== version) {
        for (const e of state.events ?? []) toast(e);
        await refresh(true);
      }
    } catch {
      failures++;
      if (live && failures > 2) live.hidden = true;
    } finally {
      busy = false;
      schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    // back off gently if the server isn't answering
    timer = setTimeout(poll, Math.min(30000, 4000 * 2 ** Math.min(failures, 3)));
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      clearTimeout(timer);
      poll();
    }
  });

  /* ---------- background form posts ---------- */

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-hh-action]") || event.defaultPrevented) return;
    event.preventDefault();
    if (form.dataset.hhBusy) return;
    form.dataset.hhBusy = "1";
    busy = true;
    try {
      const res = await fetch(form.action, {
        method: "POST",
        body: new URLSearchParams(new FormData(form)),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      // the redirect lands on a household page; if it's this one, swap it in.
      // Anything else (an error page, a different page) is shown in full.
      const markup = await res.text();
      const landed = new URL(res.url);
      const doc = new DOMParser().parseFromString(markup, "text/html");
      if (!res.ok || !res.redirected || landed.pathname !== location.pathname || !doc.querySelector("[data-hh-root]")) {
        if (res.redirected && res.ok) location.href = res.url;
        else {
          document.open();
          document.write(markup);
          document.close();
        }
        return;
      }
      swap(doc, { glow: false });
      document.querySelectorAll("details.meal-menu[open]").forEach((d) => d.removeAttribute("open"));
    } catch {
      form.submit();
    } finally {
      delete form.dataset.hhBusy;
      busy = false;
    }
  });

  if (live) live.hidden = false;
  schedule();
}
