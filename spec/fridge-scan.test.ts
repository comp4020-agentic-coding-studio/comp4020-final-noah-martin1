import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { run } from "../src/db.ts";
import { type Detected, learnedNames, mergeScans, parseScan, rememberCorrection, resolveName, tilesFor } from "../src/fridge-scan.ts";
import { registered } from "./helpers.ts";

const d = (name: string): Detected => ({ name, count: null, container: "", confidence: "medium" });

describe("parsing a vision model's reply", () => {
  it("reads a clean JSON reply", () => {
    const items = parseScan('{"items":[{"name":"Carrots","count":6,"container":"loose","confidence":"high"}]}');
    expect(items).toEqual([{ name: "carrots", count: 6, container: "loose", confidence: "high" }]);
  });

  it("survives prose, code fences and trailing commas", () => {
    const items = parseScan('Here you go:\n```json\n{"items":[{"name":"milk","count":1,},{"name":"eggs","count":"12"},]}\n```');
    expect(items.map((i) => [i.name, i.count])).toEqual([["milk", 1], ["eggs", 12]]);
  });

  it("salvages the complete items from a reply cut off mid-array", () => {
    const items = parseScan('{"items":[{"name":"apple","count":5},{"name":"pear","count":2},{"name":"lim');
    expect(items.map((i) => i.name)).toEqual(["apple", "pear"]);
  });

  it("drops packaging words and non-food, and never invents a count", () => {
    const items = parseScan('{"items":[{"name":"bottle"},{"name":"thermometer"},{"name":"food"},{"name":"salsa","count":-3},{"name":"grapes","count":"lots"}]}');
    expect(items.map((i) => [i.name, i.count])).toEqual([["salsa", null], ["grapes", null]]);
  });

  it("merges the same food listed twice, adding counts and keeping the surer label", () => {
    const items = parseScan('{"items":[{"name":"Apple","count":4,"confidence":"low"},{"name":"apple","count":3,"confidence":"high"}]}');
    expect(items).toEqual([{ name: "apple", count: 7, container: "", confidence: "high" }]);
  });

  it("strips the model's asides from names and defaults odd labels to medium", () => {
    const [item] = parseScan('{"items":[{"name":"Yoghurt (probably Greek)","confidence":"certain","container":"pot"}]}');
    expect(item).toEqual({ name: "yoghurt", count: null, container: "", confidence: "medium" });
  });

  it("returns nothing for a reply with no items", () => {
    expect(parseScan("")).toEqual([]);
    expect(parseScan("I can't see any food in this image.")).toEqual([]);
  });
});

