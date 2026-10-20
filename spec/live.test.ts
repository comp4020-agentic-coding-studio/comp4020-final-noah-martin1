import { describe, expect, it } from "vitest";
import { befriend, Client, createRecipe, registered } from "./helpers.ts";

// Live cooking (CLAUDE.md invariants: visibility through src/visibility.ts,
// hidden things answer 404, a live session never silently rewinds). Every
// session here is started by a fresh user and ended at the end of its test.

type Person = { client: Client; username: string };

function form(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

async function postJson(client: Client, path: string, fields: Record<string, string> = {}) {
  const res = await client.request(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: form(fields),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    // an HTML error page
  }
  return { status: res.status, body };
}

async function goLive(cook: Person, recipeId: number, visibility: "public" | "friends" | "private", city = "london") {
  const res = await postJson(cook.client, "/live/start", { recipe_id: String(recipeId), visibility, city, serves: "2" });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return Number(res.body.id);
}

async function sessionIds(client: Client): Promise<string[]> {
  const res = await client.get("/global/sessions.json");
  expect(res.status).toBe(200);
  const { sessions } = (await res.json()) as { sessions: { id: string }[] };
  return sessions.map((s) => s.id);
}

async function currentStep(cook: Person, id: number): Promise<number> {
  const res = await cook.client.request(`/global/${id}/card`, { headers: { accept: "application/json" } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { marker: { step: number } }).marker.step;
}

// Reads Server-Sent Events from an open stream until `match` passes or time
// runs out; returns every event seen.
async function readEvents(res: Response, ms: number, match: (e: { event: string; data: Record<string, unknown> }) => boolean) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const seen: { event: string; data: Record<string, unknown> }[] = [];
  let buffer = "";
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((r) => setTimeout(() => r(null), Math.max(1, deadline - Date.now()))),
      ]);
      if (!chunk || chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (!event || !data) continue;
        const e = { event, data: JSON.parse(data) };
        seen.push(e);
        if (match(e)) return seen;
      }
    }
    return seen;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

