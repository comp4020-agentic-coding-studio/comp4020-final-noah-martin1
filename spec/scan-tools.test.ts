import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { barcodeRow, lookupBarcode, validBarcode } from "../src/barcode.ts";
import { lineQuantity, packSize, parseReceipt, weighed } from "../src/receipt-scan.ts";
import { receiptResult } from "../src/scan-jobs.ts";
import { foodName, parseReceiptText, splitPrice } from "../src/receipt-text.ts";
import { registered } from "./helpers.ts";

describe("reading a receipt", () => {
  it("reads pack sizes from the printed line, including multipacks", () => {
    expect(packSize("COLES FF MILK 2L")).toEqual({ quantity: 2000, unit: "ml" });
    expect(packSize("WW CHEDDAR 500G")).toEqual({ quantity: 500, unit: "g" });
    expect(packSize("COKE 375ML X 10")).toEqual({ quantity: 3750, unit: "ml" });
    expect(packSize("6 X 1.25L")).toEqual({ quantity: 7500, unit: "ml" });
    expect(packSize("EGGS FREE RANGE 12PK")).toEqual({ quantity: 12, unit: "" });
    // a size word that isn't a size
    expect(packSize("LGE AVOCADO")).toBeNull();
    expect(packSize("CARROT LOOSE")).toBeNull();
  });

  // lines printed on the real receipts in testing/receipt-scan
  it("reads the sizes printed on real receipts", () => {
    // Woolworths "GM", and a count beside a weight is a 140 g pack of 16
    expect(packSize("*GOLDEN PIKELET BITES 16PK 140GM")).toEqual({ quantity: 140, unit: "g" });
    expect(packSize("*GOLDEN PIKELETS 8 PK200GM")).toEqual({ quantity: 200, unit: "g" });
    expect(packSize("MACRO ORGANC FRESH MILK LOW FAT 1L")).toEqual({ quantity: 1000, unit: "ml" });
    // Biedronka: size run straight into the name
    expect(packSize("ChlebPszen-Zyt550g")).toEqual({ quantity: 550, unit: "g" });
    // "6 X 0,22" is six at €0.22, not a size
    expect(packSize("6 X 0,22 ACQUA S.ANGELO")).toBeNull();
  });

  it("treats a weighed line's weight as what was bought", () => {
    expect(weighed("1.234 kg @ $3.90/kg")).toEqual({ grams: 1234 });
    expect(weighed("BANANA CAVENDISH 0.572 kg NET @ $2.50/kg")).toEqual({ grams: 572 });
    // a decimal comma, and "x E 2,79/kg" on an Italian receipt
    expect(weighed("MELE GRANNY SMITH 0,5484kg x E 2,79/kg")).toEqual({ grams: 548 });
    expect(weighed("BANANA CAVENDISH KG")).toEqual({ grams: null });
    expect(weighed("WW CHEDDAR 500G")).toBeNull();
  });

  it("drops non-food lines but counts a bag towards the printed total", () => {
    const r = parseReceipt(JSON.stringify({
      lines: [
        { text: "COLES FF MILK 2L", name: "milk", qty: 1, price: 3.1 },
        { text: "1.234 kg @ $3.90/kg", name: "banana", qty: 1, price: 4.81 },
        { text: "REUSABLE BAG", name: "bag", qty: 1, price: 0.25 },
        { text: "EGGS 12PK", name: "eggs", qty: 2, price: 13 },
        { text: "SUBTOTAL", name: "subtotal", price: 21.16 },
      ],
      total: 21.16,
    }));
    expect(r.lines.map((l) => l.name)).toEqual(["milk", "banana", "eggs"]);
    expect(r.other_cents).toBe(25);
    expect(r.check).toEqual({ sum_cents: 2116, matches: true });
    expect(r.lines.map(lineQuantity)).toEqual([{ quantity: "2000", unit: "ml" }, { quantity: "1234", unit: "g" }, { quantity: "24", unit: "" }]);
  });

  it("flags lines that don't add up to the total and marks every line a guess", () => {
    const r = parseReceipt('{"lines":[{"text":"MILK 2L","name":"milk","price":3.1},{"text":"BREAD","name":"bread","price":40}],"total":7.1}');
    expect(r.check).toEqual({ sum_cents: 4310, matches: false });
    const result = receiptResult(r, new Map(), 1000);
    expect(result.receipt).toMatchObject({ matches: false, total_cents: 710 });
    expect(result.rows.every((row) => row.confidence === "low")).toBe(true);
  });

  // lines the 2B model produced on the real Woolworths, Polish and Tesco receipts
  it("drops discount lines a model listed as items, but keeps an item whose text is a discount", () => {
    const r = parseReceipt(JSON.stringify({
      lines: [
        { text: "GOLDEN PANCAK OFFER", name: "pancake", qty: 6, price: 0 },
        { text: "Rabat", name: "rabat", qty: 1, price: 2.99 },
        { text: "REDUCED PRICE", name: "reduced price", qty: 1, price: 0.55 },
        // the item's name with the discount line's text: really bought
        { text: "REDUCED PRICE", name: "mld wht chdr", qty: 1, price: 1.45 },
        { text: "APPLE PINK LADY", name: "apple", qty: 0, price: 0.85 },
      ],
      total: 2.3,
    }));
    expect(r.lines.map((l) => [l.name, l.qty])).toEqual([["mld wht chdr", 1], ["apple", 1]]);
    expect(r.check).toEqual({ sum_cents: 230, matches: true });
  });

  // the 2B model's own reply to the Woolworths receipt, trimmed
  it("takes a negative discount line off the item above, and reads a kilo quantity as weight", () => {
    const r = parseReceipt(JSON.stringify({
      lines: [
        { text: "APPLE PINK LADY", name: "apple", qty: 0.217, price: 0.85 },
        { text: "BANANA CAVENDISH", name: "banana", qty: 0.572, price: 1.43 },
        { text: "*GOLDEN PIKELETS 8 PK 200GM", name: "pikelets", qty: 1, price: 3.99 },
        { text: "GOLDEN PANCAK OFFER", name: "pancake", qty: 6, price: -1.98 },
      ],
      total: 4.29,
    }));
    expect(r.lines.map((l) => [l.name, l.price_cents, lineQuantity(l)])).toEqual([
      ["apple", 85, { quantity: "217", unit: "g" }],
      ["banana", 143, { quantity: "572", unit: "g" }],
      ["pikelets", 201, { quantity: "200", unit: "g" }],
    ]);
    expect(r.check).toEqual({ sum_cents: 429, matches: true });
  });

  it("a discount bigger than the item above it, or with no item above, isn't applied", () => {
    const r = parseReceipt('{"lines":[{"name":"offer","price":-1},{"name":"milk","price":0.5},{"name":"saving","price":-2}],"total":0.5}');
    expect(r.lines.map((l) => [l.name, l.price_cents])).toEqual([["milk", 50]]);
  });

  it("won't check a total it can't read, or lines without prices", () => {
    expect(parseReceipt('{"lines":[{"name":"milk","price":3.1}],"total":null}').check).toBeNull();
    expect(parseReceipt('{"lines":[{"name":"milk","price":3.1},{"name":"bread"}],"total":3.1}').check).toBeNull();
  });

  it("combines the same food bought twice into one row, but never mixes units", () => {
    const result = receiptResult(parseReceipt(JSON.stringify({
      lines: [
        { text: "MILK PRO PORRIDGE AV", name: "oat milk", qty: 1, price: 1.65 },
        { text: "MILK PRO PORRIDGE AV", name: "oat milk", qty: 1, price: 1.65 },
        { text: "CHEDDAR 500G", name: "cheddar cheese", qty: 1, price: 6 },
        { text: "CHEDDAR SLICES X10", name: "cheddar cheese", qty: 1, price: 4 },
      ],
      total: 13.3,
    })), new Map(), 1000);
    expect(result.receipt?.matches).toBe(true);
    expect(result.rows.map((r) => [r.name, r.quantity, r.unit, r.price_cents])).toEqual([
      ["oat milk", "2", "", 330],
      ["cheddar cheese", "500", "g", 600],
      ["cheddar cheese", "10", "", 400],
    ]);
    expect(result.rows[0].source).toBe("MILK PRO PORRIDGE AV + MILK PRO PORRIDGE AV");
  });

  it("keeps the printed line as the row's source and its price", () => {
    const result = receiptResult(parseReceipt('{"lines":[{"text":"COLES FF MILK 2L","name":"Milk","qty":1,"price":3.10}],"total":3.10}'), new Map(), 2000);
    expect(result.rows[0]).toMatchObject({ name: "milk", quantity: "2000", unit: "ml", price_cents: 310, source: "COLES FF MILK 2L", confidence: "high" });
  });
});

