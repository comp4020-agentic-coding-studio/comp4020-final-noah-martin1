# Scanning food into the kitchen: test results

Three ways to add food without typing: a photo of the fridge or pantry, a barcode, and a shopping receipt. Each was measured on speed and on correctness, with real photos. This page has the headline numbers; the detail, with every photo and what the model said about it, is in each feature's folder.

Everything runs locally: the models through Ollama on the server (or in the visitor's own browser), barcodes in the browser. Times are on an Apple M4 laptop with 24 GB of memory.

## At a glance

| Feature | Correctness | Speed | What the person still does |
|---|---|---|---|
| Fridge / pantry photo (Qwen3-VL 8B, tiled) | finds 78% of the items a careful person sees; 86% of its suggestions are right | 81 s a photo on average (39–178 s), in the background | ticks off wrong items; checks the prefilled size, price and date |
| Barcode (camera) | read 8 of 9 real product photos, never a wrong code; product found for 6 of 8 | about 12 ms a camera frame to decode, about 0.45 s to look up | checks the row; prices and dates are prefilled |
| Receipt (Qwen3-VL 8B) | names 74% of items right; every price it matched was right to the cent | 9–22 s a receipt, in the background; the camera takes the photo itself about 0.5 s after the receipt is held still | checks names; the total check flags a misread price |

## 1. Fridge and pantry photos

Full report: [`fridge-scan/RESULTS.md`](fridge-scan/RESULTS.md). The 12 photos are in [`fridge-scan/`](fridge-scan/), each with the items I could see (`truth.json`) beside what each model listed.

| Model | Found (recall) | Right (precision) | Time a photo |
|---|---|---|---|
| Qwen3-VL 8B, whole photo + 3 bands | 78% | 86% | 81 s (39–178 s) |
| Qwen3-VL 2B, whole photo + 3 bands | 69% | 68% | 27 s (19–35 s) |
| Qwen3-VL 8B, whole photo only | 55% | 84% | 51 s (11–101 s) |

- **8B tiled is the server's default.** Scanning three overlapping bands as well as the whole photo was the biggest gain: on a packed double-door fridge it went from 4 to 10 of 14 items.
- **The 2B model runs in the visitor's browser** (WebGPU, 1.37 GB download, cached after the first visit), so the deployed site can scan without a server model. One pass takes 14–33 s on the M4's GPU, and a tiled scan a minute or two. Its answers were in the same range as the 2B through Ollama.
- **Where it fails:** opaque tubs and containers (photo 04: 33% found), and crowded door shelves of similar bottles. Those rows arrive as low-confidence guesses, unticked, so a wrong guess costs a glance, not a deletion.
- **Speed vs experience:** a scan takes a minute, so it runs as a background job with a progress bar. The person can leave the page, and the fridge page shows a "scan ready" pill when it's done. The page never waits on the model.

### What a photo can't show: prefilled size, price and expiry

A photo says "milk", not "2 L, $3.40, use by the 12th". Each row arrives with those filled in where the app can make a fair guess, and says where each part came from ("Woolworths Full Cream Milk 2L · keeps ~7 days in the fridge"). The person changes what's different. Measured on the 177 items the 8B model listed across the 12 photos:

| Prefilled | Share of items | Source |
|---|---|---|
| Expiry date | 83% | a shelf-life table (FSANZ / USDA FoodKeeper storage times) |
| Price | 54% | this person's last price, else Woolworths/ALDI listings, else the reference price recipes are costed from |
| Pack size | 46% | the same listing |

All under a millisecond an item. Counted produce is priced per item (nine apples priced as nine apples, not nine 1 kg bags), a carton of eggs counts as a dozen, and anything the scan, barcode or receipt read itself is never overwritten.

Earlier versions priced "fried chicken" as 6 kg of raw wings, "apple juice" as a punnet of apples and "chilli" as chilli mayonnaise. Those cases are now tests (`spec/scan-tools.test.ts`), so the 46% of items without a price are ones with no fair match, rather than a wrong one. Every distinct priced suggestion was read through by hand: [`fridge-scan/prefill/PRICES.md`](fridge-scan/prefill/PRICES.md).

### Names: the same food spelt differently

A model's name is matched to an existing ingredient before anything new is created: exact name, then known aliases (cilantro → coriander, ketchup → tomato ketchup), plurals, the person's own past corrections, and then spelling (chili → chilli, parmesean → parmesan, cheese cheddar → cheddar cheese).

- **Test 1:** every catalogue name was given a one-letter typo. 1,813 came back to the right ingredient, 138 were left as "new" (too close to two names), and **0 went to the wrong food**. The strictness is deliberate: the catalogue holds real near-pairs such as custard and mustard.
- **Test 2:** all 194 distinct names the models produced on the test photos and receipts. This step merged 4 correctly (the chili spellings) and none wrongly.
- Showing a review never adds anything to the ingredient list. Only saving does, after the person confirms.

## 2. Barcodes

Full results: [`barcode-scan/results.json`](barcode-scan/results.json), from `scripts/eval-barcode-scan.mjs`. The nine photos are real product photos from Wikimedia Commons (sources and licences in [`barcode-scan/manifest.json`](barcode-scan/manifest.json)). They include curved cans and bottles, a code printed sideways, an angled box, flash glare and low light. The right digits were read by eye and confirmed by the check digit ([`barcode-scan/truth.json`](barcode-scan/truth.json)).

| Reader | Read right | Wrong code | Time, camera frame (median / max) |
|---|---|---|---|
| ZXing (barcode-detector 3.2.2, WebAssembly) | 8 / 9 | 0 | 12 / 13 ms |
| Chrome's built-in BarcodeDetector | 7 / 9 | 0 | 12 / 36 ms |

- **The miss both readers share** is b05: the barcode is cut off at the photo's edge, under glare. A person couldn't read it either.
- **The built-in reader also missed** the Spitfire bottle (curved label). So the page now passes every third empty frame to ZXing too, whenever the built-in reader is in use.
- **Wrong codes never get through.** The camera reads continuously, a few frames a second, and adds each new code to a basket. The server also refuses any code whose check digit is wrong, so a misread can't reach the lookup.
- **Lookup** goes to Open Food Facts through the app: median 0.45 s (2.2 s for the first, cold call). Of the 8 codes read, 6 were found with name and pack size (Coca-Cola 330 ml, Winterbock 500 ml, Pfefferminz tea 60 g, Spitfire 500 ml, cocoa biscuits 160 g, a Russian candy). The two not found are a Hong Kong ham and a supermarket's in-store strawberry code. The page says so plainly and the item can be typed in instead.
- **End to end** in headless Chrome with a fake camera playing a real EAN-13: the code is read within about a second, looked up, added to the basket, and the review shows "Nutella 400 g" with its expiry prefilled.

## 3. Receipts

Full report: the receipts section of [`fridge-scan/RESULTS.md`](fridge-scan/RESULTS.md), photos in [`receipt-scan/`](receipt-scan/). Four real receipts: Woolworths (Australia, with weighed fruit and a promotional discount), Tesco (UK, 1994), an Italian one (decimal commas, a weighed line) and a Polish one (a discount line).

| Model | Item names right | Prices right (of matched items) | Total check right | Time a receipt |
|---|---|---|---|---|
| Qwen3-VL 8B | 74% | 100% | 3 of 4 | 9–22 s |
| Qwen3-VL 2B | 72% | 100% | 3 of 4 | 11–16 s |

- **Prices are reliable; names less so.** Every price the models matched to an item was right to the cent, after discounts, and weighed items come through as grams. Names are where they slip: "mild white chocolate" for MLD WHT CHDR, "pancake mix" for pikelets.
- **The total check:** the app adds the prices and compares them with the receipt's printed total. A mismatch is flagged and every line arrives unticked.
- **In the browser** the 2B model can't read receipts (5% of names), so receipts need the server model. The deployed site, which has none, says so and offers the barcode scanner.

### Taking the photo automatically

Following the QR-scanner idea, the receipt page has a live camera. It looks at a few frames a second and takes the photo itself once a receipt fills the view, sharp and held still, for about half a second. A ring fills while it waits; a hint says what's wrong ("Fill the frame…", "Hold still…", "Focusing…"). "Take photo now" is always there, and so is the plain file input. The check is plain pixel arithmetic (`public/receipt-frame.mjs`), no model.

Measured by `scripts/eval-receipt-camera.ts` on 95 camera-like frames built from the test photos ([`receipt-camera/results.json`](receipt-camera/results.json)): each receipt on a dark-wood, grey and white bench, at three distances, level and tilted, plus out-of-focus and shaken copies, the 12 fridge photos, and bare benches.

| Frames | Would capture |
|---|---|
| Receipts filling ≥ 75% of the frame (48) | 48 (100%) |
| Receipts at 55% of the frame (24) | 18 (75%); the other 6 are on dark wood, where the hint says to move closer |
| Out of focus or shaken (8) | 0 |
| Bare benches (3) | 0 |
| Fridge and pantry photos (12) | 3 pass the framing check (harmless on the receipt page, where the person is pointing at a receipt) |

- **Speed:** about 3 ms a frame.
- **Simulated clip** (the receipt slides in for 1 s, wobbles for 1 s, then is held still): no capture during the slide or the wobble, and the photo was taken 0.5 s after it settled.
- **End to end** in headless Chrome with that clip as a fake camera, at phone size: the camera opened, the hints changed as expected, it captured by itself at 3.2 s, and the page moved to the scan's progress page.

## Not yet tested

- **A real phone.** All camera tests used Chrome's fake camera at phone size. Real camera noise, autofocus hunting and hand tremble may need the stillness and sharpness thresholds tuning (they're named constants in `public/receipt-frame.mjs`, each with the measurement it came from).
- **Learning from corrections.** When someone renames a scanned item, the next scan uses their name. It works and is tested, but how much it improves a person's second and third scans hasn't been measured.
- **More receipts and photos.** Four receipts and twelve fridge photos are enough to compare models and catch failures, not to quote tight percentages.
