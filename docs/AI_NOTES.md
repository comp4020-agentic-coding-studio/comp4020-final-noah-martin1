# AI notes: recipe video matching

Things learned the hard way while matching catalogue recipes to YouTube videos.

## Pipeline

- Scratch work lives in `/tmp/ytwork`, which macOS wipes on reboot. The
  briefs (`BRIEF.md`, `REVIEW.md`) and scripts can be recovered from an old
  session transcript (`~/.claude/projects/<repo>/<session>.jsonl`) by
  extracting the `Write` tool calls whose path starts with `/tmp/ytwork`.
- The only durable record of shipped work is `src/data/videos.json`
  (`transcribed: true`) and `src/data/catalogue.json`. Review files are
  scratch, so `integrate.mjs` must keep any entry already marked
  `transcribed` even when its review file is gone; otherwise a dry run hides
  every shipped video.
- Run `integrate.mjs --dry` before every real merge and check
  `hiddenUnchecked` is 0.

## Fetching evidence

- `yt-dlp` and `youtube-transcript-api` go in a venv under `/tmp/ytwork`;
  recreate it with `python3 -m venv` if `pip install` fails with a permissions
  error (the old venv's site-packages can be read-only).
- `linked.py` (the creator's written recipe page) fails with an SSL
  certificate error on this Mac's Python unless run with
  `SSL_CERT_FILE=/etc/ssl/cert.pem`.
- YouTube rate-limits transcript fetches from one IP after roughly 100 calls;
  keep all calls on the shared throttled queue in `yt.py`.

## Cost

- Sonnet transcribes a recipe for about $0.16, against about $1.10 on Opus,
  with similar quality once a reviewer checks it. Use Sonnet for both passes
  and save Opus for coordination.