// The receipt read in the browser: the text reader's printed lines (copied
// from its output on the real receipts in testing/receipt-scan) parsed by
// plain code, with no model naming anything.
describe("reading a receipt from its printed text", () => {
  const known = ["milk", "banana", "apple", "bacon", "peanut butter", "potato", "tuna", "olive oil", "blackberries", "sour cream", "cream cheese", "sweet potato", "beef", "pumpkin", "crab meat"];

  it("pairs weights, counts and discounts with their item, and finds the total", () => {
    const r = parseReceiptText([
      "WOOLWORTHS TAX INV0ICE-ABN 88 000 014 675",
      "*WW SANDWICH CLASSIC EGG & LETTUCE  6.00",
      "APPLE PINK LADY",
      "0.217 kg NET @  $3.90/kg  0.85",
      "MACRO ORGANC FRESH MILK LOW FAT 1L  2.20",
      "BANANA CAVENDISH",
      "0.572 kg NET @  $2.50/kg  1.43",
      "*GOLDEN PIKELET BITES 16PK 140GM  3.99",
      "*GOLDEN PIKELETS 8 PK200GM  3.99",
      "GOLDEN PANCAK OFFER  -1.98",
      "6  SUBTOTAL  $16.48",
    ], known);
    expect(r.lines.map((l) => [l.name, l.price_cents, lineQuantity(l)])).toEqual([
      // made with egg, not a dozen eggs
      ["sandwich", 600, { quantity: "1", unit: "" }],
      ["apple", 85, { quantity: "217", unit: "g" }],
      ["milk", 220, { quantity: "1000", unit: "ml" }],
      ["banana", 143, { quantity: "572", unit: "g" }],
      // a 140 g pack of 16; the offer comes off the pikelets above it
      ["golden pikelet bites", 399, { quantity: "140", unit: "g" }],
      ["golden pikelets", 201, { quantity: "200", unit: "g" }],
    ]);
    expect(r.total_cents).toBe(1648);
    expect(r.check).toEqual({ sum_cents: 1648, matches: true });
  });

  it("finds the food in words the printer ran together, and an ingredient made into something else isn't that ingredient", () => {
    const name = (t: string) => foodName(t, known).name;
    expect(name("BRITISHBACON200GRAM")).toBe("bacon");
    expect(name("MAYVERSPEANUT BUTTE375GRAM")).toBe("peanut butter");
    expect(name("%PRINGLES POTATO CHIP 53GRAM")).toBe("potato chips");
    expect(name("WW Beef Jerky Original 180g")).toBe("beef jerky");
    expect(name("La Zuppa Roasted Pumpkin Soup 540g")).toBe("pumpkin soup");
    // the food first, what it's in after
    expect(name("^JW Tuna Slice In 0live 0il 125g")).toBe("tuna");
    expect(name("Berry Blackberry125g P/P")).toBe("blackberries");
    // not "potato" from "pot", not "pea" from "peach"
    expect(name("TIRAMISU POT 2PACK")).not.toBe("potato");
    // nothing known: the printed words, without sizes or store names
    expect(name("COLES CRAB MEAT 170GRAM")).toBe("crab meat");
    expect(name("Grape Black 400g")).toBe("grape");
  });

  it("a shopping bag counts toward the total but isn't food; tea bags are food", () => {
    const r = parseReceiptText([
      "#Woolworths Paper Bag",
      "Qty  2@$0.25  each  0.50",
      "Live Well Cleanse Tea Bags 18pk  8.50",
      "22SUBTOTAL  $9.00",
    ], known);
    expect(r.lines.map((l) => l.name)).toEqual(["tea"]);
    expect(r.other_cents).toBe(50);
    expect(r.check).toEqual({ sum_cents: 900, matches: true });
  });

  it("a misread price is flagged by the total, not trusted", () => {
    // the printer's price column sat half a line high on this receipt, so
    // the bag's $2.50 was read beside the crackers
    const r = parseReceiptText([
      "Potato Sweet Purple  3.19",
      "0.462 kg NET @$6.90/kg  0.15",
      "Hwoolworths Reusable Bag",
      "#Arnotts Salada Wholemeal 250g  2.50",
      "8SUBTOTAL  $33.94",
      "TOTAL  $33.95",
    ], known);
    expect(r.total_cents).toBe(3395);
    expect(r.check?.matches).toBe(false);
    expect(receiptResult(r, new Map(), 1000).rows.every((row) => row.confidence === "low")).toBe(true);
  });

  it("reads European receipts' decimal commas, a Polish discount and a reduced price", () => {
    expect(splitPrice("ACQUA S.ANGELO NATUR 22,00% 1,32")).toEqual({ text: "ACQUA S.ANGELO NATUR 22,00%", price_cents: 132 });
    expect(splitPrice("Poledw kos 100g C 1 x4,99 4,99C").price_cents).toBe(499);
    const r = parseReceiptText(["Ser z.Swiat. 150g L 1 x3.29 3,290", "Poledw kos 100g C 1 x4,99 4,99C", "Rabat -2,00", "2,99C", "SUMA PLN 8,27"], known);
    expect(r.lines.map((l) => l.price_cents)).toEqual([329, 299]);
    const t = parseReceiptText(["6JAN DOUGHNTS", "REDUCED PRICE  0.55", "TUNA STEAKS  0.55", "TOTAL  1.10"], known);
    expect(t.lines.map((l) => [l.name, l.price_cents])).toEqual([[expect.stringMatching(/doughn/), 55], ["tuna", 55]]);
    expect(t.check?.matches).toBe(true);
  });

  // the reader's lines from a real Costco receipt (testing/receipt-scan)
  it("reads Costco's layout: the name on one line, its price on the next, instant savings as a trailing minus", () => {
    const r = parseReceiptText([
      "TAX INVOICE（$）",
      "P2 Member 99",
      "SOY SAUCE2L",
      "15795  1x  11.49  11.49Z",
      "TPDKIKK  SOY  SAUCE",
      "155735  1×  2.00  2.00-Z",
      "PORK SPARE  RIBS",
      "13211  1×  30.12  30.12Z",
      "DAWN DISH LIQ2.66L",
      "130425  1×  15.99  15.99A",
      "TPD-DAWN PLAT 2.66",
      "156039  1x  3.00  3.00-A",
      "POPCORNERS 24PK",
      "50064  2×  20.99  41.98A",
      "￥TOTAL(INCL GST）  94.58",
      "AMOUNT:$94.58",
    ], [...known, "soy sauce", "pork ribs"]);
    expect(r.lines.map((l) => [l.name, l.price_cents, l.qty])).toEqual([
      ["soy sauce", 949, 1],
      ["pork ribs", 3012, 1],
      // the "2.66" in a name with a price line under it is a size, not a price
      ["dawn dish liq", 1299, 1],
      ["popcorners", 4198, 2],
    ]);
    expect(r.lines[0].size).toEqual({ quantity: 2000, unit: "ml" });
    // the savings come off before the check, so it adds up
    expect(r.total_cents).toBe(9458);
    expect(r.check).toEqual({ sum_cents: 9458, matches: true });
  });

  it("stops at the total, so payment and change lines are never items", () => {
    const r = parseReceiptText(["MILK 2L  3.10", "TOTAL  $3.10", "Cash  $5.00", "Change  $1.90", "BANANA  1.00"], known);
    expect(r.lines.map((l) => l.name)).toEqual(["milk"]);
  });
});

