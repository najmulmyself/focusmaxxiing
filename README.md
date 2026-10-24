# focusmaxxiing

A pomodoro timer with real reports, lossless and exportable data, and **Pip** — a small ember who works when you work.

See [`PLAN.md`](./PLAN.md) for the product plan, competitor analysis, architecture, and milestones.

## Status

**Milestone 4 — reports** ✅ · Milestone 3 — tasks & projects ✅ · Milestone 2 — core timer ✅ · [Milestone 1 — brand & mascot](./PLAN.md#9-milestone-1-outcome) ✅

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
