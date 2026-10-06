# Rules for the agent

These hold on every change. Each one exists because breaking it would break
something the brief, the marker or a user relies on.

- **Never break the two baked-in checks.** `/` answers 200 directly (no
  redirect) and `/readme/` server-renders every README heading in order.
  Don't edit or delete `spec/invariants.test.ts`.
- **Every visibility decision goes through `src/visibility.ts`.** Routes never
  write their own "who can see this" SQL. A hidden recipe or entry answers
  404, never 403, so strangers can't learn it exists.
- **All HTML goes through the `html` tagged template** (`src/html.ts`), which
  escapes by default. `raw()` is only for content we wrote (README markdown,
  icons), never anything a user typed.
- **Parameterised SQL only.** No user input concatenated into a query string.
- **Schema changes are a new numbered file in `src/migrations/`.** Never edit
  a migration that has shipped: the deployed database already ran it.
- **The only durable storage is `$DATA_DIR`** (`/data` on Fly). Nothing that
  must survive a redeploy lives anywhere else.
- **Every new invariant gets a spec test** in `spec/`, run against the running
  app over HTTP (`pnpm check`). A bug found by hand gets a test before the fix.
- **AI is advisory only.** The deterministic budget/pantry/expiry filter
  decides what's suggested; the model only matches names and explains picks,
  and the page still works when it's slow or down.
- **No secrets in the repo.** API keys live in Fly secrets or
  `mise.local.toml`. Never touch `.claude/`.
- **Previews say they're previews.** Sections not yet built show sample data
  from `src/samples.ts` under `previewBanner()`, and their forms sit in a
  disabled fieldset; nothing mock-up ever looks like a working feature
  (`spec/navigation.test.ts` checks the banner). When a phase lands, its
  pages switch to real queries and its samples are deleted.
- **New sections join `NAV_GROUPS`** in `src/views/layout.ts`, which feeds
  the sidebar, the mobile tab bar and `/more` — so every page stays reachable
  on a phone.
- **Keep the look consistent:** tokens in `public/app.css` `:root` (light and
  dark), sharp corners, hairline borders, one accent. New UI reuses existing
  classes before adding new ones, and is checked at 390px wide and with the
  keyboard.
- **Demo mode is temporary.** `DEMO_MODE` in `src/demo.ts` seeds the demo
  kitchen on boot and prefills sign-in with alice. Before the final
  submission: set it to `false`, delete `spec/demo.test.ts`, and remove the
  demo users from the live database.

# How to run it

- `pnpm dev` — app on http://localhost:8080 with the database in `./data`
- `pnpm seed` — local demo users (alice, sam, bo, jo; password `password123`)
- `pnpm check` — typecheck + every spec, against the running app
- `pnpm check:evidence` — process evidence (needs a crit reflection to pass)

# Kitchen Social — full project plan

## Context

This is the COMP4020 final project: a deployed, multi-user, real-time,
persistent web app, individually built over ~5 weeks (crits 8/9/10, due
Mon 9 Nov). The repo currently ships only the template placeholder
(busybox + static HTML via Dockerfile, empty CLAUDE.md/PROCESS.md,
baked-in spec tests for / and /readme/). Nothing real exists yet.