describe("live cooking: who sees a session", () => {
  it("a friends-only session reaches friends and nobody else", async () => {
    const cook = await registered("cook");
    const friend = await registered("friend");
    const stranger = await registered("stranger");
    await befriend(cook, friend);
    const title = `Live friends ${cook.username}`;
    const recipe = await createRecipe(cook.client, title, "public");
    const id = await goLive(cook, recipe, "friends");

    // the friend sees it on the globe, in its data, and at its own address
    expect(await (await friend.client.get("/global")).text()).toContain(`data-detail="${id}"`);
    expect(await sessionIds(friend.client)).toContain(String(id));
    expect((await friend.client.get(`/global/${id}`)).status).toBe(200);

    // a stranger and a signed-out visitor see nothing, and get a 404
    const guest = new Client();
    for (const viewer of [stranger.client, guest]) {
      const page = await (await viewer.get("/global")).text();
      expect(page).not.toContain(`data-detail="${id}"`);
      expect(page).not.toContain(title);
      expect(await sessionIds(viewer)).not.toContain(String(id));
      expect((await viewer.get(`/global/${id}`)).status).toBe(404);
      expect((await viewer.request(`/global/${id}/card`, { headers: { accept: "application/json" } })).status).toBe(404);
    }
    await postJson(cook.client, `/live/${id}/end`);
  });

  it("a public session is visible to anyone, signed in or not", async () => {
    const cook = await registered("cook");
    const title = `Live public ${cook.username}`;
    const recipe = await createRecipe(cook.client, title, "public");
    const id = await goLive(cook, recipe, "public", "tokyo");
    const guest = new Client();
    const page = await (await guest.get("/global")).text();
    expect(page).toContain(title);
    expect(await sessionIds(guest)).toContain(String(id));
    expect((await guest.get(`/global/${id}`)).status).toBe(200);
    await postJson(cook.client, `/live/${id}/end`);
  });

  it("a private session is visible only to its cook", async () => {
    const cook = await registered("cook");
    const friend = await registered("friend");
    await befriend(cook, friend);
    const recipe = await createRecipe(cook.client, `Live private ${cook.username}`, "public");
    const id = await goLive(cook, recipe, "private");
    expect(await sessionIds(cook.client)).toContain(String(id));
    expect(await sessionIds(friend.client)).not.toContain(String(id));
    expect((await friend.client.get(`/global/${id}`)).status).toBe(404);
    await postJson(cook.client, `/live/${id}/end`);
  });

  it("going live never shows a recipe more widely than the recipe itself", async () => {
    const cook = await registered("cook");
    const title = `Secret live ${cook.username}`;
    const recipe = await createRecipe(cook.client, title, "private");
    const id = await goLive(cook, recipe, "public");
    const guest = new Client();
    expect(await (await guest.get("/global")).text()).not.toContain(title);
    expect((await guest.get(`/global/${id}`)).status).toBe(404);
    await postJson(cook.client, `/live/${id}/end`);
  });

  it("the live stream only tells each viewer about sessions they may see", async () => {
    const cook = await registered("cook");
    const friend = await registered("friend");
    const stranger = await registered("stranger");
    await befriend(cook, friend);
    const recipe = await createRecipe(cook.client, `Streamed ${cook.username}`, "public");
    const friendStream = await friend.client.get("/global/stream");
    const strangerStream = await stranger.client.get("/global/stream");
    expect(friendStream.headers.get("content-type")).toContain("text/event-stream");

    const id = String(await goLive(cook, recipe, "friends"));
    const isMine = (e: { event: string; data: Record<string, unknown> }) => e.event === "upsert" && e.data.id === id;
    const [friendSaw, strangerSaw] = await Promise.all([readEvents(friendStream, 4000, isMine), readEvents(strangerStream, 1500, isMine)]);
    expect(friendSaw.some(isMine)).toBe(true);
    expect(strangerSaw.some((e) => e.data.id === id)).toBe(false);
    await postJson(cook.client, `/live/${id}/end`);
  });
});

