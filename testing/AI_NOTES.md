# AI notes: fridge photo scan

Things learned the hard way while evaluating local vision models for the
photo-to-pantry scan. Results and photos are in `fridge-scan/`.

## Running models with Ollama

- Ollama isn't installed by default: `brew install ollama`, then `ollama serve`.
  It answers on `localhost:11434`.
- The bare `qwen3-vl:<size>` tags are *thinking* builds. They ignore
  `think: false`, spend the whole token budget on hidden reasoning and return an
  empty `content`. Use `qwen3-vl:<size>-instruct`. Check any new model with one
  call first: an empty `content` plus a filled `message.thinking` means this.
- `ollama pull` output is the only reliable progress signal. The server logs a
  `POST /api/pull` line only when a pull *ends*, and partial blobs in
  `~/.ollama/models/blobs` can belong to an earlier, cancelled pull. Killing a
  pull and re-running it resumes where it stopped.
- In zsh, `rm a* b* c*` with one unmatched pattern removes nothing. Use
  `ollama rm <model>` to clear a model, not hand-deleted blob files.
- Several "vision" models in the Ollama catalogue are cloud-only (tag
  `:cloud`), which breaks the local-hosting requirement. Check the tags page.

## What makes the scan work

- On a packed shelf a small model falls into a loop ("hot sauce, hot sauce,
  ...") until it runs out of tokens, and everything after the loop is lost. A
  mild `repeat_penalty` (1.1 over the last 96 tokens) stops it. Stronger ones
  also suppress JSON's own repeated keys and cut the list short.
- One-line-per-item output loops less but invents more: on cluttered photos the
  8B model recited a generic grocery list. Keep JSON.
- Tiling helps most. Scanning the whole photo plus three overlapping bands took
  the 8B model from 4 to 10 of 14 required items on a full double-door fridge.
  Merge overlapping views by keeping the larger count, not the sum.
- macOS `sips` crops without a dependency: `-c <height> <width> --cropOffset <y>
  <x>` (height and y come first).

## Model size limits on this Mac (M4, 24 GB)

- The GPU can use only about 15.5 GiB, so 27–30B models (qwen3.8:27b needs
  16.9 GiB) fail with a 500 and "model requires ... but only ... available"
  in the Ollama log. 8B is the largest Qwen vision model that loads.
- `lfm3-vl:2b` runs on Ollama's MLX engine, which in the Homebrew build has no
  structured-output support: any call with `format: "json"` returns 501.

## Running a vision model in the browser

- Headless Chrome on this Mac has WebGPU with no flags (Apple GPU, f16).
- `onnx-community/Qwen3-VL-2B-Instruct-ONNX` works with transformers.js 4.3.2
  through `AutoProcessor` and `AutoModelForImageTextToText`, `device:
  "webgpu"`, `dtype: "q4f16"` (1.37 GB). Pass `enable_thinking: false` to
  `apply_chat_template`. Replies come wrapped in a ```json fence;
  `parseScan` already strips it.
- The first load took about 4 minutes (download); a cached load about 2.5 s.
  One whole-photo pass was 14–33 s on the M4 GPU, against about 5 s for the
  same model in Ollama.
- No browser (ONNX) build of Qwen3-VL-4B was found; Gemma-3n-E2B's is 3.3 GB.
- Scoring Ollama's 2B model is a fair stand-in for the browser's: its answers
  on the same photos were in the same range.

## Receipts

- Real receipts put a weighed item's weight on the line below its name
  ("APPLE PINK LADY" / "0.217 kg NET @ $3.90/kg") and a discount on its own
  line ("GOLDEN PANCAK OFFER -1.98", Polish "Rabat -2,00", Tesco "REDUCED
  PRICE"). Ask the model for each item's price after its discount, then check
  those prices against the printed total; a total check that skips discounts
  fails on every receipt that has one.
- Woolworths writes grams as "GM", and "16PK 140GM" is a 140 g pack of 16,
  not 16 × 140 g. European receipts use decimal commas ("0,5484kg").
- A total check catches misread prices, not misread names: the 8B model read
  Italian "CRIK CROK" crisps as "chocolate bar" with the right price.
- Score receipt names on the model's `name` field only: its `text` copies the
  printed line, so matching on both counts a wrong name as right.
- Qwen3-VL 2B through Ollama reads receipts nearly as well as 8B (73% vs 74%
  of names, every matched price right) but gives weights as a fractional
  `qty` (0.572 for "0.572 kg NET") and discounts as negative-price lines.
  The parser turns both into grams and into a discount on the item above.
- The same 2B model in the browser (transformers.js 4.3.2) can't read
  receipts at any precision: q4f16 got 5% of names, fp16 (4.73 GB) 33%, no
  prices right. Image token counts matched Ollama's, so it isn't resolution
  or compression. Fridge photos were fine. Don't ship browser receipt reading
  on this stack without retesting a newer library or model.

## Barcodes

- Chrome on macOS has no `BarcodeDetector` (it ships on Android, ChromeOS and
  Safari 17+). `barcode-detector@3.2.2`'s `ponyfill` (ZXing WebAssembly) fills
  the gap and decoded a real EAN-13 in desktop Chrome.
- Test the camera flow headless with a fake camera:
  `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<file>.y4m`
  (make the .y4m with `ffmpeg -loop 1 -i frame.png -t 3 -pix_fmt yuv420p -f yuv4mpegpipe`).
- Open Food Facts names are usually brands ("Nutella", "Mars"), so the pack
  size is the reliable part; the name still goes through `resolveName`.
- On real photos (`barcode-scan/`), headless Chrome on macOS *does* expose a
  native `BarcodeDetector`, and it missed a code on a curved bottle that ZXing
  read. Don't trust native alone; the page falls back to ZXing.
- Wikimedia Commons' `Category:International_Article_Number_(EAN13)` has real
  photos of product barcodes; most don't state the digits, so read them off
  the image and confirm with the check digit.

## Receipt auto-capture (camera)

- The check only has to choose *when* to shoot on a page where the person is
  already pointing at a receipt, not classify receipts vs fridges. Trying to
  reject fridge photos made it miss real receipts (white fridge walls look
  like paper, labelled jars look like print).
- Sharpness: Laplacian-based scores depend on content and didn't separate
  blurred from sharp. The re-blur ratio (blur the crop, measure how much
  neighbouring-pixel difference is lost; Crété et al. 2007) did: sharp
  receipts 0.71–0.89, blurred 0–0.53. Test it with irregular content: a
  periodic test pattern is flattened by its 9-tap blur whether sharp or not.
- Motion: a 2 px shift at 720p already reads ~6 on the small-copy mean
  difference, so a threshold of 6 would never fire in a hand. 10 lets tremble
  through and still stops pans (15–35).
- `ffmpeg` builds realistic test frames from the real receipts:
  `rotate=angle=0.1:fillcolor=none:out_w=rotw(0.1):out_h=roth(0.1)` (named
  options: positional `rotate=0.1:c=none` fails), `gblur`, `dblur` for shake,
  and an `overlay` with time expressions for a slide-in/wobble/settle clip.
- To submit a camera frame through an existing multipart form, put a `File`
  in the input with `DataTransfer` and call `form.requestSubmit()`: the
  browser follows the server's redirect or shows its error page normally.

## Prefill (price, size, expiry)

- `packOptions`/`referencePrice` match loosely on purpose (recipe costing),
  which on fridge items gave basil → "Pesto Basil", chilli → "Lime & Chilli
  Tuna", tomato sauce → tomatoes, cooked rice → a 5 kg bag. Every listing has
  to contain the scanned name's words and not be another food made from it.
  Run `prefillFor` over every name in `fridge-scan/results/*.json` and read
  the whole list; spot checks missed most of these.
- Calling `ingredientId(name)` to look up a price *inserts* the name. Look it
  up with a SELECT when rendering a review.
- A naive plural stem (`/(es|s)$/`) turns "oranges" into "orang", which
  silently dropped the right listing and let "Choco Air Orange" win.

## Spelling matches

- The catalogue has real near-pairs (custard/mustard, hot/soy sauce, rice/rye
  flour) and models write things like "orange net", two letters from "orange
  zest". Only one word may differ, its first letter must agree, and only one
  candidate may be that close. Check a new rule by giving every catalogue
  name a typo and counting wrong matches (it should be 0).

## Testing

- Headless Chrome's `--window-size` has a floor of about 500 px, so a 390 px
  screenshot silently lays out at 500 and looks clipped. Use device emulation
  through the DevTools protocol (`Emulation.setDeviceMetricsOverride`) to test
  phone widths.
- The local `data/app.db` reported corruption on 2026-11-04. Open it read-only
  (`sqlite3 -readonly`, or `?mode=ro`): a read-write open checkpoints and
  deletes the WAL file. Run specs against a throwaway `DATA_DIR`.
