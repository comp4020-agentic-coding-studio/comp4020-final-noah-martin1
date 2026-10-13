// The live globe's side panel: filters, the session list, and the detail card
// that opens when a pan (or a list row) is chosen. Talks to globe.mjs with
// two DOM events: globe:select (from the globe) and globe:focus (to it).
const root = document.querySelector("[data-gl]");
const stage = document.querySelector("[data-globe]");
const data = JSON.parse(document.getElementById("globe-data")?.textContent ?? "[]");

if (root) {
  const byId = new Map(data.map((s) => [s.id, s]));
  const rows = [...root.querySelectorAll("[data-session]")];
  const details = root.querySelector("[data-gl-details]");
  const empty = root.querySelector("[data-gl-empty]");
  let open = null;

  function show(id, focus) {
    root.querySelectorAll("[data-detail]").forEach((d) => (d.hidden = Number(d.dataset.detail) !== id));
    rows.forEach((r) => r.classList.toggle("active", Number(r.dataset.session) === id));
    open = id;
    root.classList.toggle("detail-open", id !== null);
    if (id !== null) {
      const card = root.querySelector(`[data-detail="${id}"]`);
      card?.querySelector(".gl-detail-body")?.scrollTo({ top: 0 });
      if (focus) stage?.dispatchEvent(new CustomEvent("globe:focus", { detail: { id } }));
      history.replaceState(null, "", `#live-${id}`);
    } else {
      history.replaceState(null, "", location.pathname);
    }
  }

  rows.forEach((r) => r.addEventListener("click", () => show(Number(r.dataset.session), true)));
  root.addEventListener("globe:select", (e) => show(e.detail.id, false));
  details?.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("[data-close]")) show(null, false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open !== null) show(null, false);
  });

  // filters narrow the list and dim pans on the globe that don't match
  const chips = [...root.querySelectorAll("[data-filter]")];
  const cuisine = root.querySelector("[data-cuisine]");
  let mode = "all";
  function apply() {
    const c = cuisine?.value ?? "";
    let shown = 0;
    rows.forEach((r) => {
      const s = byId.get(Number(r.dataset.session));
      const ok =
        (mode === "all" ||
          (mode === "help" && s.help) ||
          (mode === "vegetarian" && s.tags.includes("vegetarian")) ||
          (mode === "fridge" && s.total && s.have / s.total >= 0.5)) &&
        (!c || s.cuisine === c);
      r.parentElement.hidden = !ok;
      if (ok) shown++;
    });
    if (empty) empty.hidden = shown > 0;
    const visible = rows.filter((r) => !r.parentElement.hidden).map((r) => Number(r.dataset.session));
    stage?.dispatchEvent(new CustomEvent("globe:filter", { detail: { ids: mode === "all" && !c ? null : visible } }));
  }
  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      chips.forEach((x) => x.setAttribute("aria-pressed", String(x === chip)));
      mode = chip.dataset.filter;
      apply();
    }),
  );
  cuisine?.addEventListener("change", apply);

  // a shared link (#live-104) opens straight onto that session
  const fromHash = Number(location.hash.replace("#live-", ""));
  if (byId.has(fromHash)) setTimeout(() => show(fromHash, true), 600);
}
