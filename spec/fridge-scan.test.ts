import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { run } from "../src/db.ts";
import { type Detected, learnedNames, parseScan, rememberCorrection, resolveName } from "../src/fridge-scan.ts";
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

  it("uses what this person taught it before anything else", () => {
    const learned = new Map([["yoghurt", "kefir"]]);
    expect(resolveName(d("yoghurt"), known, learned)).toMatchObject({ name: "kefir", match: "alias" });
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
