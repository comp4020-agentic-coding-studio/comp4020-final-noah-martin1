import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { periodAt } from "../src/suggest.ts";
import { type Client, createRecipe, localToday, registered } from "./helpers.ts";

// With nothing planned, the home page suggests something to cook rather
// than saying "nothing planned": from the kitchen when there's food in it
// (soonest-expiring first), otherwise for the meal the local time calls for.

function doc(markup: string): Document {
  return new JSDOM(markup).window.document;
}

// A time zone where it's currently the given local hour, so the spec
// doesn't depend on when it runs.
// Etc/GMT±N zones cover every whole-hour offset from −12 to +14 (their sign
// is inverted: Etc/GMT-10 is UTC+10).
function zoneAtHour(hour: number): string {
  for (let offset = -12; offset <= 14; offset++) {
    const z = offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
    const h = Number(new Intl.DateTimeFormat("en-AU", { timeZone: z, hour: "numeric", hourCycle: "h23" }).format(new Date()));
    if (h === hour) return z;
  }
  throw new Error(`no zone at hour ${hour}`);
}

async function homeAt(client: Client, hour: number): Promise<Document> {
  client.setCookie("tz", zoneAtHour(hour));
  return doc(await (await client.get("/")).text());
}

describe("what to cook now", () => {
  it("maps local hours to meals", () => {
    expect([6, 10, 11, 14, 15, 20, 21, 2].map(periodAt)).toEqual(["breakfast", "breakfast", "lunch", "lunch", "dinner", "dinner", "late", "late"]);
  });

  it("an empty calendar and empty kitchen suggest a recipe for the time of day, and invite filling the kitchen", async () => {
    const { client } = await registered();
    for (const [hour, period] of [[8, "breakfast"], [12, "lunch"], [18, "dinner"], [23, "late"]] as const) {
      const d = await homeAt(client, hour);
      const card = d.querySelector<HTMLElement>("[data-suggest]");
      expect(card, `${period} card`).not.toBeNull();
      expect(card!.dataset.period).toBe(period);
      expect(d.body.textContent).not.toContain("Nothing planned yet");
      // view, cook, or add to the calendar
      expect(card!.querySelector(`a[href="/recipes/${card!.dataset.suggest}"]`)).not.toBeNull();
      expect(card!.querySelector(`a[href="/recipes/${card!.dataset.suggest}/cook"]`)).not.toBeNull();
      expect(card!.querySelector('form[action="/calendar"] input[name="recipe_id"]')?.getAttribute("value")).toBe(card!.dataset.suggest);
      expect(card!.querySelector('a[href="/pantry#add"]')).not.toBeNull();
    }
  });

  it("a breakfast suggestion is a breakfast recipe", async () => {
    const { client } = await registered();
    const id = (await homeAt(client, 8)).querySelector<HTMLElement>("[data-suggest]")!.dataset.suggest;
    const recipe = await (await client.get(`/recipes/${id}`)).text();
    expect(recipe).toBeTruthy();
    // the browse page filtered to breakfast lists it
    const breakfasts = await (await client.get("/recipes?course=breakfast")).text();
    expect(breakfasts).toContain(`href="/recipes/${id}"`);
  });

  it("with food in the kitchen, it suggests a recipe that uses it, soonest-expiring first, naming what's missing", async () => {
    const { client } = await registered();
    await client.post("/pantry", { name: "eggs", quantity: "6", unit: "", expiry_date: localToday(1), price: "" });
    await client.post("/pantry", { name: "rice", quantity: "1", unit: "kg", expiry_date: localToday(200), price: "" });
    const d = await homeAt(client, 18);
    const card = d.querySelector("[data-suggest]")!;
    expect(card.textContent).toMatch(/You have [^·]*eggs/);
    expect(card.textContent).toMatch(/before it goes off|you already have/i);
    expect(card.textContent).toMatch(/you'd need|nothing else needed/);
    expect(card.querySelector('a[href="/pantry#add"]')).toBeNull();
  });

  it("ignores expired food when choosing", async () => {
    const { client } = await registered();
    await client.post("/pantry", { name: "chicken thigh", quantity: "500", unit: "g", expiry_date: localToday(-3), price: "" });
    const card = (await homeAt(client, 18)).querySelector("[data-suggest]")!;
    expect(card.textContent).not.toMatch(/You have[^·]*chicken/);
  });

  it("is replaced by the planned meal once one exists, and 'another idea' changes the pick", async () => {
    const { client } = await registered();
    const first = (await homeAt(client, 18)).querySelector<HTMLElement>("[data-suggest]")!.dataset.suggest;
    const other = doc(await (await client.get(`/?skip=${first}`)).text());
    expect(other.querySelector<HTMLElement>("[data-suggest]")!.dataset.suggest).not.toBe(first);
    const id = await createRecipe(client, "Planned tonight", "private");
    await client.post("/calendar", { recipe_id: String(id), date: localToday(), meal: "dinner" });
    const home = await homeAt(client, 18);
    expect(home.querySelector("[data-suggest]")).toBeNull();
    expect(home.body.textContent).toContain("Planned tonight");
  });
});
