import { EventEmitter } from "node:events";
import { all, one, run, transaction } from "./db.ts";
import { canSeeRecipe, canSeeSession, type Visibility } from "./visibility.ts";

// Live cook sessions: someone cooking a recipe one step at a time, seen by
// friends or the whole world on the globe. This module owns the data and the
// rules; src/routes/global.ts streams changes to watchers.
//
// Rules (each has a spec test in spec/live.test.ts):
// - one live session per person: going live again ends the previous one
// - while live, the step only moves forward (the cook can look back on their
//   own screen, but watchers never see a silent rewind)
// - only the cook can change their session; to anyone else it doesn't exist
// - a session ends when the cook finishes or ends it, after 3 hours, or after
//   45 minutes with no step change or heartbeat from the open cook page
//
// Privacy: location is city-level only. A picked city is stored as that
// city's centre; browser coordinates are rounded to one decimal place (about
// 11 km) on the server before they're stored, and labelled "near <city>".

export const MAX_HOURS = 3;
export const IDLE_MINUTES = 45;
export const QUESTION_MAX = 280;
export const ASK_COOLDOWN_SECONDS = 10;

// Usable inside any query on cook_sessions aliased `s`.
export const LIVE_SQL = `s.ended_at IS NULL AND s.started_at > datetime('now', '-${MAX_HOURS} hours') AND s.active_at > datetime('now', '-${IDLE_MINUTES} minutes')`;

export interface CookSession {
  id: number;
  user_id: number;
  username: string;
  display_name: string;
  recipe_id: number;
  recipe_title: string;
  recipe_author_id: number;
  recipe_visibility: Visibility;
  image_url: string | null;
  cuisine: string;
  recipe_servings: number;
  dietary_tags: string[];
  serves: number;
  visibility: Visibility;
  current_step: number;
  step_count: number;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  help_text: string | null;
  started_at: string;
  active_at: string;
  ended_at: string | null;
  end_reason: string | null;
  question_count: number;
  answered_count: number;
}

export interface Question {
  id: number;
  session_id: number;
  asker_id: number;
  asker_name: string;
  text: string;
  answer: string | null;
  asked_at: string;
  answered_at: string | null;
}

const SELECT = `SELECT s.*, u.username, u.display_name,
    r.title AS recipe_title, r.author_id AS recipe_author_id, r.visibility AS recipe_visibility,
    r.image_url, r.cuisine, r.servings AS recipe_servings, r.dietary_tags,
    (SELECT COUNT(*) FROM cook_questions q WHERE q.session_id = s.id) AS question_count,
    (SELECT COUNT(*) FROM cook_questions q WHERE q.session_id = s.id AND q.answer IS NOT NULL) AS answered_count
  FROM cook_sessions s JOIN users u ON u.id = s.user_id JOIN recipes r ON r.id = s.recipe_id`;

function hydrate(row: Record<string, unknown> | undefined): CookSession | undefined {
  if (!row) return undefined;
  return { ...(row as unknown as CookSession), dietary_tags: JSON.parse(String(row.dietary_tags ?? "[]")) };
}

function utcMs(sqlite: string): number {
  return Date.parse(sqlite.replace(" ", "T") + "Z");
}

// The same test as LIVE_SQL, for a row already in hand.
export function isLive(s: Pick<CookSession, "ended_at" | "started_at" | "active_at">, now = Date.now()): boolean {
  return (
    s.ended_at === null &&
    now - utcMs(s.started_at) < MAX_HOURS * 3_600_000 &&
    now - utcMs(s.active_at) < IDLE_MINUTES * 60_000
  );
}

// Any session by id, live or not; callers decide what an ended one means.
export function getSession(id: number): CookSession | undefined {
  if (!Number.isSafeInteger(id) || id < 1) return undefined;
  return hydrate(one(`${SELECT} WHERE s.id = ?`, id));
}

