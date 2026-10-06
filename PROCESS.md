# Process overview

## From brief to plan

I wanted to build something useful rather than decorative, so I brainstormed
problems where several people act on the same state. I settled on cooking: a
shared pantry goes stale, recipes are worth sharing, and "who's cooking right
now" is real-time by nature. When the agent kept pushing a minimal version, I
pushed back and had it plan the full platform instead. That plan lives in
`CLAUDE.md`, with each phase mapped to a crit.

## Harness

`CLAUDE.md` starts with rules the agent must follow. Never break the two
baked-in checks. Every visibility decision goes through one file. Escape all
HTML. Never edit a shipped migration. Previews must say they're previews.
Each invariant in the plan has a matching test in `spec/`, so the plan, the
tests and the README make the same claims.

## Stack

Node 24 runs TypeScript directly, with no build step and no framework.
SQLite sits on the Fly volume, which suits one machine with one disk. Pages
are server-rendered and work without JavaScript. WebSockets come in crit 9.
I kept it small so it fits the 256 MB machine and stays easy to reason about.

## Workflow

I used plan mode first, approved the plan, then let the agent build each
slice end to end. I checked the work three ways: `pnpm check` (48 tests
against the running app and the Docker image), screenshots at desktop and
phone widths in light and dark mode, and clicking through with demo data. The
tests caught a privacy bug where the autocomplete leaked other users'
ingredient names. When I asked for every feature to have a page, real pages
were built where the data already existed (shopping list, settings, cook
mode), and the rest became previews with sample data.