describe("live cooking: the cook's session", () => {
  it("the step only moves forward while live", async () => {
    const cook = await registered("cook");
    const recipe = await createRecipe(cook.client, `Forward ${cook.username}`, "public");
    const id = await goLive(cook, recipe, "public");
    expect(await currentStep(cook, id)).toBe(1);

    expect((await postJson(cook.client, `/live/${id}/step`, { step: "2" })).status).toBe(200);
    expect(await currentStep(cook, id)).toBe(2);

    // going back is refused and the step stays where it was
    const back = await postJson(cook.client, `/live/${id}/step`, { step: "1" });
    expect(back.status).toBe(409);
    expect(back.body.step).toBe(2);
    expect(await currentStep(cook, id)).toBe(2);
    // so is a repeat, or a step past the end
    expect((await postJson(cook.client, `/live/${id}/step`, { step: "2" })).status).toBe(409);
    expect((await postJson(cook.client, `/live/${id}/step`, { step: "99" })).status).toBe(409);
    expect(await currentStep(cook, id)).toBe(2);
    await postJson(cook.client, `/live/${id}/end`);
  });

  it("only the cook can advance or end their session", async () => {
    const cook = await registered("cook");
    const friend = await registered("friend");
    await befriend(cook, friend);
    const recipe = await createRecipe(cook.client, `Hands off ${cook.username}`, "public");
    const id = await goLive(cook, recipe, "public");
    expect((await postJson(friend.client, `/live/${id}/step`, { step: "2" })).status).toBe(404);
    expect((await postJson(friend.client, `/live/${id}/end`)).status).toBe(404);
    expect(await currentStep(cook, id)).toBe(1);
    expect(await sessionIds(friend.client)).toContain(String(id));
    // signed out, it's a sign-in redirect and nothing changes
    expect((await new Client().post(`/live/${id}/step`, { step: "2" })).finalUrl).toMatch(/^\/login/);
    expect(await currentStep(cook, id)).toBe(1);
    await postJson(cook.client, `/live/${id}/end`);
  });

  it("going live again ends the previous session", async () => {
    const cook = await registered("cook");
    const first = await goLive(cook, await createRecipe(cook.client, `First ${cook.username}`, "public"), "public");
    const second = await goLive(cook, await createRecipe(cook.client, `Second ${cook.username}`, "public"), "public");
    const ids = await sessionIds(new Client());
    expect(ids).toContain(String(second));
    expect(ids).not.toContain(String(first));
    expect((await postJson(cook.client, `/live/${first}/step`, { step: "2" })).status).toBe(410);
    expect((await postJson(cook.client, `/live/${second}/step`, { step: "2" })).status).toBe(200);
    await postJson(cook.client, `/live/${second}/end`);
  });

  it("an ended session leaves the globe", async () => {
    const cook = await registered("cook");
    const id = await goLive(cook, await createRecipe(cook.client, `Done ${cook.username}`, "public"), "public");
    expect((await postJson(cook.client, `/live/${id}/end`, { reason: "finished" })).status).toBe(200);
    expect(await sessionIds(new Client())).not.toContain(String(id));
    expect((await postJson(cook.client, `/live/${id}/step`, { step: "2" })).status).toBe(410);
  });

  it("a city-level location is all that's ever stored", async () => {
    const cook = await registered("cook");
    const recipe = await createRecipe(cook.client, `Near ${cook.username}`, "public");
    const res = await postJson(cook.client, "/live/start", {
      recipe_id: String(recipe),
      visibility: "public",
      where: "near",
      lat: "-35.28123",
      lng: "149.12876",
    });
    expect(res.status).toBe(200);
    const data = (await (await new Client().get("/global/sessions.json")).json()) as { sessions: { id: string; lat: number; lng: number; city: string }[] };
    const mine = data.sessions.find((s) => s.id === String(res.body.id))!;
    expect(mine.lat).toBe(-35.3);
    expect(mine.lng).toBe(149.1);
    expect(mine.city).toBe("near Canberra");
    await postJson(cook.client, `/live/${res.body.id}/end`);
  });
});

describe("live cooking: questions", () => {
  it("a watcher asks, the cook answers, and both see the thread", async () => {
    const cook = await registered("cook");
    const watcher = await registered("watcher");
    const id = await goLive(cook, await createRecipe(cook.client, `Q&A ${cook.username}`, "public"), "public");

    const asked = await postJson(watcher.client, `/global/${id}/ask`, { text: "Can I use <b>butter</b> instead of oil?" });
    expect(asked.status).toBe(200);
    // one question per ten seconds each
    expect((await postJson(watcher.client, `/global/${id}/ask`, { text: "And salt?" })).status).toBe(429);
    expect((await postJson(watcher.client, `/global/${id}/ask`, { text: "x".repeat(281) })).status).toBe(422);

    const inbox = (await (await cook.client.get(`/live/${id}/questions`)).json()) as { questions: { id: number; text: string }[] };
    expect(inbox.questions).toHaveLength(1);
    const answered = await postJson(cook.client, `/global/${id}/answer`, { question: String(inbox.questions[0].id), text: "Yes, butter is lovely here." });
    expect(answered.status).toBe(200);

    const page = await (await watcher.client.get(`/global/${id}`)).text();
    expect(page).toContain("Yes, butter is lovely here.");
    // what people type is escaped, never markup
    expect(page).toContain("&lt;b&gt;butter&lt;/b&gt;");
    expect(page).not.toContain("<b>butter</b>");
    await postJson(cook.client, `/live/${id}/end`);
  });

  it("nobody can ask about a session they can't see, or answer for someone else", async () => {
    const cook = await registered("cook");
    const stranger = await registered("stranger");
    const id = await goLive(cook, await createRecipe(cook.client, `Closed ${cook.username}`, "public"), "friends");
    expect((await postJson(stranger.client, `/global/${id}/ask`, { text: "Hello?" })).status).toBe(404);
    expect((await postJson(stranger.client, `/global/${id}/answer`, { question: "1", text: "Hi" })).status).toBe(404);
    expect((await new Client().post(`/global/${id}/ask`, { text: "Hello?" })).finalUrl).toMatch(/^\/login/);
    await postJson(cook.client, `/live/${id}/end`);
  });
});

