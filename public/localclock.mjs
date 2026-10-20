// A cook's local time on the globe page, from their zone's offset in minutes
// (the server sends it; src/localtime.ts has the same rules), so the clocks
// keep ticking without asking the server again.

const MEAL_LABEL = {
  breakfast: "breakfast",
  lunch: "lunch",
  afternoon: "afternoon snack",
  dinner: "dinner",
  late: "late supper",
  night: "middle of the night",
};

function mealtime(hour) {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 15 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "dinner";
  if (hour >= 22 || hour < 1) return "late";
  return "night";
}

// { time: "7:42 pm", meal: "dinner", label: "dinner" } for a UTC offset
export function localAt(offset, now = new Date()) {
  const minutes = (((now.getUTCHours() * 60 + now.getUTCMinutes() + offset) % 1440) + 1440) % 1440;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const meal = mealtime(h);
  return { time: `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`, meal, label: MEAL_LABEL[meal] };
}

// Bring every server-rendered clock (span.gl-local[data-local]) up to date.
export function tickClocks(scope = document) {
  scope.querySelectorAll(".gl-local[data-local]").forEach((el) => {
    const offset = Number(el.dataset.local);
    if (!Number.isFinite(offset)) return;
    const l = localAt(offset);
    const time = el.querySelector("time");
    if (time && time.textContent !== l.time) time.textContent = l.time;
    el.className = el.className.replace(/\bgl-local-\w+/, `gl-local-${l.meal}`);
    const label = el.hasAttribute("data-meal") ? el.querySelector("span") : null;
    if (label && label.textContent !== l.label) label.textContent = l.label;
  });
}