describe("matching a detected name to the catalogue", () => {
  const catalogue = new Set(["tomato ketchup", "capsicum", "chickpeas", "carrot", "yoghurt", "eggs", "milk"]);
  const known = (n: string) => catalogue.has(n);

  it("prefers an exact catalogue name", () => {
    expect(resolveName(d("milk"), known)).toMatchObject({ name: "milk", match: "exact" });
  });

  it("maps American and label names to the Australian catalogue name", () => {
    expect(resolveName(d("ketchup"), known)).toMatchObject({ name: "tomato ketchup", match: "alias" });
    expect(resolveName(d("bell pepper"), known)).toMatchObject({ name: "capsicum", match: "alias" });
    expect(resolveName(d("yogurt"), known)).toMatchObject({ name: "yoghurt", match: "alias" });
  });

  it("matches plurals and singulars", () => {
    expect(resolveName(d("carrots"), known)).toMatchObject({ name: "carrot", match: "variant" });
    expect(resolveName(d("chickpea"), known)).toMatchObject({ name: "chickpeas" });
    expect(resolveName(d("egg"), known)).toMatchObject({ name: "eggs" });
  });

  it("marks an unknown food as new instead of forcing a near match", () => {
    expect(resolveName(d("kefir"), known)).toMatchObject({ name: "kefir", match: "new" });
    // "pasta sauce" is not passata and not ketchup
    expect(resolveName(d("pasta sauce"), known)).toMatchObject({ name: "pasta sauce", match: "new" });
  });

  // names from the real catalogue, including pairs a letter or two apart
  const real = ["mustard", "custard", "hot sauce", "soy sauce", "rice flour", "rye flour", "parmesan", "chilli powder", "cheddar cheese", "mozzarella", "worcestershire sauce", "lemon", "lemons"];
  const inReal = (n: string) => real.includes(n);

  it("matches the same name spelt differently before calling it new", () => {
    const near = (name: string) => resolveName(d(name), inReal, new Map(), real);
    expect(near("parmesean")).toMatchObject({ name: "parmesan", match: "variant" });
    expect(near("chili powder")).toMatchObject({ name: "chilli powder", match: "variant" });
    expect(near("cheese cheddar")).toMatchObject({ name: "cheddar cheese", match: "variant" });
    expect(near("mozarella")).toMatchObject({ name: "mozzarella", match: "variant" });
    expect(near("worchestershire sauce")).toMatchObject({ name: "worcestershire sauce", match: "variant" });
  });

  it("never merges different foods that are spelt alike", () => {
    const near = (name: string) => resolveName(d(name), inReal, new Map(), real);
    // "mustad" is a letter from mustard; custard starts differently
    expect(near("mustad")).toMatchObject({ name: "mustard" });
    // a different first letter is a different food, however close
    expect(near("bustard")).toMatchObject({ match: "new" });
    // one letter from both "rice flour" and "rich flour": ambiguous, so the
    // person decides
    expect(resolveName(d("ricx flour"), inReal, new Map(), [...real, "rich flour"])).toMatchObject({ match: "new" });
    // short names get no typo allowance
    expect(near("lime")).toMatchObject({ name: "lime", match: "new" });
    expect(near("fish sauce")).toMatchObject({ match: "new" });
  });

  it("uses what this person taught it before anything else", () => {
    const learned = new Map([["yoghurt", "kefir"]]);
    expect(resolveName(d("yoghurt"), known, learned)).toMatchObject({ name: "kefir", match: "alias" });
  });
});

describe("tiling a busy photo", () => {
  it("cuts a wide photo into overlapping bands that cover it edge to edge", () => {
    const tiles = tilesFor(1280, 960, 3);
    expect(tiles).toHaveLength(3);
    expect(tiles[0].x).toBe(0);
    expect(tiles.at(-1)!.x + tiles.at(-1)!.w).toBe(1280);
    for (const t of tiles) expect(t).toMatchObject({ y: 0, h: 960 });
    // neighbours overlap, so an item on a band edge is whole in one of them
    for (let i = 1; i < tiles.length; i++) expect(tiles[i].x).toBeLessThan(tiles[i - 1].x + tiles[i - 1].w);
  });

  it("cuts a tall photo across, and one band means the whole photo", () => {
    expect(tilesFor(960, 1280, 3).every((t) => t.x === 0 && t.w === 960)).toBe(true);
    expect(tilesFor(960, 1280, 1)).toEqual([{ x: 0, y: 0, w: 960, h: 1280 }]);
  });

  it("merges overlapping views without double-counting what both saw", () => {
    const whole = [{ name: "apple", count: 5, container: "", confidence: "medium" as const }];
    const band = [
      { name: "apple", count: 3, container: "", confidence: "high" as const },
      { name: "kiwi", count: null, container: "", confidence: "low" as const },
    ];
    expect(mergeScans([whole, band])).toEqual([
      { name: "apple", count: 5, container: "", confidence: "high" },
      { name: "kiwi", count: null, container: "", confidence: "low" },
    ]);
  });
});