describe("live cooking: one page", () => {
  it("the old live pages point at the globe", async () => {
    const res = await fetch(new URL("/live", new Client().base), { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/global");
    const one = await fetch(new URL("/live/42", new Client().base), { redirect: "manual" });
    expect(one.headers.get("location")).toBe("/global#live-42");
  });

  it("every cook carries their local time, and demo cooks only cook in waking hours", async () => {
    type Marker = { id: string; city: string; offset: number | null };
    const at = async (iso: string) =>
      ((await (await new Client().get(`/global/sessions.json?at=${encodeURIComponent(iso)}`)).json()) as { sessions: Marker[] }).sessions.filter((s) => s.id.startsWith("demo-"));
    const hourThere = (iso: string, offset: number) => (((new Date(iso).getUTCHours() * 60 + new Date(iso).getUTCMinutes() + offset) % 1440) + 1440) % 1440 / 60;
    const seen = new Set<string>();
    // four moments a quarter of a day apart: someone's awake at each, and
    // nobody's shown cooking between 11 pm and 6 am their time
    for (const iso of ["2026-10-16T00:00:00Z", "2026-10-16T06:00:00Z", "2026-10-16T12:00:00Z", "2026-10-16T18:00:00Z"]) {
      const cooks = await at(iso);
      expect(cooks.length, iso).toBeGreaterThan(0);
      for (const c of cooks) {
        expect(typeof c.offset, `${c.city} has a time zone`).toBe("number");
        const h = hourThere(iso, c.offset!);
        expect(h >= 6 && h < 23, `${c.city} at ${iso} is ${h.toFixed(1)}h local`).toBe(true);
        seen.add(c.id);
      }
    }
    // and over a day the cast changes as the evening moves west
    const morning = new Set((await at("2026-10-16T00:00:00Z")).map((c) => c.id));
    const evening = new Set((await at("2026-10-16T12:00:00Z")).map((c) => c.id));
    expect([...morning].some((id) => !evening.has(id))).toBe(true);
    expect(seen.size).toBeGreaterThan(morning.size);
  });

  it("the globe page says each cook's local time and mealtime", async () => {
    const cook = await registered("cook");
    // London's zone, whatever the clock says: the page shows its offset and a meal
    const id = await goLive(cook, await createRecipe(cook.client, `Clock ${cook.username}`, "public"), "public", "london");
    const card = (await (await cook.client.request(`/global/${id}/card`, { headers: { accept: "application/json" } })).json()) as { marker: { offset: number }; detail: string };
    expect([0, 60]).toContain(card.marker.offset);
    expect(card.detail).toMatch(/class="gl-local gl-local-(breakfast|lunch|afternoon|dinner|late|night)" data-local="(0|60)" data-meal><time>\d{1,2}:\d{2} (am|pm)<\/time> there <span>/);
    const page = await (await new Client().get("/global")).text();
    expect(page).toContain("data-daylight");
    await postJson(cook.client, `/live/${id}/end`);
  });

  it("demo cooks stay under the preview banner, and real ones carry no caveat", async () => {
    const cook = await registered("cook");
    const id = await goLive(cook, await createRecipe(cook.client, `Real ${cook.username}`, "public"), "public");
    const page = await (await new Client().get("/global")).text();
    expect(page).toContain("Preview with sample data");
    expect(page).toContain('class="gl-tag gl-tag-demo"');
    const solo = await (await new Client().get(`/global/${id}`)).text();
    expect(solo).not.toContain("Preview with sample data");
    await postJson(cook.client, `/live/${id}/end`);
  });
});
