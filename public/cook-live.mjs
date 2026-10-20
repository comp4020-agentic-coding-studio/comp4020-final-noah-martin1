// Cook mode's live side: going live, telling watchers each step as it's
// tapped, the on-air pill with a watcher count, questions arriving as cards
// to answer with one thumb, and the friend you're cooking along with. The
// step-by-step view itself is app.js; this watches it rather than changing
// it, so cook mode works exactly the same when nobody is live.
const box = document.querySelector("[data-live-root]");
const mode = document.querySelector("[data-cook-mode]");

if (box && mode) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

function start() {
  const steps = [...mode.querySelectorAll("li[data-step]")];
  const stepCount = Number(box.dataset.stepCount) || steps.length;
  const toast = document.querySelector("[data-cm-toast]");
  const qs = document.querySelector("[data-qs]");
  const onair = box.querySelector("[data-onair]");
  const lookback = document.querySelector("[data-lookback]");
  let session = box.dataset.session ? Number(box.dataset.session) : null;
  let liveStep = Number(box.dataset.liveStep) || 1;
  let pending = Promise.resolve();
  let stream = null;
  let ended = false;

  /* ---------- small helpers ---------- */
  let toastTimer = 0;
  // a message carried over from a plain form post fades after a moment
  if (toast && !toast.hidden) toastTimer = setTimeout(() => (toast.hidden = true), 4200);
  function say(text, tone = "") {
    if (!toast) return;
    toast.textContent = text;
    toast.className = `cm-toast ${tone}`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 4200);
  }

  async function post(path, fields, opts = {}) {
    const res = await fetch(path, {
      method: "POST",
      body: fields instanceof FormData ? new URLSearchParams(fields) : new URLSearchParams(fields),
      headers: { accept: "application/json" },
      keepalive: !!opts.keepalive,
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body };
  }

  // the step on screen, 1-based; stepCount + 1 once finished
  function shown() {
    if (mode.classList.contains("finished")) return stepCount + 1;
    const i = steps.findIndex((li) => li.classList.contains("current"));
    return i < 0 ? 1 : i + 1;
  }

  /* ---------- steps → watchers ---------- */
  function sync() {
    if (session === null || ended) return;
    const at = shown();
    const finished = at > stepCount;
    const target = Math.min(at, stepCount);
    if (lookback) {
      lookback.hidden = finished || target >= liveStep;
      const n = lookback.querySelector("[data-lookback-step]");
      if (n) n.textContent = String(liveStep);
    }
    if (target > liveStep) {
      const id = session;
      liveStep = target;
      pending = pending.then(async () => {
        try {
          const r = await post(`/live/${id}/step`, { step: String(target) }, { keepalive: true });
          if (r.status === 410 || r.status === 404) return lost("Your live session ended, so watchers no longer see your steps.");
          if (r.body.step) liveStep = Math.max(liveStep, r.body.step);
        } catch {
          say("Couldn't reach Larder — watchers will catch up on your next step.", "warn");
          liveStep = Math.min(liveStep, target - 1);
        }
      });
    }
    if (finished) {
      const id = session;
      pending = pending.then(async () => {
        try {
          await post(`/live/${id}/end`, { reason: "finished" }, { keepalive: true });
        } catch {
          // it ends by itself within the hour
        }
      });
      done("finished");
    }
  }

  new MutationObserver(() => sync()).observe(mode, { subtree: true, attributes: true, attributeFilter: ["class"] });

  // came back to a session already under way: pick up at the live step
  function catchUp() {
    if (session === null) return;
    const next = mode.querySelector("[data-step-next]");
    for (let k = shown(); k < liveStep && next; k++) next.click();
  }

  /* ---------- the banner: live status in words, and the off switch ---------- */
  const banner = document.querySelector("[data-live-banner]");
  const bannerText = banner?.querySelector("[data-live-banner-text]");
  const offForm = banner?.querySelector("[data-live-off]");
  const WHO = { public: "everyone on the globe", friends: "your friends", private: "only you" };
  function showLive(info) {
    if (!banner) return;
    banner.classList.add("is-live");
    bannerText.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = "You're live";
    bannerText.append(strong, ` — ${WHO[info.visibility] ?? "your friends"} can follow your steps · ${info.city || "not on the map"}.`);
    if (offForm) {
      offForm.hidden = false;
      offForm.action = `/live/${info.id}/end`;
    }
  }
  function showOff(text) {
    if (!banner) return;
    banner.classList.remove("is-live");
    bannerText.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = "Not live.";
    bannerText.append(strong, ` ${text}`);
    if (offForm) offForm.hidden = true;
  }
  offForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (session === null) return;
    await post(`/live/${session}/end`, { reason: "ended" }).catch(() => null);
    done("ended");
    showOff("You turned it off. Watchers no longer see your steps; keep cooking.");
    restoreGoLive();
    say("Live is off for this session.");
  });

  // the Go live sheet, kept so it can come back after turning live off
  const goliveTemplate = box.querySelector("[data-golive]")?.cloneNode(true) ?? null;
  function restoreGoLive() {
    if (!goliveTemplate || box.querySelector("[data-golive]")) return;
    const sheet = goliveTemplate.cloneNode(true);
    box.append(sheet);
    wireGoLive(sheet.querySelector("[data-golive-form]"));
  }

  /* ---------- on air ---------- */
  function goneLive(id, info) {
    session = id;
    ended = false;
    box.dataset.session = String(id);
    showLive({ ...info, id });
    const golive = box.querySelector("[data-golive]");
    golive?.remove();
    if (onair) {
      onair.hidden = false;
      onair.querySelector("[data-onair-globe]")?.setAttribute("href", `/global#live-${id}`);
      onair.querySelector("[data-help-form]")?.setAttribute("action", `/live/${id}/help`);
      onair.querySelector("[data-end-form]")?.setAttribute("action", `/live/${id}/end`);
      const who = onair.querySelector("[data-onair-who]");
      if (who) {
        const v = info.visibility === "public" ? "Everyone can watch" : info.visibility === "friends" ? "Friends can watch" : "Only you can see this";
        who.textContent = info.city ? `${v} · ${info.city}` : v;
      }
    }
    listen();
    beat();
  }

  function done(reason) {
    ended = true;
    session = null;
    box.dataset.session = "";
    stream?.close();
    clearInterval(beatTimer);
    if (reason === "finished") showOff("Your live session ended when you finished. Thanks for cooking with everyone.");
    else if (reason === "lost") showOff("Your live session ended.");
    if (onair) onair.hidden = true;
    if (lookback) lookback.hidden = true;
    const note = document.querySelector("[data-done-live]");
    if (note && reason === "finished") note.hidden = false;
  }

  function lost(message) {
    if (ended) return;
    if (!retried && box.hasAttribute("data-auto-pref") && !mode.classList.contains("finished")) {
      retried = true;
      done("quiet");
      autoStart();
      return;
    }
    done("lost");
    say(message, "warn");
  }

  /* ---------- go live ---------- */
  wireGoLive(box.querySelector("[data-golive-form]"));
  function wireGoLive(form) {
    if (!form) return;
    const city = form.querySelector("[data-city]");
    const where = form.querySelector("[data-where]");
    const lat = form.querySelector("[data-lat]");
    const lng = form.querySelector("[data-lng]");
    const note = form.querySelector("[data-where-note]");
    const locate = form.querySelector("[data-locate]");
    const defaultNote = note?.textContent ?? "";
    if (locate && "geolocation" in navigator) locate.hidden = false;

    city?.addEventListener("change", () => {
      where.value = city.value === "none" ? "none" : "city";
      lat.value = lng.value = "";
      if (note) note.textContent = city.value === "none" ? "You'll be listed with the other cooks, but not pinned on the map." : defaultNote;
    });
    locate?.addEventListener("click", () => {
      locate.disabled = true;
      if (note) note.textContent = "Asking your browser for your location…";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          // rounded here and again on the server: about 10 km, never closer
          lat.value = String(Math.round(pos.coords.latitude * 10) / 10);
          lng.value = String(Math.round(pos.coords.longitude * 10) / 10);
          where.value = "near";
          city.required = false;
          city.value = "";
          locate.disabled = false;
          locate.classList.add("on");
          if (note) note.textContent = `Using your rough location (${lat.value}, ${lng.value}) — rounded to about 10 km.`;
        },
        () => {
          locate.disabled = false;
          if (note) note.textContent = "No location shared — choose a city instead.";
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
      );
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (where.value === "city" && !city.value) {
        city.focus();
        if (note) note.textContent = "Choose a city first, or “Don't show me on the map”.";
        return;
      }
      const fields = new FormData(form);
      fields.set("step", String(Math.min(shown(), stepCount)));
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const r = await post("/live/start", fields);
        if (!r.ok) {
          say(r.body.error ?? "Couldn't go live just now. Try again in a moment.", "warn");
          return;
        }
        liveStep = r.body.step ?? 1;
        goneLive(r.body.id, r.body);
        say(r.body.visibility === "public" ? "You're live on the globe." : r.body.visibility === "friends" ? "You're live — friends can watch." : "You're live, just for you.", "good");
      } catch {
        say("You seem to be offline. Try again in a moment.", "warn");
      } finally {
        button.disabled = false;
      }
    });
  }

  /* ---------- live by default ---------- */
  // Cook mode goes live as it opens, unless the person turned that off
  // (the server checks the preference again and decides who can see it).
  // the previous page's leave beacon can land after this page loaded and end
  // the session it shows; with automatic live on, quietly go live again once
  let retried = false;
  function autoStart() {
    return post("/live/auto", { recipe_id: box.dataset.recipe, serves: box.dataset.serves ?? "", step: String(Math.min(shown(), stepCount)) })
      .then((r) => {
        if (r.ok && r.body.ok) {
          liveStep = r.body.step ?? 1;
          goneLive(r.body.id, r.body);
          if (!r.body.already) say(r.body.visibility === "public" ? "You're live on the globe. Turn it off any time." : r.body.visibility === "friends" ? "You're live for friends. Turn it off any time." : "You're live, just for you.", "good");
        } else if (r.body.reason === "elsewhere") showOff(`You're live with ${r.body.elsewhere} in another tab.`);
        else showOff(r.body.reason === "off" ? "Automatic live is off in settings." : "Tap Go live to share your steps.");
      })
      .catch(() => showOff("Couldn't reach Larder to go live. Tap Go live to try again."));
  }
  if (box.hasAttribute("data-auto-live") && session === null) {
    autoStart();
  } else if (session === null && banner && bannerText.textContent.includes("Going live")) {
    showOff("Tap Go live to share your steps.");
  }

  // Leaving cook mode ends the session, so nobody's left "live" on the globe
  // after closing the page. A reload comes straight back (live by default),
  // and if the beacon is lost the 45-minute idle rule still ends it.
  window.addEventListener("pagehide", (e) => {
    if (session === null || ended || e.persisted) return;
    const body = new URLSearchParams({ reason: "left" });
    navigator.sendBeacon?.(`/live/${session}/end`, body);
  });

  /* ---------- help, end ---------- */
  onair?.querySelector("[data-help-form]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (session === null) return;
    const f = e.currentTarget;
    const r = await post(`/live/${session}/help`, new FormData(f)).catch(() => null);
    if (!r) return say("You seem to be offline.", "warn");
    say(r.ok ? (f.querySelector("input[name=text]").value.trim() ? "Asked everyone watching." : "Help request cleared.") : r.body.message ?? "That didn't send.", r.ok ? "good" : "warn");
    if (r.ok) onair.open = false;
  });
  onair?.querySelector("[data-end-form]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (session === null) return;
    await post(`/live/${session}/end`, { reason: "ended" }).catch(() => null);
    done("ended");
    say("Live session ended. You can keep cooking.");
  });

  // close a sheet on Escape or a tap outside it
  document.addEventListener("click", (e) => {
    box.querySelectorAll("details[open]").forEach((d) => {
      if (!d.contains(e.target)) d.open = false;
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") box.querySelectorAll("details[open]").forEach((d) => (d.open = false));
  });

  /* ---------- questions ---------- */
  const shownQs = new Set([...(qs?.querySelectorAll("[data-q]") ?? [])].map((el) => Number(el.dataset.q)));

  function questionCard(q) {
    const el = document.createElement("article");
    el.className = "cm-q arrive";
    el.dataset.q = String(q.id);
    const head = document.createElement("header");
    const av = document.createElement("span");
    av.className = "avatar avatar-sm";
    av.setAttribute("aria-hidden", "true");
    av.textContent = q.who.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
    const who = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = q.who;
    who.append(strong, " asks");
    head.append(av, who);
    const text = document.createElement("p");
    text.className = "cm-q-text";
    text.textContent = q.text;
    // the reply form is the server-rendered one's twin, built safely
    const f = document.createElement("form");
    f.className = "cm-q-form";
    f.method = "post";
    f.action = `/global/${session}/answer`;
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = "question";
    hidden.value = String(q.id);
    const quick = document.createElement("div");
    quick.className = "cm-q-quick";
    for (const [label, value] of [["Yes, that works", "Yes, that works!"], ["I wouldn't", "I wouldn't — it changes the dish."], ["Not sure, try it", "Not sure — give it a go!"]]) {
      const b = document.createElement("button");
      b.type = "submit";
      b.name = "text";
      b.value = value;
      b.textContent = label;
      quick.append(b);
    }
    const rowEl = document.createElement("div");
    rowEl.className = "cm-q-row";
    const input = document.createElement("input");
    input.name = "text";
    input.maxLength = 280;
    input.placeholder = "Or type an answer…";
    input.autocomplete = "off";
    input.setAttribute("aria-label", `Answer ${q.who}`);
    const send = document.createElement("button");
    send.className = "button button-small";
    send.type = "submit";
    send.textContent = "Send";
    rowEl.append(input, send);
    f.append(hidden, quick, rowEl);
    el.append(head, text, f);
    return el;
  }

  async function loadQuestions(announce) {
    if (session === null || !qs) return;
    try {
      const res = await fetch(`/live/${session}/questions`, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      const body = await res.json();
      const fresh = body.questions.filter((q) => !q.answer && !shownQs.has(q.id));
      for (const q of fresh) {
        shownQs.add(q.id);
        qs.append(questionCard(q));
      }
      // answered elsewhere (another tab): tidy the card away
      for (const q of body.questions) if (q.answer) qs.querySelector(`[data-q="${q.id}"]`)?.remove();
      qs.hidden = !qs.querySelector("[data-q]");
      if (announce && fresh.length) {
        say(fresh.length === 1 ? `${fresh[0].who} asked a question` : `${fresh.length} new questions`, "good");
        navigator.vibrate?.(60);
      }
    } catch {
      // the next event or heartbeat tries again
    }
  }

  qs?.addEventListener("submit", async (e) => {
    const f = e.target;
    if (!(f instanceof HTMLFormElement)) return;
    e.preventDefault();
    const fields = new FormData(f, e.submitter ?? undefined);
    // the Send button carries the typed answer; a quick reply its own text
    const typed = f.querySelector(".cm-q-row input");
    const isQuick = e.submitter?.name === "text";
    fields.delete("text");
    if (isQuick) fields.set("text", e.submitter.value);
    else {
      if (!typed.value.trim()) return typed.focus();
      fields.set("text", typed.value);
    }
    f.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const r = await post(`/global/${session}/answer`, fields);
      if (r.ok) {
        const card = f.closest("[data-q]");
        card.classList.add("leave");
        setTimeout(() => {
          card.remove();
          qs.hidden = !qs.querySelector("[data-q]");
        }, 320);
        say("Answer sent.", "good");
      } else {
        say(r.body.message ?? "That didn't send.", "warn");
        f.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    } catch {
      say("You seem to be offline. Try again in a moment.", "warn");
      f.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  });

  /* ---------- live updates for the cook ---------- */
  function listen() {
    if (session === null || !("EventSource" in window)) return;
    stream?.close();
    stream = new EventSource(`/global/stream?only=${session}`);
    stream.addEventListener("sync", (e) => {
      const mine = JSON.parse(e.data).sessions.find((s) => Number(s.id) === session);
      if (!mine) return lost("Your live session has ended.");
      setWatchers(mine.w);
      loadQuestions(false);
    });
    stream.addEventListener("upsert", (e) => {
      const ev = JSON.parse(e.data);
      if (Number(ev.id) === session && (ev.kind === "question" || ev.kind === "answer")) loadQuestions(ev.kind === "question");
    });
    stream.addEventListener("watchers", (e) => {
      const ev = JSON.parse(e.data);
      if (Number(ev.id) === session) setWatchers(ev.n);
    });
    stream.addEventListener("end", (e) => {
      if (Number(JSON.parse(e.data).id) === session && !ended) lost("Your live session has ended.");
    });
  }

  function setWatchers(n) {
    const el = box.querySelector("[data-watchers]");
    if (!el) return;
    if (el.textContent !== String(n)) {
      el.textContent = String(n);
      el.parentElement?.classList.remove("tick");
      void el.offsetWidth;
      el.parentElement?.classList.add("tick");
    }
  }

  // a long simmer isn't someone who wandered off: check in every 5 minutes
  let beatTimer = 0;
  function beat() {
    clearInterval(beatTimer);
    beatTimer = setInterval(async () => {
      if (session === null || ended) return;
      try {
        const r = await post(`/live/${session}/heartbeat`, {});
        if (r.status === 410 || r.status === 404) lost("Your live session timed out. Go live again any time.");
      } catch {
        // offline: try again next time
      }
    }, 5 * 60_000);
  }

  /* ---------- cooking along with someone ---------- */
  const along = box.querySelector("[data-along]");
  if (along && "EventSource" in window) {
    const id = along.dataset.along;
    const label = along.querySelector("[data-along-step]");
    const es = new EventSource(`/global/stream?only=${id}`);
    const update = async () => {
      try {
        const res = await fetch(`/global/${id}/card`, { headers: { accept: "application/json" } });
        if (!res.ok) {
          label.textContent = "finished cooking";
          along.classList.add("ended");
          es.close();
          return;
        }
        const card = await res.json();
        label.textContent = `step ${card.marker.step} of ${card.marker.steps}`;
        along.classList.remove("tick");
        void along.offsetWidth;
        along.classList.add("tick");
      } catch {
        // try again on the next event
      }
    };
    es.addEventListener("upsert", update);
    es.addEventListener("end", () => {
      label.textContent = "finished cooking";
      along.classList.add("ended");
      es.close();
    });
  }

  if (session !== null) {
    catchUp();
    listen();
    beat();
    sync();
  }
}