// Learning runs on this file's own throwaway database (spec/unit-db.ts).
describe("learning from a person's corrections", () => {
  const user = (name: string) => run("INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, 'x')", name, name).id;
  const known = () => false;

  it("a rename is proposed on that person's next scan, and only theirs", () => {
    const a = user("learner_a");
    const b = user("learner_b");
    rememberCorrection(a, "Yoghurt", "Kefir");
    expect(resolveName(d("yoghurt"), known, learnedNames(a))).toMatchObject({ name: "kefir" });
    expect(resolveName(d("yoghurt"), known, learnedNames(b))).toMatchObject({ name: "yoghurt", match: "new" });
  });

  it("a later rename replaces an earlier one, and keeping the name teaches nothing", () => {
    const a = user("learner_c");
    rememberCorrection(a, "leftovers", "pumpkin soup");
    rememberCorrection(a, "leftovers", "lentil soup");
    rememberCorrection(a, "milk", "milk");
    expect([...learnedNames(a)]).toEqual([["leftovers", "lentil soup"]]);
  });
});

// The review-and-save half runs against the app over HTTP. It needs no
// vision model: the save route takes the same form the review page renders,
// so these hold in CI, where no model runs.
describe("saving a scan's review form", () => {
  const scanned = (rows: Record<string, string>[], keep: number[]) => {
    const f: Record<string, string | string[]> = { rows: String(rows.length), keep: keep.map(String) };
    rows.forEach((r, i) => {
      for (const [k, v] of Object.entries(r)) f[`${k}_${i}`] = v;
    });
    return f;
  };

  it("the fridge links to the scan page, which explains itself with or without a model", async () => {
    const { client } = await registered();
    const fridge = new JSDOM(await (await client.get("/pantry")).text()).window.document;
    expect(fridge.querySelector("a[href='/pantry/scan']")).not.toBeNull();
    const res = await client.get("/pantry/scan");
    expect(res.status).toBe(200);
    const doc = new JSDOM(await res.text()).window.document;
    // either the upload form, or a plain explanation pointing at the add form
    const upload = doc.querySelector("form[action='/pantry/scan'][enctype='multipart/form-data'] input[type=file][name=photo]");
    const fallback = doc.querySelector("a[href='/pantry#add']");
    expect(upload ?? fallback).not.toBeNull();
  });

  it("adds only the ticked rows, with what the person typed", async () => {
    const { client } = await registered();
    const res = await client.post("/pantry/scan/save", scanned([
      { detected: "carrots", name: "carrot", quantity: "6", unit: "", expiry_date: "2030-01-01", price: "" },
      { detected: "leftovers", name: "leftovers", quantity: "1", unit: "", expiry_date: "", price: "" },
      { detected: "milk", name: "milk", quantity: "2", unit: "l", expiry_date: "2030-01-02", price: "3.10" },
    ], [0, 2]));
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe("/pantry");
    const scene = JSON.parse(new JSDOM(await res.text()).window.document.getElementById("kitchen-data")?.textContent ?? "[]") as { name: string }[];
    expect(scene.map((s) => s.name).sort()).toEqual(["carrot", "milk"]);
  });

  it("refuses the whole save if a ticked row is invalid, and keeps what was typed", async () => {
    const { client } = await registered();
    const res = await client.post("/pantry/scan/save", scanned([
      { detected: "apple", name: "apple", quantity: "5", unit: "", expiry_date: "", price: "" },
      { detected: "pear", name: "pear", quantity: "-2", unit: "", expiry_date: "", price: "" },
    ], [0, 1]));
    expect(res.status).toBe(422);
    const doc = new JSDOM(await res.text()).window.document;
    expect(doc.querySelector(".form-errors")?.textContent).toContain("pear");
    expect((doc.querySelector("input[name^='name_'][value='apple']") as HTMLInputElement | null)?.value).toBe("apple");
    expect(await (await client.get("/pantry")).text()).toContain("Your pantry is empty");
  });

  it("a refused save keeps every typed field and unticked row, and claims no model confidence", async () => {
    const { client } = await registered();
    const res = await client.post("/pantry/scan/save", scanned([
      { detected: "milk", name: "milk", quantity: "2", unit: "l", expiry_date: "2030-03-04", price: "3.10" },
      { detected: "leftovers", name: "leftovers", quantity: "", unit: "", expiry_date: "", price: "" },
      { detected: "pear", name: "pear", quantity: "-2", unit: "", expiry_date: "", price: "" },
    ], [0, 2]));
    expect(res.status).toBe(422);
    const doc = new JSDOM(await res.text()).window.document;
    const val = (n: string) => (doc.querySelector(`input[name='${n}']`) as HTMLInputElement | null)?.value;
    expect([val("name_0"), val("expiry_date_0"), val("price_0")]).toEqual(["milk", "2030-03-04", "3.10"]);
    // the unticked row is still there, still unticked
    expect(val("name_1")).toBe("leftovers");
    expect((doc.querySelector("input[name=keep][value='1']") as HTMLInputElement).checked).toBe(false);
    expect(doc.body.textContent).not.toMatch(/\bSure\b|spotted/);
  });

  it("the blank row for a missed item is ticked, so typing into it is enough to save it", async () => {
    const { client } = await registered();
    // a review page with no suggestions is just the blank row; render one
    // through a refused save of an empty form to read its markup
    const blank = await client.post("/pantry/scan/save", scanned([{ detected: "x", name: "", quantity: "", unit: "", expiry_date: "", price: "" }], [0]));
    const doc = new JSDOM(await blank.text()).window.document;
    const rows = doc.querySelectorAll(".scan-row");
    const extra = rows[rows.length - 1].querySelector("input[name=keep]") as HTMLInputElement;
    expect(extra.checked).toBe(true);
    const i = extra.value;
    const res = await client.post("/pantry/scan/save", { rows: String(Number(i) + 1), keep: [i], [`detected_${i}`]: "", [`name_${i}`]: "kiwi fruit", [`quantity_${i}`]: "4", [`unit_${i}`]: "", [`expiry_date_${i}`]: "", [`price_${i}`]: "" });
    expect(res.status).toBe(200);
    expect(await (await client.get("/pantry")).text()).toContain("kiwi fruit");
  });

  it("an empty extra row or nothing ticked saves nothing and says so", async () => {
    const { client } = await registered();
    const res = await client.post("/pantry/scan/save", scanned([
      { detected: "", name: "", quantity: "", unit: "", expiry_date: "", price: "" },
    ], [0]));
    expect(res.status).toBe(200);
    expect(await (await client.get("/pantry")).text()).toContain("Your pantry is empty");
  });

  it("refuses a non-image upload before any model is asked", async () => {
    const { client } = await registered();
    const body = new FormData();
    body.append("photo", new Blob([Buffer.from("not a photo")], { type: "image/jpeg" }), "fridge.jpg");
    const res = await client.request("/pantry/scan", { method: "POST", body });
    // 422 for a bad photo; 503 when this server has no model at all
    expect([422, 503]).toContain(res.status);
    const shown = new JSDOM(await res.text()).window.document.querySelector(".form-errors")?.textContent ?? "";
    expect(shown).toMatch(/isn't a JPEG, PNG or WebP photo|isn't set up/);
  });

  it("a tiny valid image is still refused as unreadable", async () => {
    const { client } = await registered();
    const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const body = new FormData();
    body.append("photo", new Blob([tiny], { type: "image/png" }), "fridge.png");
    const res = await client.request("/pantry/scan", { method: "POST", body });
    expect([422, 503]).toContain(res.status);
    const shown = new JSDOM(await res.text()).window.document.querySelector(".form-errors")?.textContent ?? "";
    expect(shown).toMatch(/too small|isn't set up/);
  });


  it("signed-out visitors are sent to sign in", async () => {
    const res = await fetch(new URL("/pantry/scan", (await registered()).client.base), { redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/login/);
  });
});