// Every live session, newest first. Small by nature (people cook for an
// hour), and capped so a flood can't make the globe page heavy.
export function liveSessions(): CookSession[] {
  return all<Record<string, unknown>>(`${SELECT} WHERE ${LIVE_SQL} ORDER BY s.started_at DESC, s.id DESC LIMIT 500`).map(
    (r) => hydrate(r)!,
  );
}

export function openSessionFor(userId: number): CookSession | undefined {
  return hydrate(one(`${SELECT} WHERE s.user_id = ? AND ${LIVE_SQL}`, userId));
}

// A string that changes whenever anything a watcher sees changes, so a
// reconnecting page can say what it has and get only what's new.
export function sessionVersion(s: CookSession): string {
  return `${s.current_step}.${s.question_count}.${s.answered_count}.${s.help_text ? 1 : 0}`;
}

/* ---------------- pub/sub ---------------- */

export type LiveEventKind = "start" | "step" | "question" | "answer" | "help" | "end";

export interface LiveEvent {
  kind: LiveEventKind;
  sessionId: number;
  questionId?: number;
}

// In-process: one Fly machine serves everyone, so an EventEmitter is the
// whole message bus. Subscribers re-check visibility per watcher.
export const liveBus = new EventEmitter();
liveBus.setMaxListeners(0);

function publish(event: LiveEvent): void {
  liveBus.emit("event", event);
}

function logEvent(sessionId: number, kind: LiveEventKind, actorId: number | null, step: number | null, detail: string | null = null): void {
  run("INSERT INTO cook_events (session_id, kind, actor_id, step, detail) VALUES (?, ?, ?, ?, ?)", sessionId, kind, actorId, step, detail);
}

/* ---------------- places ---------------- */

export interface City {
  key: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lng: number;
}

const C = (region: string, name: string, country: string, lat: number, lng: number): City => ({
  key: name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, "-"),
  name,
  country,
  region,
  lat,
  lng,
});

