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

## Australian grocery names

- American "tomato sauce" is passata here: in Australia "tomato sauce" means
  ketchup, so keeping the name prices the wrong product.
- Rename only to the same food. Stout can be "beer" (note "Guinness or
  stout"), and calamansi can be lime juice when the source offers lime. But
  cake flour is not plain flour: leave a different food unpriced rather than
  mispriced.
- Check counted produce and volumes against how the app prices them: "3
  cabbage leaves" priced as 1.5 g, "1 cup basil" as 250 g and "1/3 cup
  coriander" as 2 bunches were all real catches. Use the source's weight when
  it gives one, or a handful/bunch unit.
- Mark deep-frying and shallow-frying oil "for deep-frying"/"for frying" so it
  isn't charged as eaten, and don't list a homemade paste a second time as a
  bought jar.
- Open gap in the app's reference data: there is "dried oregano" but no
  "dried thyme" (or most other dried herbs) and no dried mushrooms, so a
  recipe's dried thyme or dried shiitake is priced at the fresh price and
  weight. Fix it in `src/nutrition.ts` and `src/data/prices.json` with dated
  sources, not by renaming lines in recipes.
- A cup of a solid food falls back to water's weight unless `CUP_GRAMS` in
  `src/nutrition.ts` lists it. Ginger was missing and was priced at 250 g a
  cup; check this table when a reviewer flags a cup amount as overpriced.

## Choosing what to work on

- Triage before spending agents: `scan.py` reads each candidate video's
  description (no agent cost) and sorts it into "linked" (links a recipe
  page), "inline" (full recipe in the description), "list" (ingredients, no
  method), "none" and "dead". Linked and inline hit about 75%; do them first.
- Once those run out, search waves on well-known dishes still hit 50-80%:
  name a creator who publishes written recipes in the query (RecipeTin Eats,
  Marion's Kitchen, Just One Cookbook, Made With Lau, Hebbars Kitchen, Spain on
  a Fork, Scandinavian Cookbook, Panlasang Pinoy, Toine's Kitchen) and cap it
  at 2 searches and 2 candidates per recipe.
- "list" videos (ingredients but no method) only become usable once
  transcripts work again, since the transcript gives the method.
- The catalogue has near-duplicate pairs (two bigos, two empanadas, two full
  English breakfasts, two gołąbki). `integrate.mjs` refuses to verify one
  video for two recipes; give the second of a pair a different creator or
  leave it.

## What reviewers reject (and should)

- A replacement that makes only part of the dish (a "Sunday roast" video that
  only roasts the beef, a noodle-bowl recipe replaced by just the pork), or a
  different dish (black bean soup replaced by a side of beans).
- A main ingredient with no amount (the chicken in fried chicken, the flour in
  jam biscuits, the brisket in smoked meat), even if the validator's limit of
  two is technically met.
- Evidence that is someone else's recipe (a "Recipe used:" link to another
  site, a BBC page cited by a different channel), or a tiny channel with an
  incomplete recipe.
- A recipe whose batch size makes the per-serving cost meaningless (a whole
  marinated 2.3 kg pork shoulder for four Cuban sandwiches).
- Transcribers tend to drop an ingredient or invent an amount to pass the
  validator, to rename to a priced but different food, and to carry the old
  catalogue's servings over as if stated. Briefs now forbid all three.

## Where it stopped (2026-10-29)

- 315 recipes verified (of 757). About 167 recipes have no candidate video
  at all, 125 have a video with no recipe in its description, 46 a video with
  ingredients but no method (wait for transcripts), 22 a dead video.
- Scratch state (`/tmp/ytwork`: scan.json, assigned.json, out/, review/) is
  lost on reboot; videos.json and catalogue.json are the durable record.

## Cost

- Sonnet transcribes a recipe for about $0.16, against about $1.10 on Opus,
  with similar quality once a reviewer checks it. Use Sonnet for both passes
  and save Opus for coordination.
- Measured over this session: about $0.30 per verified recipe all in
  (transcription, review and coordination), at a 70-75% hit rate.
