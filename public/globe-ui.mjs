// The live globe's side panel: groups (you, friends, everyone, demo cooks),
// filters, the detail card that opens when a pan or row is chosen, asking
// questions, and live updates over Server-Sent Events. Talks to globe.mjs
// with DOM events: globe:select / globe:cluster (from it) and globe:focus /
// globe:filter / globe:upsert / globe:remove (to it). Also runs the single
// session page (/global/:id), which has a card but no globe.
import { tickClocks } from "./localclock.mjs";

const root = document.querySelector("[data-gl]");
const stage = document.querySelector("[data-globe]");
const data = JSON.parse(document.getElementById("globe-data")?.textContent ?? "[]");

if (root) start();

function start() {
  const solo = root.hasAttribute("data-solo");
  const byId = new Map(data.map((s) => [s.id, s]));
  const versions = new Map(data.filter((s) => s.kind === "live").map((s) => [s.id, s.v]));
  const details = root.querySelector("[data-gl-details]") ?? root;
  const empty = root.querySelector("[data-gl-empty]");
  const conn = root.querySelector("[data-conn]");
  let open = solo ? data[0]?.id ?? null : null;
  let connId = null;

  const rowFor = (id) => root.querySelector(`[data-row="${CSS.escape(id)}"]`);
  const cardFor = (id) => root.querySelector(`[data-detail="${CSS.escape(id)}"]`);
  const toGlobe = (name, detail) => stage?.dispatchEvent(new CustomEvent(name, { detail }));

  /* ---------- opening a session ---------- */
  function show(id, focus) {
    root.querySelectorAll("[data-detail]").forEach((d) => (d.hidden = d.dataset.detail !== id));
    root.querySelectorAll("[data-session]").forEach((r) => r.classList.toggle("active", r.dataset.session === id));
    open = id;
    root.classList.toggle("detail-open", id !== null);
    if (id !== null) {
      cardFor(id)?.querySelector(".gl-detail-body")?.scrollTo({ top: 0 });
      if (focus) toGlobe("globe:focus", { id });
      history.replaceState(null, "", `#live-${id}`);
    } else {
      history.replaceState(null, "", location.pathname);
    }
    tellWatching();
  }

  root.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const rowBtn = t?.closest("[data-session]");
    if (rowBtn && root.contains(rowBtn)) return show(rowBtn.dataset.session, true);
    if (t?.closest("[data-close]")) show(null, false);
  });
  root.addEventListener("globe:select", (e) => show(e.detail.id, false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open !== null && !solo) show(null, false);
  });

  // a cluster was tapped: the globe flies in; light up those cooks' rows
  root.addEventListener("globe:cluster", (e) => {
    const rows = e.detail.ids.map(rowFor).filter((r) => r && !r.hidden);
    rows[0]?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    rows.forEach((r) => {
      r.classList.remove("gl-lit");
      void r.offsetWidth;
      r.classList.add("gl-lit");
    });
  });

  /* ---------- filters ---------- */
  const chips = [...root.querySelectorAll("[data-filter]")];
  const cuisine = root.querySelector("[data-cuisine]");
  let mode = "all";
  function matches(s) {
    const c = cuisine?.value ?? "";
    return (
      (mode === "all" ||
        (mode === "friends" && (s.group === "friends" || s.group === "mine")) ||
        (mode === "help" && s.help) ||
        (mode === "vegetarian" && (s.tags.includes("vegetarian") || s.tags.includes("vegan"))) ||
        (mode === "fridge" && s.total && s.have / s.total >= 0.5)) &&
      (!c || s.cuisine === c)
    );
  }
  function apply() {
    let shown = 0;
    const visible = [];
    root.querySelectorAll("[data-row]").forEach((li) => {
      const s = byId.get(li.dataset.row);
      const ok = !!s && matches(s);
      li.hidden = !ok;
      if (ok) {
        shown++;
        visible.push(s.id);
      }
    });
    root.querySelectorAll("[data-group]").forEach((g) => {
      const rows = g.querySelectorAll("[data-row]:not([hidden])").length;
      const cta = g.querySelector("[data-live-empty]");
      const showCta = !!cta && mode === "all" && !(cuisine?.value) && ![...byId.values()].some((s) => s.kind === "live");
      if (cta) cta.hidden = !showCta;
      g.hidden = rows === 0 && !showCta;
      const count = g.querySelector("[data-group-count]");
      if (count) count.textContent = rows ? String(rows) : "";
    });
    if (empty) empty.hidden = shown > 0;
    const filtering = mode !== "all" || !!cuisine?.value;
    toGlobe("globe:filter", { ids: filtering ? visible : null });
  }
  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      chips.forEach((x) => x.setAttribute("aria-pressed", String(x === chip)));
      mode = chip.dataset.filter;
      apply();
    }),
  );
  cuisine?.addEventListener("change", apply);

  function stats() {
    const live = [...byId.values()].filter((s) => s.kind === "live");
    root.querySelectorAll('[data-stat="live"]').forEach((el) => (el.textContent = String(live.length)));
    root.querySelectorAll('[data-stat="help"]').forEach((el) => (el.textContent = String([...byId.values()].filter((s) => s.help).length)));
  }

  /* ---------- live updates ---------- */
  const fromHtml = (markup) => {
    const t = document.createElement("template");
    t.innerHTML = markup.trim();
    return t.content.firstElementChild;
  };

  // A step change arrives as fresh markup; carry each progress bar's old
  // width over and let it slide to the new one instead of jumping.
  const barsOf = (el) => [...(el?.querySelectorAll(".progress") ?? [])];
  function slideBars(before, after) {
    after.forEach((bar, i) => {
      const was = before[i]?.style.getPropertyValue("--p");
      const now = bar.style.getPropertyValue("--p");
      if (!was || was === now) return;
      bar.style.setProperty("--p", was);
      requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty("--p", now)));
    });
  }

  const inflight = new Map();
  async function refresh(id, v) {
    if (v && versions.get(id) === v) return;
    if (inflight.has(id)) return inflight.get(id);
    const p = (async () => {
      try {
        const res = await fetch(`/global/${encodeURIComponent(id)}/card`, { headers: { accept: "application/json" } });
        if (res.status === 404 || res.status === 410) return remove(id, "ended");
        if (!res.ok) return;
        upsert(await res.json());
      } catch {
        // offline for a moment; the next sync catches up
      } finally {
        inflight.delete(id);
      }
    })();
    inflight.set(id, p);
    return p;
  }

  function upsert(card) {
    const id = card.id;
    const isNew = !byId.has(id);
    const before = byId.get(id);
    byId.set(id, card.marker);
    versions.set(id, card.v);

    if (!solo) {
      // the row, in its group (you / friends / everyone)
      const list = root.querySelector(`[data-list="${card.group}"]`);
      const row = fromHtml(card.row);
      const existing = rowFor(id);
      if (existing && existing.parentElement === list) {
        row.querySelector("[data-session]")?.classList.toggle("active", open === id);
        const was = barsOf(existing);
        existing.replaceWith(row);
        slideBars(was, barsOf(row));
      } else {
        existing?.remove();
        list?.prepend(row);
        row.classList.add("arrive");
      }
    }

    // the card: swap only the parts that change, so a half-typed question survives
    const current = cardFor(id);
    if (current) {
      for (const [part, markup] of Object.entries(card.parts)) {
        const el = current.querySelector(`[data-part="${part}"]`);
        if (el && el.innerHTML !== markup) {
          const was = barsOf(el).map((b) => b.cloneNode());
          el.innerHTML = markup;
          slideBars(was, barsOf(el));
          if (part === "step" && before && before.step !== card.marker.step) {
            el.classList.remove("bump");
            void el.offsetWidth;
            el.classList.add("bump");
          }
        }
      }
      current.querySelector("[data-ended]")?.setAttribute("hidden", "");
    } else {
      const el = fromHtml(card.detail);
      el.hidden = open !== id;
      details.append(el);
    }
    toGlobe("globe:upsert", { marker: card.marker });
    if (isNew) stats();
    stats();
    apply();
  }

  function remove(id, reason) {
    if (!byId.has(id) || id.startsWith("demo-")) return;
    byId.delete(id);
    versions.delete(id);
    toGlobe("globe:remove", { id });
    const row = rowFor(id);
    if (row) {
      row.classList.add("leave");
      setTimeout(() => {
        row.remove();
        apply();
      }, 320);
    }
    // an open card stays, saying the cook has finished, until it's closed
    const card = cardFor(id);
    if (card) {
      if (open === id) {
        card.querySelector("[data-ended]")?.removeAttribute("hidden");
        card.querySelectorAll(".gl-ask input, .gl-ask button").forEach((el) => (el.disabled = true));
      } else card.remove();
    }
    stats();
    apply();
  }

  // the cook sees how many have their card open
  function tellWatching() {
    if (!connId) return;
    const body = new URLSearchParams({ conn: connId, session: open && !open.startsWith("demo-") ? open : "" });
    fetch("/global/watch", { method: "POST", body, headers: { accept: "application/json" } }).catch(() => {});
  }

  let es = null;
  let backoff = 2000;
  let retryTimer = 0;
  function setConn(text) {
    if (!conn) return;
    conn.hidden = !text;
    conn.textContent = text ?? "";
  }

  function connect() {
    if (!root.dataset.stream || !("EventSource" in window)) return;
    clearTimeout(retryTimer);
    es?.close();
    es = new EventSource(root.dataset.stream);
    es.addEventListener("hello", (e) => {
      connId = JSON.parse(e.data).conn;
      backoff = 2000;
      setConn(null);
      tellWatching();
    });
    // everything live right now: catch up on whatever changed while away
    es.addEventListener("sync", (e) => {
      const { sessions } = JSON.parse(e.data);
      const seen = new Set();
      for (const s of sessions) {
        seen.add(s.id);
        if (solo && s.id !== open) continue;
        refresh(s.id, s.v);
        setWatchers(s.id, s.w);
      }
      for (const [id, s] of byId) if (s.kind === "live" && !seen.has(id)) remove(id, "ended");
    });
    es.addEventListener("upsert", (e) => {
      const { id, v } = JSON.parse(e.data);
      if (solo && id !== open) return;
      refresh(id, v);
    });
    es.addEventListener("end", (e) => remove(JSON.parse(e.data).id, "ended"));
    es.addEventListener("watchers", (e) => {
      const { id, n } = JSON.parse(e.data);
      setWatchers(id, n);
    });
    es.onerror = () => {
      connId = null;
      // the browser retries a dropped stream itself; a refused one (too many
      // connections, a deploy) needs us to come back later, gently
      if (es.readyState === EventSource.CLOSED) {
        setConn("Live updates paused — reconnecting…");
        retryTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 60000);
      } else {
        setConn("Reconnecting to live updates…");
      }
    };
  }

  function setWatchers(id, n) {
    root.querySelectorAll(`[data-watch-count="${CSS.escape(id)}"]`).forEach((el) => (el.textContent = String(n)));
  }

  document.addEventListener("visibilitychange", () => {
    // a phone that slept may have a dead stream; start afresh when it wakes
    if (document.visibilityState === "visible" && (!es || es.readyState === EventSource.CLOSED)) connect();
  });

  /* ---------- asking a question ---------- */
  root.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-ask]")) return;
    e.preventDefault();
    const id = form.dataset.ask;
    const input = form.querySelector("input[name=text]");
    const status = form.querySelector("[data-ask-status]");
    const button = form.querySelector("button[type=submit]");
    if (!input?.value.trim()) return input?.focus();
    button.disabled = true;
    try {
      const res = await fetch(form.action, { method: "POST", body: new URLSearchParams(new FormData(form)), headers: { accept: "application/json" } });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        input.value = "";
        if (status) status.textContent = "Sent — the answer will appear here.";
        if (body.card) upsert(body.card);
      } else if (res.status === 404) {
        remove(id, "ended");
      } else if (status) {
        status.textContent = body.message ?? "That didn't send. Try again in a moment.";
      }
    } catch {
      if (status) status.textContent = "You seem to be offline. Try again in a moment.";
    } finally {
      button.disabled = false;
    }
  });

  apply();
  connect();

  // each cook's local time ("7:42 pm · dinner") ticks over on the minute
  const tick = () => {
    tickClocks(root);
    setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
  };
  setTimeout(tick, 60000 - (Date.now() % 60000) + 50);

  // a shared link (#live-104) opens straight onto that session
  if (!solo) {
    const fromHash = decodeURIComponent(location.hash.replace("#live-", ""));
    if (fromHash && byId.has(fromHash)) setTimeout(() => show(fromHash, true), 600);
  } else {
    tellWatching();
  }
}