describe("barcodes", () => {
  it("accepts only codes whose check digit is right", () => {
    expect(validBarcode("3017620422003")).toBe("3017620422003");
    expect(validBarcode("3017 6204 2200 3")).toBe("3017620422003");
    // one digit misread
    expect(validBarcode("3017620422004")).toBeNull();
    expect(validBarcode("036000291452")).toBe("036000291452");
    expect(validBarcode("96385074")).toBe("96385074");
    expect(validBarcode("12345")).toBeNull();
  });

  const fakeFetch = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("reads a found product's name and pack size", async () => {
    const p = await lookupBarcode("40000000000001", fakeFetch({ status: 1, product: { product_name: "Ferrero Nutella", brands: "Ferrero", product_quantity: "0.4", product_quantity_unit: "kg" } }));
    expect(p).toEqual({ code: "40000000000001", name: "Ferrero Nutella", brand: "Ferrero", quantity: 400, unit: "g" });
  });

  it("says plainly when a product isn't in the database", async () => {
    expect(await lookupBarcode("40000000000002", fakeFetch({ status: 0 }))).toBeNull();
    expect(await lookupBarcode("40000000000003", fakeFetch({}, 404))).toBeNull();
  });

  it("an unreachable database is an error the page can explain, not a missing product", async () => {
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(lookupBarcode("40000000000004", down)).rejects.toThrow(/didn't answer/);
  });

  it("a product becomes a review row with its pack size, brand stripped for matching", () => {
    const row = barcodeRow(1, { code: "1", name: "Ferrero Nutella", brand: "Ferrero", quantity: 400, unit: "g" });
    expect(row).toMatchObject({ detected: "nutella", quantity: "400", unit: "g", confidence: "high" });
    expect(row.source).toContain("barcode 1");
    // a brand that is the whole name ("Nutella" by "Nutella") keeps the name
    const same = barcodeRow(1, { code: "2", name: "Nutella", brand: "Nutella", quantity: null, unit: "" });
    expect(same).toMatchObject({ detected: "nutella", quantity: "1", source: "Nutella · barcode 2" });
  });
});

describe("scan pages and background jobs over HTTP", () => {
  it("each way to scan has a page that works, or says why it can't", async () => {
    const { client } = await registered();
    for (const path of ["/pantry/scan", "/pantry/scan/device", "/pantry/scan/barcode", "/pantry/scan/receipt"]) {
      const res = await client.get(path);
      // the receipt page answers 503 on a server with no model
      expect([200, 503]).toContain(res.status);
      const doc = new JSDOM(await res.text()).window.document;
      expect(doc.querySelector("nav.subnav a[href='/pantry/scan/barcode']")).not.toBeNull();
    }
  });

  it("the receipt page's camera starts hidden, leaving the plain upload form for no-script and no-camera browsers", async () => {
    const { client } = await registered();
    const res = await client.get("/pantry/scan/receipt");
    expect(res.status).toBe(200);
    const doc = new JSDOM(await res.text()).window.document;
    expect(doc.querySelector("[data-receipt-camera]")?.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector("[data-receipt-start]")?.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector("script[src='/assets/scan-receipt-camera.mjs']")).not.toBeNull();
    // with a server model the photo is uploaded; without one (the deployed
    // site) it's read on the device and only its text is posted
    const device = doc.querySelector("form[data-receipt-device]");
    if (device) {
      expect(device.getAttribute("action")).toBe("/pantry/scan/receipt/text");
      expect(device.querySelector("input[type=file]:not([name])")).not.toBeNull();
    } else expect(doc.querySelector("form[data-scan-form] input[type=file][name=photo]")).not.toBeNull();
  });

  it("the printed lines a browser read off a receipt become a checked review, decided by the server", async () => {
    const { client } = await registered();
    const res = await client.post("/pantry/scan/receipt/text", {
      line: ["MACRO ORGANC FRESH MILK LOW FAT 1L  2.20", "BANANA CAVENDISH", "0.572 kg NET @  $2.50/kg  1.43", "#Woolworths Reusable Bag  0.25", "SUBTOTAL  $3.88"],
      seconds: "2",
    });
    expect(res.status).toBe(200);
    const doc = new JSDOM(await res.text()).window.document;
    const rows = [...doc.querySelectorAll(".scan-row")].map((li) => ({
      name: (li.querySelector("input[name^='name_']") as HTMLInputElement).value,
      qty: (li.querySelector("input[name^='quantity_']") as HTMLInputElement).value,
      price: (li.querySelector("input[name^='price_']") as HTMLInputElement).value,
    })).filter((r) => r.name);
    expect(rows).toEqual([{ name: "milk", qty: "1000", price: "2.20" }, { name: "banana", qty: "572", price: "1.43" }]);
    expect(doc.querySelector(".scan-check-ok")?.textContent).toMatch(/add up to the receipt's total of \$3\.88/);
    // nothing is saved by reading
    const pantry = new JSDOM(await (await client.get("/pantry")).text()).window.document;
    expect(pantry.querySelector(".empty-title")?.textContent).toMatch(/pantry is empty/);
  });

  it("the barcode form works without the camera and refuses a bad code before any lookup", async () => {
    const { client } = await registered();
    const page = new JSDOM(await (await client.get("/pantry/scan/barcode")).text()).window.document;
    expect(page.querySelector("form[action='/pantry/scan/barcode'] input[name=code]")).not.toBeNull();
    const res = await client.post("/pantry/scan/barcode", { code: "3017620422004" });
    expect(res.status).toBe(422);
    expect(new JSDOM(await res.text()).window.document.querySelector(".form-errors")?.textContent).toMatch(/doesn.t look like a product barcode/);
    const lookup = await client.get("/pantry/scan/barcode/lookup?code=12345");
    expect(lookup.status).toBe(422);
  });

  it("the device scan's replies are parsed and merged by the server into a review", async () => {
    const { client } = await registered();
    const res = await client.post("/pantry/scan/device", {
      reply: [
        '```json\n{"items":[{"name":"Carrots","count":6,"confidence":"high"},{"name":"bottle"}]}\n```',
        '{"items":[{"name":"carrots","count":4,"confidence":"medium"},{"name":"zucchini","count":3,"confidence":"high"}]}',
      ],
      seconds: "64",
    });
    expect(res.status).toBe(200);
    const doc = new JSDOM(await res.text()).window.document;
    const names = [...doc.querySelectorAll("input[name^='name_']")].map((i) => (i as HTMLInputElement).value).filter(Boolean);
    // "bottle" isn't food; the two carrot counts merge to the larger
    expect(names.sort()).toEqual(["carrot", "zucchini"]);
    expect((doc.querySelector("input[name^='name_'][value='carrot']")?.closest("li")?.querySelector("input[name^='quantity_']") as HTMLInputElement).value).toBe("6");
  });

  it("another person's scan job is a 404, never a 403", async () => {
    const { client } = await registered();
    for (const path of ["/pantry/scan/jobs/999999", "/pantry/scan/jobs/999999/status", "/pantry/scan/jobs/999999/review", "/pantry/scan/jobs/abc"]) {
      expect((await client.get(path)).status).toBe(404);
    }
  });

  it("signed-out visitors are sent to sign in from every scan route", async () => {
    const base = (await registered()).client.base;
    for (const path of ["/pantry/scan/device", "/pantry/scan/barcode", "/pantry/scan/receipt", "/pantry/scan/jobs/1"]) {
      const res = await fetch(new URL(path, base), { redirect: "manual" });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toMatch(/^\/login/);
    }
    // and can't post a receipt's text
    const posted = await fetch(new URL("/pantry/scan/receipt/text", base), { method: "POST", body: new URLSearchParams({ line: "MILK 2L 3.10" }), redirect: "manual" });
    expect(posted.status).not.toBe(200);
  });
});

// What a scan can't see is suggested from the app's own price listings and a
// shelf-life table, on this file's throwaway database with the catalogue's
// product data loaded by the server module.
describe("prefilling what a scan can't see", () => {
  it("prices counted produce by the item, not by the bag", async () => {
    const { prefillFor } = await import("../src/scan-prefill.ts");
    const apples = prefillFor(0, "apple", 9);
    expect(apples.quantity).toBe("9");
    // nine apples cost a few dollars, not nine one-kilo bags
    expect(Number(apples.price)).toBeGreaterThan(2);
    expect(Number(apples.price)).toBeLessThan(15);
    // a photo's one carton of eggs is a dozen; six loose eggs stay six
    expect(prefillFor(0, "eggs", 1).quantity).toBe("12");
    expect(prefillFor(0, "eggs", 6).quantity).toBe("6");
  });

  it("suggests a likely pack size and price for packaged food, with its source", async () => {
    const { prefillFor } = await import("../src/scan-prefill.ts");
    const milk = prefillFor(0, "milk", 1);
    expect(milk.unit).toBe("ml");
    expect(Number(milk.quantity)).toBeGreaterThan(0);
    expect(Number(milk.price)).toBeGreaterThan(0);
    expect(milk.note).toMatch(/Woolworths|ALDI/);
  });

  it("suggests an expiry from how long the food keeps, sauces before tomatoes", async () => {
    const { shelfLife } = await import("../src/shelf-life.ts");
    expect(shelfLife("chicken thigh")).toEqual({ days: 2, where: "fridge" });
    expect(shelfLife("tomato ketchup")?.days).toBeGreaterThan(90);
    expect(shelfLife("tomato")?.days).toBeLessThan(14);
    expect(shelfLife("unicorn steak")?.where).toBe("fridge");
    expect(shelfLife("xyzzy")).toBeNull();
  });

  it("never overwrites what the scan read: a receipt's size and price stay", async () => {
    const { suggestionsFrom } = await import("../src/routes/scan.ts");
    const [row] = suggestionsFrom(0, [{ detected: "milk", name: "milk", match: "exact", confidence: "high", quantity: "1000", unit: "ml", price_cents: 220, source: "MILK 1L" }]);
    expect([row.quantity, row.unit, row.price]).toEqual(["1000", "ml", "2.20"]);
    expect(row.expiry_date).toBeTruthy();
    expect(row.suggested).not.toMatch(/Woolworths|ALDI/);
  });
});

describe("prefill never suggests a different food's price", () => {
  // cases the 8B model produced on the test photos, which looser matching
  // priced as raw wings, apple punnets, chilli mayonnaise and passata
  it("leaves cooked food unpriced, and never prices a food from a product made of it", async () => {
    const { prefillFor } = await import("../src/scan-prefill.ts");
    for (const name of ["fried chicken", "cooked rice", "mashed potatoes", "leftovers"]) expect(prefillFor(0, name, 3).price).toBe("");
    for (const [name, not] of [["apple juice", /punnet|apples \d/i], ["chilli", /mayonnaise|tuna/i], ["basil", /passata|pesto|tuna/i], ["tomato sauce", /^the /]] as const) {
      expect(prefillFor(0, name, 1).note).not.toMatch(not);
    }
  });

  it("counts more than a few as pieces of one pack, not that many packs", async () => {
    const { prefillFor } = await import("../src/scan-prefill.ts");
    const one = prefillFor(0, "chickpeas", 1);
    expect(prefillFor(0, "chickpeas", 5).price).toBe(one.price);
    expect(Number(prefillFor(0, "chickpeas", 2).price)).toBeCloseTo(Number(one.price) * 2, 2);
  });

  it("marks a price from a listing that isn't quite the food as rough", async () => {
    const { prefillFor } = await import("../src/scan-prefill.ts");
    const k = prefillFor(0, "tomato ketchup", 1);
    if (k.price) expect(k.note).toMatch(/^roughly /);
  });
});

describe("prefilling a barcode's pack", () => {
  it("prices the scanned size, not the listing's size, and says nothing it didn't suggest", async () => {
    const { suggestionsFrom } = await import("../src/routes/scan.ts");
    const { prefillFor } = await import("../src/scan-prefill.ts");
    const listing = prefillFor(0, "milk", 1);
    const [half] = suggestionsFrom(0, [{ detected: "milk", name: "milk", match: "exact", confidence: "high", quantity: String(Number(listing.quantity) / 2), unit: listing.unit, price_cents: null }]);
    expect(Number(half.price)).toBeCloseTo(Number(listing.price) / 2, 1);
    // a size in other units can't be priced from the listing
    const [odd] = suggestionsFrom(0, [{ detected: "milk", name: "milk", match: "exact", confidence: "high", quantity: "3", unit: "bottles", price_cents: null }]);
    expect(odd.price).toBeUndefined();
    expect(odd.suggested).not.toMatch(/Woolworths|ALDI/);
  });
});

describe("showing a review creates nothing", () => {
  it("prefilling a model's made-up name doesn't add it to the ingredient catalogue", async () => {
    const { prefillFor } = await import("../src/scan-prefill.ts");
    const { one } = await import("../src/db.ts");
    prefillFor(0, "glorpberry jam", 1);
    expect(one("SELECT 1 FROM ingredients WHERE name = 'glorpberry jam'")).toBeUndefined();
  });
});
