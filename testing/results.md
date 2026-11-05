# Scanning food into the kitchen: test results

Three ways to add food without typing: a photo of the fridge or pantry, a barcode, and a shopping receipt. Each was measured on speed and on correctness, with real photos. This page has the headline numbers; the detail, with every photo and what the model said about it, is in each feature's folder.

Everything runs locally: the models through Ollama on the server (or in the visitor's own browser), barcodes in the browser. Times are on an Apple M4 laptop with 24 GB of memory.

## At a glance

| Feature | Correctness | Speed | What the person still does |
|---|---|---|---|
| Fridge / pantry photo (Qwen3-VL 8B, tiled) | finds 78% of the items a careful person sees; 86% of its suggestions are right | 81 s a photo on average (39–178 s), in the background | ticks off wrong items; checks the prefilled size, price and date |
| Barcode (camera) | read 8 of 9 real product photos, never a wrong code; product found for 6 of 8 | about 12 ms a camera frame to decode, about 0.45 s to look up | checks the row; prices and dates are prefilled |
| Receipt, read in the browser (PaddleOCR + plain-code parser) | names 91% of items right; 98% of their prices right to the cent (12 receipts: Coles, Woolworths, Costco, ALDI and four overseas) | about 1.5–2 s a receipt in Chrome once the 14 MB reader is cached; the camera takes the photo itself about 1 s after the receipt is held still | checks names; the total check flags a misread price |
| Receipt, server model (Qwen3-VL 8B) | names 74% of items right; 87% of their prices right (same 9 receipts) | 21–67 s a receipt, in the background | as above; only on a self-hosted install |

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

Photos in [`receipt-scan/`](receipt-scan/), with the items and prices on each written down by hand in [`receipt-scan/truth.json`](receipt-scan/truth.json) (each receipt's lines add up to its printed total). Twelve real receipts:

- **Five phone photos of Australian supermarket receipts** (Coles Brighton and Bentleigh, Woolworths Chadstone twice and Queen Victoria; Melbourne, 2015–2024): 20 and 31-item receipts, crumpled and curled paper, a granite or glass bench showing through, and on one, the printer's price column sitting half a line above the names.
- **A Costco receipt** (Moorabbin, 2023), added after the first version failed on the user's own Costco receipt. Costco prints each item's name on one line and its price on the next after an item number and a count ("15795 1x 11.49 11.49 Z"), and its instant savings as a "TPD" line with a trailing minus ("2.00-Z"). The parser had only been written against Coles and Woolworths layouts, so it found 2 of 13 items and no total. It now pairs a numbers-only price line with the name above it, reads a trailing minus as a discount on the item before, and reads "TOTAL(INCL GST)" as the total: 13 of 13 items, every price right, adding up to the printed $204.40.
- **Two ALDI receipts** (Southland and Bentleigh). ALDI prints an item number before each name, squashes names ("ChsChedAgd200-250g", "SlcdPepperoni2x50g", "Chob BlueYog"), and prints a running "Subtotal" after some items. The parser stopped at the first subtotal, so on Southland it found 1 of 9 items. Now a subtotal with more items after it is skipped and the last one is the total, and two-word names match either way round ("Chs Ched" is cheddar cheese, "SAUCE SOY" soy sauce): Bentleigh 5 of 5, Southland 9 of 9 found with every price in the review and the $33.52 total adding up (the scorer misses one ham line because the reader read "Ham" as "Haim").
- **No IGA receipt.** No openly licensed photo of a whole IGA receipt could be found (only the foot of one). IGA stores are independent and use several till systems; the plain "NAME … PRICE" lines most print are what the parser already reads, but that's untested.
- **The original four:** Woolworths (weighed fruit, a promotional discount), Tesco (UK, 1994), Italian (decimal commas) and Polish (a discount line).

### The live site reads receipts in the browser

The deployed site has no server model, and the in-browser vision model can't read receipts (5% of names; see below). So receipts are now read differently: **a text reader runs in the browser and plain code decides what was bought.**

1. **Reading the print:** PaddleOCR's PP-OCRv4 detector and recogniser (about 14 MB, from jsDelivr, cached after the first visit) on onnxruntime-web, in a worker so the camera and page stay smooth (`public/receipt-ocr.mjs`, `public/receipt-ocr-worker.mjs`). Only WebAssembly is needed, not WebGPU, so it works in any current browser. The photo never leaves the device; only the printed lines are posted.
2. **Deciding what was bought:** `src/receipt-text.ts`, no model. It pairs weights, "2 @ $1.50" counts, discounts and "REDUCED PRICE" lines with their item, stops at the total, and counts shopping bags towards the total but not as food. A food's name is the ingredient the app already knows that the printed words contain, found even in words the printer ran together ("BRITISHBACON200GRAM" is bacon), after receipt abbreviations are spelled out ("CHSE" cheese, "SBERRY" strawberry). A food made into something else is that product: POTATO CHIP is potato chips, BEEF JERKY is beef jerky, an EGG & LETTUCE SANDWICH is a sandwich, not a dozen eggs.
3. **Then the same review as the server reading:** sizes from the printed text (Coles' "170GRAM" and "1LITRE" now included), the check against the printed total, and price and expiry prefill.

Measured by `scripts/eval-receipt-ocr.ts`, which runs the same `receipt-ocr.mjs` in node on the same model files ([`results/browser-paddleocr.json`](receipt-scan/results/browser-paddleocr.json)), against the server model on the same nine receipts:

| Reader | Item names right | Prices right (of matched items) | Time a receipt |
|---|---|---|---|
| **In the browser: PaddleOCR + parser** | **87%** (with Costco and ALDI, 12 receipts: 91%) | **99%** (12 receipts: 98%) | 0.3–0.8 s in node; 1.5–2 s in Chrome |
| Server: Qwen3-VL 8B (nine receipts, before Costco) | 74% | 87% | 21–67 s |
| In the browser: Qwen3-VL 2B (original four only) | 5% | 0% | 30–60 s |

- **Choosing the text reader:** on the same receipts, Tesseract (tesseract.js 7) read 66% of the item prices into its text, and 29% on the crumpled Coles receipt, where the bench's texture became junk text. Cleaning the image up first didn't fix it. PaddleOCR read 92% (98% on the Australian phone photos), so it was chosen. The app's own plain-JavaScript port (`receipt-ocr.mjs`, no OpenCV) reads exactly as well as the PaddleOCR JavaScript package it replaced, a little faster.
- **What's left is names, not prices.** Lines that only name a brand (PETERS CONNOISSEUR, YAKULT, MADURA) can't be matched to a food without a product database, so they come through with their printed words for the person to rename; the app remembers the rename for their next receipt. The weakest receipt is the crumpled 31-item Coles one (68% of names), where the reader pairs a few names with the next line's price at the folds.
- **The total check works as intended.** On every receipt where the prices add up, they really do add up; where the reader misplaced a price (the half-line-high price column; a fold), the lines don't add up to the total, the review says so, and every line starts unticked.
- **First visit:** the reader downloads while the person lines up the photo (on a fast connection it's ready before they are). In the test it took about 70 s on a slow link; a returning visitor has it cached. On a connection the browser marks as data-saving or 2G, the download waits until a photo is taken.
- **End to end** in headless Chrome at phone size, on a server with no model like the deployed site: with the fake camera playing a receipt, the photo was taken by itself 1 s after the camera opened and the review was showing 2.5 s after that, with the total check passed. From a chosen file, a 20-item Coles receipt went to its review in 3.3 s, every price right and every Coles pack size read.

The server model is still used on a self-hosted install that has one; there the earlier results stand:

| Model (original four receipts) | Item names right | Prices right (of matched items) | Total check right | Time a receipt |
|---|---|---|---|---|
| Qwen3-VL 8B | 74% | 100% | 3 of 4 | 9–22 s |
| Qwen3-VL 2B | 72% | 100% | 3 of 4 | 11–16 s |

- **Prices are reliable; names less so.** Every price the models matched to an item was right to the cent, after discounts, and weighed items come through as grams. Names are where they slip: "mild white chocolate" for MLD WHT CHDR, "pancake mix" for pikelets. On the new crumpled Australian photos the 8B model did worse (58–85% of names, and it couldn't read either Coles total).
- **The total check:** the app adds the prices and compares them with the receipt's printed total. A mismatch is flagged and every line arrives unticked.

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
- **More receipts and photos.** Twelve receipts and twelve fridge photos are enough to compare readers and catch failures, not to quote tight percentages. The receipt parser was tuned on these, and the Costco and ALDI failures showed a store with a new layout can break it outright, so expect lower on new stores. IGA receipts haven't been tried. A blurry, marker-scribbled US Costco photo also failed: the reader missed most of its price column, which no parsing can recover.
- **Reading receipts on a phone.** The in-browser reader was timed on the M4 in Chrome; a mid-range phone will be slower (the reading is single-threaded WebAssembly).
