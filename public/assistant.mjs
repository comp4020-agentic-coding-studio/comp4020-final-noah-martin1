// "Ask about this recipe", enhanced. The server always answers first with
// checked facts (substitution table, pantry, scaling). If the visitor opts in,
// a small free model running in this browser rewords those facts into a
// friendly sentence or two. The model never replaces the checked answer: it
// appears under it, labelled, and if it fails to load nothing is lost.

const card = document.querySelector("[data-ask]");
if (card) init(card);

function init(card) {
  const id = card.dataset.ask;
  const form = card.querySelector("[data-ask-form]");
  const input = form.querySelector("input");
  const out = card.querySelector("[data-ask-answer]");
  const ai = card.querySelector("[data-ask-ai]");
  const toggle = card.querySelector("[data-ask-ai-toggle]");
  const label = card.querySelector("[data-ask-ai-label]");
  let lastFacts = null;
  let lastQ = "";
  let worker = null;
  let ready = false;
  let busy = false;
  const stored = (() => {
    try {
      return localStorage.getItem("larder-ai") === "on";
    } catch {
      return false;
    }
  })();

  // the model runs on the GPU through WebGPU; elsewhere the checked answer
  // stands alone and the switch isn't offered
  const capable = typeof Worker !== "undefined" && "gpu" in navigator;
  if (capable) ai.hidden = false;

  async function ask(q) {
    q = q.trim();
    if (!q) return;
    lastQ = q;
    out.hidden = false;
    out.classList.add("loading");
    out.innerHTML = `<p class="ask-headline"><span class="ask-typing"><i></i><i></i><i></i></span></p>`;
    try {
      const res = await fetch(`/recipes/${id}/ask?q=${encodeURIComponent(q)}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const a = await res.json();
      lastFacts = a;
      out.classList.remove("loading");
      out.innerHTML = a.html;
      if (ready || (stored && capable)) reword();
    } catch {
      // fall back to the plain form post, which renders the answer server-side
      form.submit();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });
  card.querySelectorAll("[data-ask-chip]").forEach((b) =>
    b.addEventListener("click", () => {
      input.value = b.textContent;
      ask(b.textContent);
    }),
  );

  /* ---------- the optional on-device model ---------- */
  // Food words the reply mentions that the checked facts don't: any at all and
  // the reply is dropped, because a small model inventing a swap is worse
  // than no reply.
  // at most two sentences, one paragraph
  function tidy(text) {
    const flat = text.split(/\n/)[0].trim();
    const sentences = flat.match(/[^.!?]+[.!?]+/g);
    return sentences && sentences.length > 2 ? sentences.slice(0, 2).join("").trim() : flat;
  }
  // a reply that's mostly the checked answer word for word adds nothing
  function echoes(text) {
    const norm = (t) => t.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
    const said = norm([lastFacts.headline, ...lastFacts.lines].join(" "));
    const reply = norm(text);
    const grams = (w) => new Set(w.slice(0, -2).map((_, i) => w.slice(i, i + 3).join(" ")));
    const a = grams(reply);
    const b = grams(said);
    if (!a.size) return false;
    let same = 0;
    for (const g of a) if (b.has(g)) same++;
    return same / a.size > 0.7;
  }
  function looping(text) {
    const s = (text.match(/[^.!?]+[.!?]/g) ?? []).map((x) => x.trim().toLowerCase());
    return new Set(s).size < s.length;
  }
  function strays(text) {
    if (!lastFacts?.guard) return [];
    const allowed = new Set(lastFacts.guard.allowed);
    const foods = new Set(lastFacts.guard.foods);
    const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
    return words.filter((w) => {
      const base = w.endsWith("s") ? w.slice(0, -1) : w;
      return (foods.has(w) || foods.has(base)) && !allowed.has(w) && !allowed.has(base) && ![...allowed].some((a) => a.startsWith(base));
    });
  }

  function setState(state, text) {
    ai.dataset.state = state;
    label.textContent = text;
    toggle.setAttribute("aria-pressed", state === "off" ? "false" : "true");
  }

  function start() {
    if (worker) return;
    setState("loading", "Fetching the assistant… 0%");
    worker = new Worker("/assets/assistant-worker.mjs", { type: "module" });
    worker.addEventListener("message", (e) => {
      const m = e.data;
      if (m.type === "progress") setState("loading", `Fetching the assistant… ${Math.round(m.pct)}%`);
      if (m.type === "ready") {
        ready = true;
        setState("on", "On-device assistant on");
        if (lastFacts) reword();
      }
      if (m.type === "token") {
        const el = out.querySelector(".ask-ai-reply span");
        if (el) el.textContent = tidy(m.text);
      }
      if (m.type === "done") {
        busy = false;
        const box = out.querySelector(".ask-ai-reply");
        box?.classList.remove("streaming");
        const final = tidy(m.text);
        if (box && (!final || strays(final).length || looping(m.text) || echoes(final))) box.remove();
        else if (box) box.querySelector("span").textContent = final;
      }
      if (m.type === "error") {
        busy = false;
        setState("error", m.message === "no-webgpu" ? "This browser can't run the on-device assistant. The checked answer above is complete on its own." : "The assistant couldn't start on this device. The checked answer above still stands.");
        out.querySelector(".ask-ai-reply")?.remove();
        worker?.terminate();
        worker = null;
      }
    });
    worker.postMessage({ type: "load" });
  }

  function reword() {
    if (!worker) start();
    if (!ready || busy || !lastFacts) return;
    busy = true;
    out.querySelector(".ask-ai-reply")?.remove();
    const box = document.createElement("div");
    box.className = "ask-ai-reply streaming";
    box.innerHTML = `<small>On-device assistant · rewording the facts above</small><span></span>`;
    out.append(box);
    worker.postMessage({ type: "ask", question: lastQ, facts: lastFacts.facts, headline: lastFacts.headline, lines: lastFacts.lines });
  }

  toggle.addEventListener("click", () => {
    if (ai.dataset.state === "on" || ai.dataset.state === "loading") {
      worker?.terminate();
      worker = null;
      ready = false;
      busy = false;
      out.querySelector(".ask-ai-reply")?.remove();
      setState("off", "Say it in plain words with the on-device assistant");
      try {
        localStorage.removeItem("larder-ai");
      } catch {}
      return;
    }
    try {
      localStorage.setItem("larder-ai", "on");
    } catch {}
    start();
  });

  setState("off", label.textContent);
  // someone who switched it on before gets it warmed up straight away
  if (stored && capable) start();
}
