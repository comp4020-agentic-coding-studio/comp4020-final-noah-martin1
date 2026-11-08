// The reviews on a recipe page, made live: posting, replying, liking and
// deleting without leaving the page; photos uploaded as they're chosen; a
// picker for linking other recipes; "Sam is writing…" while others type;
// new reviews from others appearing as they're posted; and translation into
// English in a worker. Everything here is an enhancement: each action is a
// plain form or link that works without this script.

import { locale, t, tn } from "./i18n.mjs";

const section = document.querySelector("[data-rv-section]");
if (section) start(section);

// a review language's name in the page's language ("Spanish", "西班牙语")
function languageLabel(code) {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function start(section) {
  const recipe = section.dataset.recipe;
  const signedIn = section.dataset.signedIn === "1";
  const base = `/recipes/${recipe}/reviews`;
  const list = () => section.querySelector("[data-rv-list]");
  const typingLine = section.querySelector("[data-rv-typing]");

  const post = async (url, body, opts = {}) => {
    const res = await fetch(url, { method: "POST", headers: { accept: "application/json", ...(opts.headers ?? {}) }, body });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // a non-JSON answer (an error or sign-in page): never a success
    }
    if (!res.ok || res.redirected || data === null) {
      const msg = data?.error || (res.status === 401 || res.redirected ? t("You've been signed out. Sign in again (copy your text first).") : res.status === 429 ? t("You're posting very fast. Wait a few seconds.") : t("That didn't work. Check your connection and try again."));
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return data;
  };

  const say = (el, text, bad = false) => {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("is-bad", bad);
  };

  /* ---------- typing: tell others while I write ---------- */

  // Someone writing pauses to think, so the dots stay up for a while after
  // the last key (PAUSE_MS) rather than flickering off mid-sentence. While
  // they do, the page keeps the server's note fresh (it forgets after 8 s).
  // Clearing the box, posting or leaving takes them down at once.
  const PAUSE_MS = 5000;
  const REFRESH_MS = 3000;
  let typingOn = false;
  let lastSent = 0;
  let idleTimer = 0;
  let keepTimer = 0;
  function sendTyping(on) {
    if (!signedIn) return;
    const now = Date.now();
    // "on" at most every 3 s; "off" at once
    if (on && typingOn && now - lastSent < REFRESH_MS) return;
    if (!on && !typingOn) return;
    typingOn = on;
    lastSent = now;
    fetch(`${base}/typing`, { method: "POST", body: new URLSearchParams({ on: on ? "1" : "0" }), keepalive: !on }).catch(() => {});
  }
  function stopTyping() {
    clearTimeout(idleTimer);
    clearInterval(keepTimer);
    keepTimer = 0;
    sendTyping(false);
  }
  section.addEventListener("input", (e) => {
    if (!e.target.matches("[data-rv-body]")) return;
    const box = e.target;
    const count = box.closest("form")?.querySelector("[data-rv-count-chars]");
    if (count) count.textContent = `${box.value.length} / ${box.maxLength}`;
    clearTimeout(idleTimer);
    if (!box.value.trim()) return stopTyping();
    sendTyping(true);
    // through a pause, keep the note fresh so the dots don't drop early
    keepTimer ||= setInterval(() => sendTyping(true), REFRESH_MS);
    idleTimer = setTimeout(stopTyping, PAUSE_MS);
  });
  // posting a review or reply ends it straight away
  section.addEventListener("submit", (e) => {
    if (e.target.querySelector?.("[data-rv-body]")) stopTyping();
  });
  addEventListener("pagehide", () => stopTyping());

  /* ---------- live: others' reviews, likes and typing ---------- */

  let es = null;
  let backoff = 2000;
  function connect() {
    if (es || document.hidden || typeof EventSource === "undefined") return;
    es = new EventSource(`${base}/stream`);
    es.addEventListener("open", () => (backoff = 2000));
    es.addEventListener("typing", (e) => showTyping(JSON.parse(e.data).names));
    es.addEventListener("review", () => noteNew());
    es.addEventListener("edit", (e) => refreshOne(JSON.parse(e.data)));
    es.addEventListener("reply", (e) => addReply(JSON.parse(e.data)));
    es.addEventListener("delete", (e) => removeOne(JSON.parse(e.data)));
    es.addEventListener("like", (e) => {
      const d = JSON.parse(e.data);
      const n = section.querySelector(`[data-rv="${d.reviewId}"] > .rv-main [data-rv-likes]`);
      if (n) n.textContent = d.likes || "";
    });
    es.addEventListener("error", () => {
      if (es?.readyState === EventSource.CLOSED) {
        es.close();
        es = null;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 60000);
      }
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      es?.close();
      es = null;
      sendTyping(false);
    } else connect();
  });
  connect();

  function showTyping(names) {
    if (!typingLine) return;
    if (!names.length) {
      typingLine.hidden = true;
      typingLine.replaceChildren();
      return;
    }
    const first = (n) => n.split(" ")[0];
    const label = names.length === 1 ? t("{name} is writing…", { name: first(names[0]) }) : names.length === 2 ? t("{a} and {b} are writing…", { a: first(names[0]), b: first(names[1]) }) : t("{n} people are writing…", { n: names.length });
    const dots = document.createElement("span");
    dots.className = "ask-typing";
    dots.setAttribute("aria-hidden", "true");
    dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
    const text = document.createElement("span");
    text.textContent = label;
    typingLine.replaceChildren(dots, text);
    typingLine.hidden = false;
  }

  // a new review by someone else: a quiet button rather than the list
  // jumping under the reader's eyes
  let pendingNew = 0;
  let mineJustPosted = false;
  function noteNew() {
    if (mineJustPosted) return void (mineJustPosted = false);
    pendingNew++;
    let bar = section.querySelector("[data-rv-new]");
    if (!bar) {
      bar = document.createElement("button");
      bar.type = "button";
      bar.className = "rv-newbar";
      bar.dataset.rvNew = "";
      bar.addEventListener("click", () => reloadList(true));
      section.querySelector("[data-rv-filters]")?.before(bar) ?? list()?.before(bar);
    }
    bar.textContent = tn(pendingNew, "{n} new review · Show", "{n} new reviews · Show");
  }

  // the list (and summary) again from the server, keeping the filters.
  // `ownPost`: the composer is replaced too (it now edits that review);
  // otherwise it's kept if something is being typed in it
  async function reloadList(scroll = false, ownPost = false) {
    // after a refused no-script post the address is the form's (POST only)
    const here = /\/reviews(\/|$)/.test(location.pathname) ? `/recipes/${recipe}` : location.pathname + location.search;
    if (here !== location.pathname + location.search) history.replaceState({}, "", `${here}#reviews`);
    const res = await fetch(here, { headers: { accept: "text/html" } });
    if (!res.ok) {
      // the post went through; say so rather than leave "Posting…"
      if (ownPost) location.assign(`${here}#reviews`);
      return;
    }
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const fresh = doc.querySelector("[data-rv-section]");
    if (!fresh) return;
    // keep whatever is being typed in the main box
    const box = section.querySelector("[data-rv-compose] [data-rv-body]");
    const typed = box?.value;
    for (const sel of [".rv-top", "[data-rv-filters]"]) {
      const old = section.querySelector(sel);
      const neu = fresh.querySelector(sel);
      if (old && neu) old.replaceWith(neu);
      else if (old && !neu) old.remove();
      else if (!old && neu) section.querySelector("[data-rv-typing]")?.after(neu);
    }
    mergeList(fresh);
    // "Show more" and "no matches" sit after the list
    for (const sel of [".rx-more", ".rv-empty"]) {
      section.querySelector(sel)?.remove();
      const neu = fresh.querySelector(sel);
      if (neu) (section.querySelector("[data-rv-list]") ?? section.querySelector("[data-rv-filters]") ?? typingLine).after(neu);
    }
    const newCompose = fresh.querySelector("#write");
    const oldCompose = section.querySelector("#write");
    if (newCompose && oldCompose && (ownPost || !(box && typed && typed !== box.defaultValue))) oldCompose.replaceWith(newCompose);
    // the star badge at the top of the page
    const badge = document.querySelector(".rd-rating");
    const freshBadge = doc.querySelector(".rd-rating");
    if (badge && freshBadge) badge.replaceWith(freshBadge);
    section.querySelector("[data-rv-new]")?.remove();
    pendingNew = 0;
    revealTranslate();
    if (scroll) section.querySelector("[data-rv-list]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // The fresh list laid over the one on the page, review by review: a
  // review someone is replying to, editing a reply under, or has expanded
  // keeps its thread as it is (only its own header and words refresh), so
  // nothing typed is lost when someone else posts.
  function mergeList(fresh) {
    const neu = fresh.querySelector("[data-rv-list]");
    let old = section.querySelector("[data-rv-list]");
    if (!neu) {
      old?.remove();
      return;
    }
    if (!old) {
      (section.querySelector("[data-rv-filters]") ?? typingLine).after(neu);
      return;
    }
    const keep = new Map();
    for (const li of old.children) {
      const busy = li.querySelector("[data-rv-replyform], [data-rv-thread].is-expanded");
      if (busy) keep.set(li.dataset.rv, li);
    }
    for (const li of [...neu.children]) {
      const kept = keep.get(li.dataset.rv);
      if (!kept) continue;
      // its header, words, photos and actions from the server; its thread from the page
      const main = li.querySelector(":scope > .rv-main");
      if (main) kept.querySelector(":scope > .rv-main")?.replaceWith(main);
      li.replaceWith(kept);
    }
    old.replaceWith(neu);
  }

  async function refreshOne(d) {
    const li = section.querySelector(`[data-rv="${d.reviewId}"]`);
    if (!li) return;
    // a review's edit: refresh the whole list (its stars change the summary)
    if (!d.parentId) return reloadList();
    const res = await fetch(`${base}/${d.parentId}?partial=replies`);
    if (!res.ok) return;
    const holder = document.createElement("ol");
    holder.innerHTML = await res.text();
    const fresh = holder.querySelector(`[data-rv="${d.reviewId}"]`);
    if (fresh) li.replaceWith(fresh);
    revealTranslate();
  }

  async function addReply(d) {
    if (section.querySelector(`[data-rv="${d.reviewId}"]`)) return;
    const thread = section.querySelector(`[data-rv-thread="${d.parentId}"] .rv-replies`);
    if (!thread) return;
    const res = await fetch(`${base}/${d.parentId}?partial=replies`);
    if (!res.ok) return;
    const holder = document.createElement("ol");
    holder.innerHTML = await res.text();
    const fresh = holder.querySelector(`[data-rv="${d.reviewId}"]`);
    // it may have been added while this was fetching (my own reply)
    if (fresh && !section.querySelector(`[data-rv="${d.reviewId}"]`)) {
      fresh.classList.add("rv-arrived");
      thread.append(fresh);
      revealTranslate();
    }
  }

  function removeOne(d) {
    const li = section.querySelector(`[data-rv="${d.reviewId}"]`);
    if (!li) return;
    // a review kept as "[deleted]" for its replies is shown that way after a reload
    if (!d.parentId) return reloadList();
    li.remove();
  }

  // choosing a sort goes to that order (the form's own button is for no script)
  section.addEventListener("change", (e) => {
    const select = e.target.closest("[data-rv-sort] select");
    if (select) select.form.requestSubmit();
  });

  /* ---------- posting a review ---------- */

  section.addEventListener("submit", async (e) => {
    const form = e.target;
    if (form.matches("[data-rv-compose]")) {
      e.preventDefault();
      await submitReview(form);
    } else if (form.matches("[data-rv-replyform]")) {
      e.preventDefault();
      await submitReply(form);
    } else if (form.matches("[data-rv-like]")) {
      e.preventDefault();
      await like(form);
    } else if (form.matches("[data-rv-delete]")) {
      e.preventDefault();
      if (!confirm(form.dataset.confirm)) return;
      await remove(form);
    }
  });

  function errorBox(form) {
    let p = form.querySelector(".form-errors");
    if (!p) {
      p = document.createElement("p");
      p.className = "form-errors";
      p.setAttribute("role", "alert");
      form.prepend(p);
    }
    return p;
  }

  async function submitReview(form) {
    const btn = form.querySelector("[type=submit]");
    if (btn.disabled) return;
    if (!form.querySelector("input[name=rating]:checked")) {
      errorBox(form).textContent = t("Choose a star rating from 1 to 5.");
      form.querySelector("input[name=rating]")?.focus();
      return;
    }
    if (form.querySelector("[data-rv-photos] .is-uploading")) {
      errorBox(form).textContent = t("Wait for the photos to finish uploading.");
      return;
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = t("Posting…");
    try {
      const data = new URLSearchParams();
      for (const [k, v] of new FormData(form)) if (typeof v === "string") data.append(k, v);
      // a new review echoes back as "review"; an edit as "edit"
      mineJustPosted = !section.querySelector(".rv-mine");
      await post(form.action, data);
      sendTyping(false);
      await reloadList(false, true);
      const mine = section.querySelector(".rv-mine");
      mine?.classList.add("rv-arrived");
      mine?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      mineJustPosted = false;
      errorBox(form).textContent = err.message;
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /* ---------- replies ---------- */

  section.addEventListener("click", async (e) => {
    const reply = e.target.closest("[data-rv-reply]");
    if (reply) {
      e.preventDefault();
      return openReply(reply);
    }
    const editLink = e.target.closest("[data-rv-edit]");
    if (editLink) {
      e.preventDefault();
      return openEdit(editLink);
    }
    const cancel = e.target.closest("[data-rv-cancel]");
    if (cancel) {
      e.preventDefault();
      const form = cancel.closest("form");
      const restore = form._restore;
      form.remove();
      restore?.();
      sendTyping(false);
      return;
    }
    const allReplies = e.target.closest("[data-rv-all-replies]");
    if (allReplies) {
      e.preventDefault();
      const id = allReplies.dataset.rvAllReplies;
      allReplies.textContent = t("Loading…");
      const res = await fetch(`${base}/${id}?partial=replies`);
      if (!res.ok) return void (allReplies.textContent = t("Couldn't load the replies. Try again."));
      const thread = section.querySelector(`[data-rv-thread="${id}"]`);
      thread.querySelector(".rv-replies").innerHTML = await res.text();
      thread.classList.add("is-expanded");
      allReplies.remove();
      revealTranslate();
      return;
    }
    const more = e.target.closest("[data-rv-more]");
    if (more) {
      e.preventDefault();
      more.textContent = t("Loading…");
      const url = new URL(more.href, location.href);
      url.hash = "";
      const res = await fetch(url, { headers: { accept: "text/html" } });
      if (!res.ok) return void (location.href = more.href);
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const freshList = doc.querySelector("[data-rv-list]");
      const have = new Set([...list().children].map((li) => li.dataset.rv));
      for (const li of freshList?.children ?? []) if (!have.has(li.dataset.rv)) list().append(li.cloneNode(true));
      const nextMore = doc.querySelector("[data-rv-more]");
      if (nextMore) more.replaceWith(nextMore);
      else more.closest(".rx-more")?.remove();
      history.replaceState({}, "", url);
      revealTranslate();
      return;
    }
    const translate = e.target.closest("[data-rv-translate]");
    if (translate) return toggleTranslate(translate);
    const linkOpen = e.target.closest("[data-rv-link-open]");
    if (linkOpen) return toggleLinkPicker(linkOpen.closest("[data-rv-attach]"));
    const unlink = e.target.closest("[data-rv-unlink]");
    if (unlink) {
      unlink.closest(".rv-linkchip").remove();
      return;
    }
    const unphoto = e.target.closest("[data-rv-unphoto]");
    if (unphoto) {
      const attach = unphoto.closest("[data-rv-attach]");
      unphoto.closest(".rv-thumb").remove();
      updatePhotoTool(attach);
    }
  });

  async function openReply(link) {
    const id = link.dataset.rvReply;
    const li = link.closest("[data-rv]");
    const parent = li.dataset.parent;
    const slot = section.querySelector(`[data-rv-reply-slot="${parent}"]`);
    if (!slot) return void (location.href = link.href);
    // one reply box at a time
    section.querySelectorAll("[data-rv-replyform]").forEach((f) => (f.querySelector("[data-rv-body]")?.value ? null : f.remove()));
    const existing = slot.querySelector("[data-rv-replyform]");
    if (existing && existing.dataset.to === id) return existing.querySelector("textarea").focus();
    const res = await fetch(link.href.replace(/#.*$/, ""), { headers: { accept: "text/html" } });
    if (!res.ok) return void (location.href = link.href);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const form = doc.querySelector("[data-rv-replyform]");
    if (!form) return void (location.href = link.href);
    form.dataset.to = id;
    slot.replaceChildren(form);
    enhanceAttach(form.querySelector("[data-rv-attach]"));
    const box = form.querySelector("textarea");
    box.focus();
    form.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function openEdit(link) {
    const li = link.closest("[data-rv]");
    // already open: just focus it
    const open = li.querySelector(":scope > .rv-main [data-rv-replyform]");
    if (open) return open.querySelector("textarea")?.focus();
    const res = await fetch(link.href.replace(/#.*$/, ""), { headers: { accept: "text/html" } });
    if (!res.ok) return void (location.href = link.href);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const form = doc.querySelector("[data-rv-replyform]");
    if (!form) return void (location.href = link.href);
    const main = li.querySelector(".rv-main");
    const text = main.querySelector("[data-rv-text]");
    text.hidden = true;
    text.after(form);
    form._restore = () => (text.hidden = false);
    form.querySelector("textarea").focus();
  }

  async function submitReply(form) {
    const btn = form.querySelector("[type=submit]");
    if (btn.disabled) return;
    if (form.querySelector("[data-rv-photos] .is-uploading")) {
      errorBox(form).textContent = t("Wait for the photos to finish uploading.");
      return;
    }
    btn.disabled = true;
    try {
      const data = new URLSearchParams();
      for (const [k, v] of new FormData(form)) if (typeof v === "string") data.append(k, v);
      const res = await post(form.action, data);
      sendTyping(false);
      const holder = document.createElement("ol");
      holder.innerHTML = res.html;
      const item = holder.firstElementChild;
      item?.classList.add("rv-arrived");
      if (form.id === "edit") {
        // the edited reply in place
        form.closest("[data-rv]")?.replaceWith(item);
      } else {
        const thread = form.closest("[data-rv-thread]")?.querySelector(".rv-replies");
        // the live stream may have shown it already (or will, any moment):
        // one copy, this one
        section.querySelector(`[data-rv="${res.id}"]`)?.remove();
        thread?.append(item);
        form.remove();
      }
      revealTranslate();
    } catch (err) {
      errorBox(form).textContent = err.message;
      btn.disabled = false;
    }
  }

  /* ---------- likes and deleting ---------- */

  async function like(form) {
    const btn = form.querySelector("button");
    const count = btn.querySelector("[data-rv-likes]");
    const was = btn.classList.contains("is-on");
    const n = Number(count.textContent) || 0;
    // shown at once, put back if the server says no
    btn.classList.toggle("is-on", !was);
    btn.setAttribute("aria-pressed", String(!was));
    count.textContent = String(n + (was ? -1 : 1) || "");
    try {
      const res = await post(form.action, new URLSearchParams());
      btn.classList.toggle("is-on", res.liked);
      btn.setAttribute("aria-pressed", String(res.liked));
      count.textContent = res.likes || "";
    } catch (err) {
      btn.classList.toggle("is-on", was);
      btn.setAttribute("aria-pressed", String(was));
      count.textContent = n || "";
      btn.title = err.message;
    }
  }

  async function remove(form) {
    const li = form.closest("[data-rv]");
    try {
      const res = await post(form.action, new URLSearchParams());
      if (li.classList.contains("rv-reply")) li.remove();
      else if (res.removed === "content") await reloadList();
      else {
        li.remove();
        await reloadList();
      }
    } catch (err) {
      alert(err.message);
    }
  }

  /* ---------- photos ---------- */

  function enhanceAttach(attach) {
    if (!attach || attach.dataset.ready) return;
    attach.dataset.ready = "1";
    attach.querySelector("[data-rv-link-open]")?.removeAttribute("hidden");
    const input = attach.querySelector("[data-rv-photo-input]");
    // the script uploads photos itself; the file input no longer goes with the form
    input?.removeAttribute("name");
    input?.addEventListener("change", () => {
      const files = [...input.files];
      input.value = "";
      for (const f of files) upload(attach, f);
    });
    updatePhotoTool(attach);
    const q = attach.querySelector("[data-rv-link-q]");
    q?.addEventListener("input", () => searchLinks(attach));
    q?.addEventListener("keydown", (e) => linkKeys(attach, e));
  }

  function updatePhotoTool(attach) {
    if (!attach) return;
    const n = attach.querySelectorAll("[data-rv-photos] .rv-thumb").length;
    const tool = attach.querySelector("[data-rv-photo-input]")?.closest(".rv-tool");
    tool?.classList.toggle("is-full", n >= 4);
    const input = attach.querySelector("[data-rv-photo-input]");
    if (input) input.disabled = n >= 4;
  }

  async function upload(attach, file) {
    const status = attach.querySelector("[data-rv-attach-status]");
    const holder = attach.querySelector("[data-rv-photos]");
    if (holder.querySelectorAll(".rv-thumb").length >= 4) return say(status, t("Up to 4 photos."), true);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return say(status, t("{file} isn't a JPEG, PNG or WebP photo.", { file: file.name }), true);
    if (file.size > 5 * 1024 * 1024) return say(status, t("{file} is over 5 MB.", { file: file.name }), true);
    const thumb = document.createElement("span");
    thumb.className = "rv-thumb is-uploading";
    const img = document.createElement("img");
    img.alt = "";
    img.src = URL.createObjectURL(file);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "rv-thumb-x";
    x.dataset.rvUnphoto = "";
    x.setAttribute("aria-label", t("Remove photo"));
    x.textContent = "×";
    thumb.append(img, x);
    holder.append(thumb);
    updatePhotoTool(attach);
    say(status, t("Uploading…"));
    try {
      const res = await post("/reviews/photos", file, { headers: { "content-type": file.type } });
      const keep = document.createElement("input");
      keep.type = "hidden";
      keep.name = "photo";
      keep.value = res.id;
      thumb.append(keep);
      thumb.classList.remove("is-uploading");
      say(status, "");
    } catch (err) {
      thumb.remove();
      updatePhotoTool(attach);
      say(status, err.message, true);
    }
  }

  /* ---------- linking other recipes ---------- */

  function toggleLinkPicker(attach) {
    const pick = attach.querySelector("[data-rv-linkpick]");
    pick.hidden = !pick.hidden;
    if (!pick.hidden) pick.querySelector("input").focus();
  }

  let searchTimer = 0;
  function searchLinks(attach) {
    clearTimeout(searchTimer);
    const q = attach.querySelector("[data-rv-link-q]").value.trim();
    const out = attach.querySelector("[data-rv-link-results]");
    if (q.length < 2) return out.replaceChildren();
    searchTimer = setTimeout(async () => {
      const res = await fetch(`${base}/link-search?q=${encodeURIComponent(q)}`, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      const { results } = await res.json();
      const chosen = new Set([...attach.querySelectorAll("input[name=link]")].map((i) => i.value));
      out.replaceChildren(
        ...(results.length
          ? results.map((r, i) => {
              const li = document.createElement("li");
              li.setAttribute("role", "option");
              li.tabIndex = -1;
              li.dataset.id = r.id;
              li.dataset.title = r.title;
              li.className = chosen.has(String(r.id)) ? "is-chosen" : "";
              if (i === 0) li.setAttribute("aria-selected", "true");
              if (r.image) {
                const im = document.createElement("img");
                im.src = r.image;
                im.alt = "";
                li.append(im);
              }
              li.append(document.createTextNode(r.title));
              li.addEventListener("click", () => chooseLink(attach, li));
              return li;
            })
          : [Object.assign(document.createElement("li"), { className: "rv-linkpick-none", textContent: t("No recipes match.") })]),
      );
    }, 200);
  }

  function linkKeys(attach, e) {
    // Enter picks a recipe, never posts the review
    if (e.key === "Enter") e.preventDefault();
    if (e.key === "Escape") attach.querySelector("[data-rv-linkpick]").hidden = true;
    const items = [...attach.querySelectorAll("[data-rv-link-results] li[data-id]")];
    if (!items.length) return;
    const at = items.findIndex((li) => li.getAttribute("aria-selected") === "true");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      items.forEach((li) => li.removeAttribute("aria-selected"));
      next.setAttribute("aria-selected", "true");
      next.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (at >= 0) chooseLink(attach, items[at]);
    } else if (e.key === "Escape") {
      attach.querySelector("[data-rv-linkpick]").hidden = true;
    }
  }

  function chooseLink(attach, li) {
    const status = attach.querySelector("[data-rv-attach-status]");
    const holder = attach.querySelector("[data-rv-links]");
    if (holder.querySelector(`input[value="${li.dataset.id}"]`)) return say(status, t("Already linked."));
    if (holder.querySelectorAll(".rv-linkchip").length >= 3) return say(status, t("Link up to {n} recipes.", { n: 3 }), true);
    const chip = document.createElement("span");
    chip.className = "rv-linkchip";
    const name = document.createElement("span");
    name.textContent = li.dataset.title;
    const keep = Object.assign(document.createElement("input"), { type: "hidden", name: "link", value: li.dataset.id });
    const x = Object.assign(document.createElement("button"), { type: "button", textContent: "×" });
    x.dataset.rvUnlink = "";
    x.setAttribute("aria-label", t("Remove link to {title}", { title: li.dataset.title }));
    chip.append(name, keep, x);
    holder.append(chip);
    attach.querySelector("[data-rv-linkpick]").hidden = true;
    attach.querySelector("[data-rv-link-q]").value = "";
    attach.querySelector("[data-rv-link-results]").replaceChildren();
    say(status, "");
  }

  /* ---------- translating ---------- */

  let worker = null;
  const waiting = new Map();
  let next = 0;
  function translator() {
    if (worker) return worker;
    worker = new Worker("/assets/review-translate-worker.mjs", { type: "module" });
    worker.addEventListener("message", (e) => {
      const m = e.data;
      const job = waiting.get(m.id) ?? [...waiting.values()].find((j) => j.lang === m.lang);
      if (m.type === "download") {
        for (const j of waiting.values()) if (j.lang === m.lang) j.progress(m.loaded, m.total);
      } else if (m.type === "working") job?.working();
      else if (m.type === "result") {
        waiting.delete(m.id);
        job?.done(m.text);
      } else if (m.type === "error") {
        waiting.delete(m.id);
        job?.fail(m.message);
      }
    });
    worker.addEventListener("error", () => {
      for (const j of waiting.values()) j.fail(t("the translator couldn't start in this browser"));
      waiting.clear();
      worker = null;
    });
    return worker;
  }

  // the Translate buttons appear only where a worker can run
  function revealTranslate() {
    // photos and links are the script's whatever the browser; translating
    // needs a worker and WebAssembly
    section.querySelectorAll("[data-rv-attach]").forEach(enhanceAttach);
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") return;
    section.querySelectorAll("[data-rv-translate][hidden]").forEach((b) => (b.hidden = false));
  }
  revealTranslate();

  const cache = new Map();
  function toggleTranslate(btn) {
    const li = btn.closest("[data-rv]");
    const out = li.querySelector(":scope > .rv-main [data-rv-translated]");
    const original = li.querySelector(":scope > .rv-main [data-rv-text]");
    const label = btn.querySelector("span");
    if (!out.hidden) {
      out.hidden = true;
      original.classList.remove("is-translated");
      label.textContent = btn.dataset.label ?? label.textContent;
      return;
    }
    btn.dataset.label ??= label.textContent;
    const show = (text) => {
      out.replaceChildren();
      const tag = document.createElement("span");
      tag.className = "rv-mt-tag";
      tag.textContent = t("Machine translation · may be inaccurate");
      out.append(tag);
      for (const para of text.split(/\n{2,}/)) {
        const p = document.createElement("p");
        p.textContent = para;
        out.append(p);
      }
      out.hidden = false;
      original.classList.add("is-translated");
      label.textContent = t("Show original only");
    };
    const id = li.dataset.rv;
    if (cache.has(id)) return show(cache.get(id));
    btn.disabled = true;
    const lang = btn.dataset.lang;
    out.hidden = false;
    out.textContent = t("Starting the translator…");
    const job = ++next;
    waiting.set(job, {
      lang,
      progress: (a, b) => (out.textContent = t("Downloading the {language} translator: {pct}% of {mb} MB. This happens once per language.", { language: languageLabel(lang), pct: Math.round((a / b) * 100), mb: Math.round(b / 1e6) })),
      working: () => (out.textContent = t("Translating…")),
      done: (text) => {
        cache.set(id, text);
        btn.disabled = false;
        show(text);
      },
      fail: (msg) => {
        btn.disabled = false;
        out.textContent = t("Couldn't translate: {reason}.", { reason: msg });
      },
    });
    const text = [...original.querySelectorAll("p")].map((p) => p.innerText).join("\n\n");
    translator().postMessage({ id: job, lang, text });
  }
}