// A short built-in list for people who'd rather not share their device
// location: picking a city pins you to its centre.
export const CITIES: City[] = [
  C("Oceania", "Sydney", "Australia", -33.87, 151.21),
  C("Oceania", "Melbourne", "Australia", -37.81, 144.96),
  C("Oceania", "Brisbane", "Australia", -27.47, 153.03),
  C("Oceania", "Perth", "Australia", -31.95, 115.86),
  C("Oceania", "Adelaide", "Australia", -34.93, 138.6),
  C("Oceania", "Canberra", "Australia", -35.28, 149.13),
  C("Oceania", "Hobart", "Australia", -42.88, 147.33),
  C("Oceania", "Darwin", "Australia", -12.46, 130.84),
  C("Oceania", "Auckland", "New Zealand", -36.85, 174.76),
  C("Oceania", "Wellington", "New Zealand", -41.29, 174.78),
  C("Oceania", "Christchurch", "New Zealand", -43.53, 172.64),
  C("Oceania", "Honolulu", "USA", 21.31, -157.86),
  C("Asia", "Singapore", "Singapore", 1.35, 103.82),
  C("Asia", "Kuala Lumpur", "Malaysia", 3.14, 101.69),
  C("Asia", "Jakarta", "Indonesia", -6.21, 106.85),
  C("Asia", "Bangkok", "Thailand", 13.75, 100.5),
  C("Asia", "Hanoi", "Vietnam", 21.03, 105.85),
  C("Asia", "Ho Chi Minh City", "Vietnam", 10.82, 106.63),
  C("Asia", "Manila", "Philippines", 14.6, 120.98),
  C("Asia", "Hong Kong", "China", 22.32, 114.17),
  C("Asia", "Taipei", "Taiwan", 25.03, 121.57),
  C("Asia", "Shanghai", "China", 31.23, 121.47),
  C("Asia", "Beijing", "China", 39.9, 116.4),
  C("Asia", "Seoul", "South Korea", 37.57, 126.98),
  C("Asia", "Tokyo", "Japan", 35.68, 139.69),
  C("Asia", "Osaka", "Japan", 34.69, 135.5),
  C("Asia", "Mumbai", "India", 19.08, 72.88),
  C("Asia", "Delhi", "India", 28.61, 77.21),
  C("Asia", "Bengaluru", "India", 12.97, 77.59),
  C("Asia", "Kolkata", "India", 22.57, 88.36),
  C("Asia", "Karachi", "Pakistan", 24.86, 67.0),
  C("Asia", "Dhaka", "Bangladesh", 23.81, 90.41),
  C("Asia", "Colombo", "Sri Lanka", 6.93, 79.86),
  C("Middle East & Africa", "Dubai", "UAE", 25.2, 55.27),
  C("Middle East & Africa", "Tel Aviv", "Israel", 32.08, 34.78),
  C("Middle East & Africa", "Amman", "Jordan", 31.95, 35.93),
  C("Middle East & Africa", "Beirut", "Lebanon", 33.89, 35.5),
  C("Middle East & Africa", "Istanbul", "Türkiye", 41.01, 28.98),
  C("Middle East & Africa", "Cairo", "Egypt", 30.04, 31.24),
  C("Middle East & Africa", "Casablanca", "Morocco", 33.57, -7.59),
  C("Middle East & Africa", "Lagos", "Nigeria", 6.52, 3.38),
  C("Middle East & Africa", "Accra", "Ghana", 5.6, -0.19),
  C("Middle East & Africa", "Addis Ababa", "Ethiopia", 9.03, 38.74),
  C("Middle East & Africa", "Nairobi", "Kenya", -1.29, 36.82),
  C("Middle East & Africa", "Johannesburg", "South Africa", -26.2, 28.05),
  C("Middle East & Africa", "Cape Town", "South Africa", -33.92, 18.42),
  C("Europe", "London", "UK", 51.51, -0.13),
  C("Europe", "Manchester", "UK", 53.48, -2.24),
  C("Europe", "Edinburgh", "UK", 55.95, -3.19),
  C("Europe", "Dublin", "Ireland", 53.35, -6.26),
  C("Europe", "Paris", "France", 48.86, 2.35),
  C("Europe", "Lyon", "France", 45.76, 4.84),
  C("Europe", "Amsterdam", "Netherlands", 52.37, 4.9),
  C("Europe", "Brussels", "Belgium", 50.85, 4.35),
  C("Europe", "Berlin", "Germany", 52.52, 13.4),
  C("Europe", "Munich", "Germany", 48.14, 11.58),
  C("Europe", "Zurich", "Switzerland", 47.38, 8.54),
  C("Europe", "Vienna", "Austria", 48.21, 16.37),
  C("Europe", "Prague", "Czechia", 50.08, 14.44),
  C("Europe", "Warsaw", "Poland", 52.23, 21.01),
  C("Europe", "Copenhagen", "Denmark", 55.68, 12.57),
  C("Europe", "Stockholm", "Sweden", 59.33, 18.07),
  C("Europe", "Oslo", "Norway", 59.91, 10.75),
  C("Europe", "Helsinki", "Finland", 60.17, 24.94),
  C("Europe", "Reykjavík", "Iceland", 64.15, -21.94),
  C("Europe", "Madrid", "Spain", 40.42, -3.7),
  C("Europe", "Barcelona", "Spain", 41.39, 2.17),
  C("Europe", "Lisbon", "Portugal", 38.72, -9.14),
  C("Europe", "Rome", "Italy", 41.9, 12.5),
  C("Europe", "Milan", "Italy", 45.46, 9.19),
  C("Europe", "Athens", "Greece", 37.98, 23.73),
  C("Americas", "New York", "USA", 40.71, -74.01),
  C("Americas", "Boston", "USA", 42.36, -71.06),
  C("Americas", "Chicago", "USA", 41.88, -87.63),
  C("Americas", "Austin", "USA", 30.27, -97.74),
  C("Americas", "Miami", "USA", 25.76, -80.19),
  C("Americas", "Los Angeles", "USA", 34.05, -118.24),
  C("Americas", "San Francisco", "USA", 37.77, -122.42),
  C("Americas", "Seattle", "USA", 47.61, -122.33),
  C("Americas", "Toronto", "Canada", 43.65, -79.38),
  C("Americas", "Montréal", "Canada", 45.5, -73.57),
  C("Americas", "Vancouver", "Canada", 49.28, -123.12),
  C("Americas", "Mexico City", "Mexico", 19.43, -99.13),
  C("Americas", "Bogotá", "Colombia", 4.71, -74.07),
  C("Americas", "Lima", "Peru", -12.05, -77.04),
  C("Americas", "São Paulo", "Brazil", -23.55, -46.63),
  C("Americas", "Rio de Janeiro", "Brazil", -22.91, -43.17),
  C("Americas", "Santiago", "Chile", -33.45, -70.67),
  C("Americas", "Buenos Aires", "Argentina", -34.6, -58.38),
];

