// "I'm writing": tells the server while someone types in a box, so others
// see three dots. The note stays up through a pause to think (PAUSE_MS after
// the last key, refreshed so the server, which forgets after 8 s, doesn't
// drop it early), and comes down at once when the box is cleared, the thing
// is sent, or the page is left. Used by the live globe (asking a cook) and
// cook mode (answering); reviews.mjs has the same rules for reviews.
const PAUSE_MS = 5000;
const REFRESH_MS = 3000;

// `url()` gives the endpoint to post to right now (null: nowhere, e.g. not
// live any more). Returns { input(box), stop() }.
export function typingNote(url) {
  let on = false;
  let to = null;
  let lastSent = 0;
  let idle = 0;
  let keep = 0;
  function send(next) {
    const now = Date.now();
    const target = next ? url() : to;
    if (!target) return;
    if (next && on && target === to && now - lastSent < REFRESH_MS) return;
    if (!next && !on) return;
    // moved to another session while on: the old one is told first
    if (next && on && target !== to) send(false);
    on = next;
    to = target;
    lastSent = now;
    fetch(target, { method: "POST", body: new URLSearchParams({ on: next ? "1" : "0" }), headers: { accept: "application/json" }, keepalive: !next }).catch(() => {});
  }
  function stop() {
    clearTimeout(idle);
    clearInterval(keep);
    keep = 0;
    send(false);
  }
  function input(box) {
    clearTimeout(idle);
    if (!box.value.trim()) return stop();
    send(true);
    keep ||= setInterval(() => send(true), REFRESH_MS);
    idle = setTimeout(stop, PAUSE_MS);
  }
  addEventListener("pagehide", stop);
  return { input, stop };
}

// The dots and a line under them ("Sam is asking…"), or nothing.
export function typingLine(el, who, t) {
  if (!el) return;
  if (!who.length) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  const dots = document.createElement("span");
  dots.className = "ask-typing";
  dots.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) dots.append(document.createElement("i"));
  const text = document.createElement("span");
  const first = (n) => n.split(/\s+/)[0];
  text.textContent =
    who[0].role === "answering"
      ? t("{name} is answering…", { name: first(who[0].name) })
      : who.length === 1
        ? t("{name} is asking…", { name: first(who[0].name) })
        : t("{n} people are asking…", { n: who.length });
  el.replaceChildren(dots, text);
  el.hidden = false;
}
