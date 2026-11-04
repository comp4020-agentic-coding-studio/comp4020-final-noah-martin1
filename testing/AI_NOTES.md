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

## Testing

- Headless Chrome's `--window-size` has a floor of about 500 px, so a 390 px
  screenshot silently lays out at 500 and looks clipped. Use device emulation
  through the DevTools protocol (`Emulation.setDeviceMetricsOverride`) to test
  phone widths.
- The local `data/app.db` reported corruption on 2026-11-04. Open it read-only
  (`sqlite3 -readonly`, or `?mode=ro`): a read-write open checkpoints and
  deletes the WAL file. Run specs against a throwaway `DATA_DIR`.
