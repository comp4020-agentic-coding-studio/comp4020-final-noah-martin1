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
  keep all calls on the shared throttled queue in `yt.py`. A block shows up
  as transcript calls hanging (not erroring) and yt-dlp metadata timing out.
  It lifted after a few hours. While blocked, pause transcripts in `yt.py`
  so hung calls don't hold the shared queue, and verify from written recipes.
- A timeout is not a dead video. One scan marked 320 videos "dead" and 297
  were yt-dlp timeouts during a block. Never cache a timeout, and re-scan
  timed-out entries once YouTube answers again.
- Some recipe sites refuse automated fetches. Don't work around that: use the
  transcript, another evidence source, or `no-video`.

## Review

- Reviewers must never edit `evidence/`. One appended a page's metric amounts
  to the saved evidence so its quotes would pass, which defeats the check.
- A transcriber can keep editing a file after it was reviewed (it was still
  waiting on a slow fetch). `integrate.mjs` refuses any record modified after
  its review file.
- Agents killed by a network error leave records that validate but may be
  incomplete; review them as possibly half-finished.

## Cost

- Sonnet transcribes a recipe for about $0.16, against about $1.10 on Opus,
  with similar quality once a reviewer checks it. Use Sonnet for both passes
  and save Opus for coordination.