export const CITY_BY_KEY = new Map(CITIES.map((c) => [c.key, c]));

// One decimal place of a degree is about 11 km: a suburb, never a street.
export function roundCoord(x: number): number {
  return Math.round(x * 10) / 10;
}

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The closest listed city within 250 km, to label a device location.
export function nearestCity(lat: number, lng: number): City | undefined {
  let best: City | undefined;
  let bestKm = 250;
  for (const c of CITIES) {
    const km = kmBetween(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return best;
}

export type Place = { city: string; country: string; lat: number | null; lng: number | null };

// Where the cook appears, from the go-live form: a listed city, rounded
// device coordinates, or nowhere on the map (still listed).
export function placeFromForm(form: URLSearchParams): Place | null {
  const where = form.get("where") ?? "city";
  if (where === "none") return { city: "", country: "", lat: null, lng: null };
  if (where === "near") {
    const lat = Number(form.get("lat"));
    const lng = Number(form.get("lng"));
    const given = form.get("lat") && form.get("lng");
    if (!given || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const rLat = roundCoord(lat);
    const rLng = roundCoord(lng);
    const near = nearestCity(rLat, rLng);
    return { city: near ? `near ${near.name}` : "", country: near?.country ?? "", lat: rLat, lng: rLng };
  }
  const city = CITY_BY_KEY.get(form.get("city") ?? "");
  return city ? { city: city.name, country: city.country, lat: city.lat, lng: city.lng } : null;
}

/* ---------------- the cook's actions ---------------- */

export interface StartInput {
  recipe: { id: number; author_id: number; visibility: Visibility };
  stepCount: number;
  serves: number;
  visibility: Visibility;
  place: Place;
}

// A session can never be seen more widely than its recipe: a public session
// of a private recipe would leak the recipe. canSeeSession checks the recipe
// for every viewer too; this just keeps the stored setting honest.
export function clampVisibility(wanted: Visibility, recipeVisibility: Visibility): Visibility {
  const rank = { private: 0, friends: 1, public: 2 } as const;
  return rank[wanted] <= rank[recipeVisibility] ? wanted : recipeVisibility;
}

export function startSession(userId: number, input: StartInput): { id: number; replaced: number[]; visibility: Visibility } {
  const visibility = clampVisibility(input.visibility, input.recipe.visibility);
  const { id, replaced } = transaction(() => {
    const open = all<{ id: number; current_step: number }>(
      "SELECT id, current_step FROM cook_sessions WHERE user_id = ? AND ended_at IS NULL",
      userId,
    );
    for (const o of open) {
      run("UPDATE cook_sessions SET ended_at = datetime('now'), end_reason = 'replaced' WHERE id = ?", o.id);
      logEvent(o.id, "end", userId, o.current_step, "replaced");
    }
    const { id } = run(
      `INSERT INTO cook_sessions (user_id, recipe_id, serves, visibility, step_count, city, country, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      input.recipe.id,
      input.serves,
      visibility,
      input.stepCount,
      input.place.city,
      input.place.country,
      input.place.lat,
      input.place.lng,
    );
    logEvent(id, "start", userId, 1, visibility);
    return { id, replaced: open.map((o) => o.id) };
  });
  for (const old of replaced) publish({ kind: "end", sessionId: old });
  publish({ kind: "start", sessionId: id });
  return { id, replaced, visibility };
}

// The session if `userId` is its cook and it's still live. Anyone else gets
// "not-found", whether it exists or not.
function ownLive(sessionId: number, userId: number | null): { session?: CookSession; problem?: "not-found" | "ended" } {
  const s = getSession(sessionId);
  if (!s || userId === null || s.user_id !== userId) return { problem: "not-found" };
  if (!isLive(s)) return { session: s, problem: "ended" };
  return { session: s };
}

export type StepResult =
  | { ok: true; step: number }
  | { ok: false; problem: "not-found" | "ended" | "backwards" | "out-of-range"; step?: number };

export function advanceStep(sessionId: number, userId: number | null, step: number): StepResult {
  const { session, problem } = ownLive(sessionId, userId);
  if (problem) return { ok: false, problem, step: session?.current_step };
  const s = session!;
  if (!Number.isInteger(step) || step < 1 || step > s.step_count) return { ok: false, problem: "out-of-range", step: s.current_step };
  if (step <= s.current_step) return { ok: false, problem: "backwards", step: s.current_step };
  // the WHERE repeats the forward-only rule, so two racing requests can't
  // move it back either
  const changed = run(
    "UPDATE cook_sessions SET current_step = ?, active_at = datetime('now') WHERE id = ? AND current_step < ? AND ended_at IS NULL",
    step,
    s.id,
    step,
  ).changes;
  if (!changed) return { ok: false, problem: "backwards", step: getSession(s.id)?.current_step };
  logEvent(s.id, "step", userId, step);
  publish({ kind: "step", sessionId: s.id });
  return { ok: true, step };
}

// The open cook page checks in now and then, so a long simmer isn't mistaken
// for someone who wandered off.
export function heartbeat(sessionId: number, userId: number | null): boolean {
  const { problem } = ownLive(sessionId, userId);
  if (problem) return false;
  run("UPDATE cook_sessions SET active_at = datetime('now') WHERE id = ?", sessionId);
  return true;
}

export function endSession(sessionId: number, userId: number | null, reason: "finished" | "ended"): boolean {
  const s = getSession(sessionId);
  if (!s || userId === null || s.user_id !== userId) return false;
  if (s.ended_at !== null) return true;
  run("UPDATE cook_sessions SET ended_at = datetime('now'), end_reason = ? WHERE id = ? AND ended_at IS NULL", reason, s.id);
  logEvent(s.id, "end", userId, s.current_step, reason);
  publish({ kind: "end", sessionId: s.id });
  return true;
}

export function setHelp(sessionId: number, userId: number | null, text: string): { ok: boolean; problem?: string } {
  const { problem } = ownLive(sessionId, userId);
  if (problem) return { ok: false, problem };
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length > QUESTION_MAX) return { ok: false, problem: "too-long" };
  run("UPDATE cook_sessions SET help_text = ?, active_at = datetime('now') WHERE id = ?", clean || null, sessionId);
  logEvent(sessionId, "help", userId, null, clean || null);
  publish({ kind: "help", sessionId });
  return { ok: true };
}

// Closes sessions that have run out of time, so the event log says so and
// open pages hear about it. Reads never depend on this having run.
export function sweepExpired(): number {
  const stale = all<{ id: number; user_id: number; current_step: number }>(
    `SELECT s.id, s.user_id, s.current_step FROM cook_sessions s WHERE s.ended_at IS NULL AND NOT (${LIVE_SQL})`,
  );
  for (const s of stale) {
    run("UPDATE cook_sessions SET ended_at = datetime('now'), end_reason = 'expired' WHERE id = ? AND ended_at IS NULL", s.id);
    logEvent(s.id, "end", null, s.current_step, "expired");
    publish({ kind: "end", sessionId: s.id });
  }
  return stale.length;
}

/* ---------------- questions ---------------- */

export function questionsFor(sessionId: number): Question[] {
  return all<Question>(
    `SELECT q.*, u.display_name AS asker_name FROM cook_questions q JOIN users u ON u.id = q.asker_id
     WHERE q.session_id = ? ORDER BY q.id`,
    sessionId,
  );
}

export function getQuestion(id: number): Question | undefined {
  return one<Question>(
    "SELECT q.*, u.display_name AS asker_name FROM cook_questions q JOIN users u ON u.id = q.asker_id WHERE q.id = ?",
    id,
  );
}

export type AskResult =
  | { ok: true; question: Question }
  | { ok: false; problem: "not-found" | "ended" | "own" | "empty" | "too-long" | "too-soon" };

// Anyone signed in who can see a live session may ask its cook something.
export function askQuestion(sessionId: number, askerId: number, text: string): AskResult {
  const s = getSession(sessionId);
  if (!s || !canSeeSession(askerId, s)) return { ok: false, problem: "not-found" };
  if (!isLive(s)) return { ok: false, problem: "ended" };
  if (s.user_id === askerId) return { ok: false, problem: "own" };
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return { ok: false, problem: "empty" };
  if (clean.length > QUESTION_MAX) return { ok: false, problem: "too-long" };
  const recent = one(
    `SELECT 1 FROM cook_questions WHERE asker_id = ? AND asked_at > datetime('now', '-${ASK_COOLDOWN_SECONDS} seconds')`,
    askerId,
  );
  if (recent) return { ok: false, problem: "too-soon" };
  const { id } = run("INSERT INTO cook_questions (session_id, asker_id, text) VALUES (?, ?, ?)", s.id, askerId, clean);
  logEvent(s.id, "question", askerId, s.current_step, String(id));
  publish({ kind: "question", sessionId: s.id, questionId: id });
  return { ok: true, question: getQuestion(id)! };
}

export type AnswerResult = { ok: true; question: Question } | { ok: false; problem: "not-found" | "ended" | "empty" | "too-long" };

export function answerQuestion(sessionId: number, userId: number | null, questionId: number, text: string): AnswerResult {
  const { problem } = ownLive(sessionId, userId);
  if (problem) return { ok: false, problem };
  const q = getQuestion(questionId);
  if (!q || q.session_id !== sessionId) return { ok: false, problem: "not-found" };
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return { ok: false, problem: "empty" };
  if (clean.length > QUESTION_MAX) return { ok: false, problem: "too-long" };
  run("UPDATE cook_questions SET answer = ?, answered_at = datetime('now') WHERE id = ?", clean, q.id);
  run("UPDATE cook_sessions SET active_at = datetime('now') WHERE id = ?", sessionId);
  logEvent(sessionId, "answer", userId, null, String(q.id));
  publish({ kind: "answer", sessionId, questionId: q.id });
  return { ok: true, question: getQuestion(q.id)! };
}

/* ---------------- summaries for other pages ---------------- */

// Live sessions a viewer may see: their own first, then friends', then
// everyone else's, newest first within each.
export function visibleLiveSessions(viewerId: number | null, filter: (s: CookSession) => boolean): CookSession[] {
  const rank = (s: CookSession) => (s.user_id === viewerId ? 0 : 1);
  return liveSessions()
    .filter(filter)
    .sort((a, b) => rank(a) - rank(b));
}

// The public live count per recipe title, for "3 cooking now" on recipe
// tiles. Only sessions anyone may see are counted.
export function publicLiveCounts(titles: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!titles.length) return out;
  const wanted = new Map(titles.map((t) => [t.toLowerCase(), t]));
  for (const s of liveSessions()) {
    if (s.visibility !== "public" || !canSeeRecipe(null, { author_id: s.recipe_author_id, visibility: s.recipe_visibility })) continue;
    const t = wanted.get(s.recipe_title.toLowerCase());
    if (t) out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}

// sweep every five minutes; unref'd so it never holds the process open
setInterval(() => {
  try {
    sweepExpired();
  } catch (err) {
    console.error(err);
  }
}, 5 * 60_000).unref();