The user wants an ambitious, in-depth recipe/kitchen social platform — not a
trimmed MVP — covering: personal + shared household inventory (with expiry,
quantity, pricing), recipe creation/sharing with friends, meal calendars,
AI-assisted meal planning (budget/expiry/dietary-aware), shared-household
ingredient reservation as a live interaction, and a live "who's cooking what
right now" feed with a step-by-step detail view and a "cook with Alice"
companion mode. This plan lays out the full feature set and a concrete,
step-by-step build order so all of it gets built, sequenced so each slice is
itself a working, demoable deployment (important since crit 8 grades "first
working version").

## Decisions made (flagged for redirect)

- "Cook with Alice" = independent companion mode, not lockstep sync.
  Joining a friend's live session creates your own participant row with your
  own current_step; you see their step live as a reference, they see yours,
  but nobody is forced to wait on anyone else. Simpler to build correctly
  (no pause/resume/host-control logic) and still genuinely live and social.
  Lockstep (one shared step, host-controlled) is a plausible stretch upgrade
  later if time allows.
- Real accounts (username + password), not pseudonymous sessions.
  A persistent friend graph across devices needs a stable identity; cookie
  sessions backed by a users table, no OAuth provider dependency.
- Households are a separate opt-in concept from friends, not "close
  friends with extra permissions" — a small named group (e.g. a house) with
  its own shared inventory and calendar, membership by invite.
- SQLite as the only datastore, one file on the Fly volume (/data/app.db).
  Fits the "one volume, no separate DB server" constraint exactly, trivially
  backs up/restores across restarts and redeploys. Use Node 24's built-in
  node:sqlite (verify stability on the pinned 24.21.0 at build time; fall
  back to better-sqlite3 if it's not solid enough).
- WebSocket for all live features, one in-process pub/sub keyed by
  room (household id / friend-group / session id) — no Redis needed, the
  deploy is a single machine. Justification for PROCESS.md: reactions,
  step-advances and reservation claims are client→server and server→client
  on the same channel, so WS avoids SSE+POST roundtrip plumbing.
- Server-rendered pages + small vanilla JS/fetch + a WS client. No SPA
  framework — keeps the Docker image and the 256MB runtime footprint small,
  and keeps effort on the functional/data-integrity side rather than UI
  tooling, matching "functional over creative."
- AI (Groq) is advisory-only. A deterministic filter (expiry priority,
  budget sum, dietary tags, pantry overlap) always computes the actual
  candidate set; Groq is used only for (a) fuzzy-matching freeform ingredient
  text to the canonical ingredient catalog, and (b) generating the
  natural-language "why this meal" explanation. The AI call is async, has a
  timeout, and falls back to the deterministic result with no explanation
  text if it's slow or down.

## Data model (SQLite)

- users(id, username, password_hash, created_at)
- auth_sessions(token, user_id, expires_at)
- friendships(id, user_a, user_b, status[pending|accepted], requested_by, created_at, responded_at)
- households(id, name, created_at) / household_members(household_id, user_id, joined_at)
- ingredients(id, name, default_unit, category) — canonical catalog, used for matching
- inventory_items(id, owner_type[user|household], owner_id, ingredient_id, quantity, unit, expiry_date, price_cents, added_by, added_at, updated_at)
- recipes(id, author_id, title, description, visibility[public|friends|private], dietary_tags json, created_at)
- recipe_ingredients(recipe_id, ingredient_id, quantity, unit, optional bool)
- recipe_steps(recipe_id, step_number, text, est_minutes)
- calendar_entries(id, owner_type[user|household], owner_id, date, recipe_id, planned_by, status[planned|live|completed|cancelled], shared bool, created_at)
- ingredient_reservations(id, inventory_item_id, reserved_by, quantity, calendar_entry_id, created_at, released_at)
- cook_sessions(id, calendar_entry_id nullable, recipe_id, cook_id, household_id nullable, scale_factor, status[live|completed|abandoned], current_step, started_at, last_update_at, ended_at)
- cook_session_participants(session_id, user_id, role[cook|companion], current_step, joined_at, left_at)
- cook_events(id, session_id, actor_id, type[step_advance|reaction|join|leave|message], payload json, created_at) — append-only; this is also the crit-10 "server-side logging" deliverable for the domain layer, alongside plain request logging to stdout for Fly's log capture

## Enforced invariants (→ spec/*.test.ts)

1. A session/participant's current_step only increases while status=live (no silent rewind).
2. Sum of active (unreleased) reservations on an inventory_item never exceeds its quantity; concurrent reservation attempts on the last unit resolve to exactly one winner.
3. A reservation auto-releases when its calendar entry is cancelled, and after an inactivity timeout if abandoned (ties to the brief's "expiry" example directly).
4. A user who is not an accepted friend (or household member) never receives another user's/household's live session, inventory, or calendar data — enforced in both the HTTP API and the WS broadcast, tested with a "stranger" session.
5. friendships.status only becomes accepted once both sides have acted — no unilateral accept.
6. An AI-suggested meal's computed cost is always ≤ the stated budget and never assumes a pantry item that isn't present, regardless of what the model says — the deterministic filter is authoritative.
7. Inventory quantity never goes negative; completing a cooked meal deducts reserved quantities exactly once (idempotent on retry).

Judged-only (documented, not tested): quality/helpfulness of AI explanations, feed "interestingness," general UX polish.

## Build order (step by step)

### Phase 0 — foundation ✅ done (6 Oct)
1. Replace the placeholder Dockerfile/placeholder/ with a real Node+TS server (keep serving / as 200 and /readme/ rendering README.md per spec/README.md — do not break the two baked-in tests at any point).
2. SQLite schema + a tiny migration runner, DB file under /data.
3. Accounts (register/login/logout), cookie-backed auth_sessions.
4. Friendships (request/accept/reject/list).
5. Recipes (CRUD: title, description, ingredients, steps, dietary tags, visibility).
6. Personal inventory (CRUD: ingredient, quantity, unit, expiry, price).
7. Personal meal calendar (add a recipe to a date, mark planned).
8. Read-only friend feed: friends' public/friends-visible recipes and planned meals (no live updates yet — plain page loads are fine here, real-time lands in Phase 2).
9. First-draft README.md (definition of good), CLAUDE.md, PROCESS.md.

### Phase 0b — full interface skeleton ✅ done (7 Oct)

Every feature has a page and a place in the navigation (sidebar groups
Kitchen / Together / Plan, mobile tab bar + `/more`).
- Working now: shopping list (`/shopping`, planned meals minus pantry, priced
  at last-paid, against the weekly budget), settings (`/settings`: profile,
  diet, dislikes, budget, default visibility/servings, password; migration
  002), cook mode (`/recipes/:id/cook`: scaling, step-by-step, timers, mark a
  planned meal cooked).
- Previews (sample data): household (`/household`, `/pantry`, `/calendar`,
  `/members`, `/new`), live cooking (`/live`, `/live/:id`, `/live/:id/along`),
  planner (`/planner`, `/planner/week`; its inputs panel reads real settings).

### Phase 1 — crit 8 target ("it's alive")

Deploy Phase 0 as the first working version.

### Phase 2 — crit 9 target ("all at once"), real-time
10. WebSocket layer + in-process room-based pub/sub.
11. Households: create/invite/join; shared inventory and shared calendar views.
12. Ingredient reservations against household inventory, live-broadcast to members (invariants 2–3).
13. Live cook sessions: start cooking → instant broadcast to friends' scrolling feed ("Alice is cooking Pad Thai"); detail view (scaled quantities, current step); "cook with Alice" companion join.
14. Document the required multi-person design decision (visibility rules + reservation-conflict resolution are the natural candidates).
15. Concurrency specs: simultaneous reservation attempts, stranger-visibility boundary, step-monotonicity.

### Phase 3 — crit 10 target ("fly by instruments"), logging + AI
16. Structured server-side request logging to stdout (Fly log capture) alongside the already-persisted cook_events domain log.
17. AI-assisted meal planner endpoint: deterministic filter → Groq for fuzzy ingredient matching + explanation text → timeout/fallback.
18. Fill out remaining spec coverage; finalize enforced-vs-judged split in README.md.

### Phase 4 — week 12 finishing

Robustness pass (reconnecting WS, resuming a session picked up the next day, slow-connection behavior), PROCESS.md rewrite, crit reflections.

## Verification

- Keep invariants.test.ts green throughout (the two baked-in checks run against the built Docker image in CI).
- Add spec/*.test.ts per invariant above, driving ≥2 concurrent HTTP/WS clients against the running app at APP_URL (pnpm check).
- Manual two-browser-profile smoke test for each live feature before marking a phase done.
- `pnpm check:evidence` once PROCESS.md is replaced.
