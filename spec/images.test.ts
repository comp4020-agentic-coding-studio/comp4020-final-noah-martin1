import { describe, expect, it } from "vitest";
import { checkImage } from "../src/images.ts";
import { DISH_PNG, registered, uploadPhoto } from "./helpers.ts";

// Every recipe a person writes has a photo of the dish: the form, the
// no-JavaScript multipart post, edits, and the database itself all hold the
// line, so no path saves a recipe without one.

const fields = {
  title: "Photo test",
  description: "",
  servings: "2",
  visibility: "private",
  ing_name: ["eggs"],
  ing_qty: ["2"],
  ing_unit: [""],
  step_text: ["Boil the eggs."],
  step_minutes: ["8"],
};

function multipart(parts: Record<string, string | string[]>, file?: { bytes: Buffer; type: string; name?: string }) {
  const boundary = "----larderSpec" + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(parts)) {
    for (const one of Array.isArray(v) ? v : [v]) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${one}\r\n`));
  }
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${file.name ?? "dish.png"}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.bytes, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: new Uint8Array(Buffer.concat(chunks)), type: `multipart/form-data; boundary=${boundary}` };
}

describe("recipe photos", () => {
  it("refuses a recipe with no photo, keeping what was typed", async () => {
    const { client } = await registered();
    const res = await client.post("/recipes/new", fields);
    expect(res.status).toBe(422);
    const page = await res.text();
    expect(page).toContain("Add a photo of the dish");
    expect(page).toContain('value="Photo test"');
  });

  it("saves a recipe with an uploaded photo and serves that photo", async () => {
    const { client } = await registered();
    const ref = await uploadPhoto(client);
    const res = await client.post("/recipes/new", { ...fields, image_ref: ref });
    expect(res.finalUrl).toMatch(/^\/recipes\/\d+$/);
    expect(await res.text()).toContain(`src="${ref}"`);
    const img = await client.get(ref);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await img.arrayBuffer()).equals(DISH_PNG)).toBe(true);
  });

  it("accepts the photo as a file in the no-JavaScript multipart form", async () => {
    const { client } = await registered();
    const { body, type } = multipart(fields, { bytes: DISH_PNG, type: "image/png" });
    const res = await client.request("/recipes/new", { method: "POST", headers: { "content-type": type }, body });
    expect(res.finalUrl).toMatch(/^\/recipes\/\d+$/);
    expect(await res.text()).toMatch(/src="\/images\/\d+"/);
  });

  it("rejects files that aren't photos, whatever they claim to be", async () => {
    const { client } = await registered();
    const fake = Buffer.from("<svg onload=alert(1)></svg>");
    const upload = await client.request("/images", { method: "POST", headers: { "content-type": "image/png", accept: "application/json" }, body: new Uint8Array(fake) });
    expect(upload.status).toBe(422);
    const { body, type } = multipart(fields, { bytes: fake, type: "image/png", name: "dish.png" });
    const res = await client.request("/recipes/new", { method: "POST", headers: { "content-type": type }, body });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("isn&#39;t a JPEG, PNG or WebP");
  });

  it("won't attach someone else's upload or an arbitrary URL", async () => {
    const owner = await registered("owner");
    const thief = await registered("thief");
    const theirs = await uploadPhoto(owner.client);
    expect((await thief.client.post("/recipes/new", { ...fields, image_ref: theirs })).status).toBe(422);
    expect((await thief.client.post("/recipes/new", { ...fields, image_ref: "https://evil.example/x.png" })).status).toBe(422);
  });

  it("an edit keeps the photo unless a new one is chosen, and can't remove it", async () => {
    const { client } = await registered();
    const first = await uploadPhoto(client);
    const id = (await client.post("/recipes/new", { ...fields, image_ref: first })).finalUrl.split("/").pop();
    // no image fields at all: the photo stays
    await client.post(`/recipes/${id}/edit`, { ...fields, title: "Renamed" });
    let page = await (await client.get(`/recipes/${id}`)).text();
    expect(page).toContain("Renamed");
    expect(page).toContain(`src="${first}"`);
    // a blank reference doesn't remove it either
    await client.post(`/recipes/${id}/edit`, { ...fields, image_ref: "" });
    expect(await (await client.get(`/recipes/${id}`)).text()).toContain(`src="${first}"`);
    // a new upload replaces it
    const second = await uploadPhoto(client);
    await client.post(`/recipes/${id}/edit`, { ...fields, image_ref: second });
    page = await (await client.get(`/recipes/${id}`)).text();
    expect(page).toContain(`src="${second}"`);
  });

  it("checks photos by their bytes, size and dimensions", () => {
    expect(checkImage(DISH_PNG)).toMatchObject({ ok: true, mime: "image/png", width: 320, height: 240 });
    expect(checkImage(Buffer.alloc(0))).toMatchObject({ ok: false });
    expect(checkImage(Buffer.from("GIF89a....."))).toMatchObject({ ok: false });
    // a PNG header claiming 10 × 10 pixels is too small to be a dish photo
    const tiny = Buffer.from(DISH_PNG);
    tiny.writeUInt32BE(10, 16);
    tiny.writeUInt32BE(10, 20);
    expect(checkImage(tiny)).toMatchObject({ ok: false });
    expect(checkImage(Buffer.alloc(6 * 1024 * 1024, 0xff))).toMatchObject({ ok: false });
  });
});
