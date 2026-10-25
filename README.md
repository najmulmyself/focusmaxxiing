# focusmaxxiing

A pomodoro timer with real reports, lossless and exportable data, and **Pip** — a small ember who works when you work.

See [`PLAN.md`](./PLAN.md) for the product plan, competitor analysis, architecture, and milestones.

## Status

**Milestone 7 — Google Sheets mirror** (built; switches on once a sheet is connected) · Milestone 6 — cloud sync ✅ · Milestone 5 — export & backup ✅ · Milestone 4 — reports ✅ · Milestone 3 — tasks & projects ✅ · Milestone 2 — core timer ✅ · [Milestone 1 — brand & mascot](./PLAN.md#9-milestone-1-outcome) ✅

- `#/` — the timer: focus / short / long break, Pip reacting live, tasks & projects, today's log
- `#/reports` — reports: day / week / month / year / custom, by project, streaks, best hours, estimates, year heatmap, editable session log
- `#/style` — style tile (design reference)
- `#/mascot` — Pip's lab: every mood, character sheet
- `#/assets` — source page for rendered brand assets

### Timer guarantees
- **No drift.** Time is computed from wall-clock timestamps, and ticks come from a Web Worker so background tabs stay on time.
- **Survives anything.** The timer state is saved on every change, so a reload, crash or closed laptop resumes exactly where it was. A session that ends while the app is closed is logged with its real end time.
- **Every session is logged** to IndexedDB (completed, skipped, or unfinished if it ran over a minute). Writes are idempotent; if IndexedDB fails they're parked in localStorage and retried.
- **Several tabs open?** One tab leads (Web Locks) — one alarm, one log entry; the others mirror it.

### Tasks
- Tasks with estimated pomodoros, notes and a project; drag to reorder; click a task to work on it.
- Each completed focus session is credited to the selected task (and its project) — counts like `2/4` come straight from the session log.
- **Finish at** walks your remaining pomodoros forward, with short and long breaks placed exactly as the timer will.
- After each focus: an optional one-liner on what you got done and a 1–5 focus rating, saved onto the session.
- Templates for recurring lists (unlimited). Clearing or deleting tasks never deletes their history.

### Reports
- **Tiles:** focus time (vs the previous period), pomodoros, streak, completion rate, average focus rating.
- **Charts:** focus per hour/day/month stacked by project; focus by hour of day with your strongest two-hour window; share per project; estimate vs actual for finished tasks; a year heatmap.
- **Project filter** applies to everything on the page (streaks stay global).
- **Session log:** search, filter, edit any session, add one you forgot to time, delete with undo. Edits bump the session's revision; deletes are soft.
- **Sample data:** explore the reports before you have history; it's labelled and removes cleanly without touching real sessions.

### Your data
- **Full backup (.json):** everything, including deleted rows and settings, so a restore is exact. Settings → Your data, or Reports → Export.
- **Restore:** *Merge* (default) adds what's missing and keeps the newer copy of anything edited, and never deletes. *Replace* makes this browser an exact copy of the backup, behind a confirmation. Files are validated first and imported in one transaction: all of it lands or none of it does.
- **Sessions / tasks (.csv):** UTF-8 with BOM for Excel, RFC 4180 quoting, guarded against formula injection; local and UTC times.
- **Calendar (.ics):** focus sessions as events (RFC 5545, escaped and folded), for any calendar app.
- The timer footer reminds you when you haven't backed up in a week.

### Sync & Google Sheets
- **Cloud sync:** sign in with Google in Settings → Sync. Every device keeps its own full copy and syncs through Cloudflare D1; the newest edit wins, and work done offline uploads when you reconnect.
- **Google Sheets mirror:** an hourly Worker rewrites *Sessions*, *Tasks* and *Projects* tabs in your sheet, with real dates and times in the sheet's own time zone. Hours with no changes make no Google calls; once a day it rewrites anyway, so hand edits to those tabs don't linger. Put your own formulas and pivots in other tabs. It is a read-only copy: the app never reads from it.

### Shortcuts
`Space` start/pause · `R` reset · `S` skip · `1` `2` `3` modes · `P` pop-out timer · `M` mute ambient · `,` settings · `?` all shortcuts

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run e2e        # end-to-end durability tests (Playwright, fake clock)
npm run build      # typecheck + production build
npm run icons      # with the dev server running: re-render public/ icons, og image, favicon
```

Pushes to `main` deploy to [focusmaxxiing.pages.dev](https://focusmaxxiing.pages.dev) once CI passes: D1 migrations, then Cloudflare Pages. It needs a `CLOUDFLARE_API_TOKEN` repository secret with *Cloudflare Pages: Edit*, *D1: Edit* and *Workers Scripts: Edit*. To deploy by hand: `npx wrangler login`, then `npm run db:migrate`, `npm run deploy` and `npm run deploy:mirror`.

To switch on the Google Sheets mirror:
1. In Google Cloud, enable the **Google Sheets API**, create a **service account**, and download a JSON key for it.
2. Share your sheet with the service account's email as an **Editor**.
3. Put the sheet's id (from `docs.google.com/spreadsheets/d/<id>/edit`) in `SHEET_ID` in [`mirror/wrangler.toml`](./mirror/wrangler.toml).
4. In Cloudflare: Workers → `focusmaxxiing-mirror` → Settings → Variables and secrets, add the whole JSON key as the secret `GOOGLE_SERVICE_ACCOUNT`.

Run it locally with `npx wrangler dev -c mirror/wrangler.toml --test-scheduled`, then open `/__scheduled`.

## Pip

`src/mascot/Pip.tsx` is a self-contained React component — procedural SVG, no assets, no animation library.

```tsx
<Pip mood="focus" progress={0.4} size={320} />
```

| mood | when |
|---|---|
| `idle` | timer not started — eyes follow the cursor, waves hello, dozes off if ignored |
| `focus` | focus running — hammers sparks off an anvil, burns taller with `progress` |
| `paused` | focus paused — hammer up, looks at you |
| `almost` | final minute — faster strikes, glances up grinning |
| `celebrate` | pomodoro complete — hops and confetti |
| `shortBreak` | sips tea |
| `longBreak` | burns blue and stretches |
| `sad` | focus abandoned — a puff of smoke |
| `sleepy` | dozing |

Tap Pip to poke it (five quick pokes for a surprise). Honours `prefers-reduced-motion`.
