# focusmaxxiing — Product & Build Plan

> Status: **Draft for review** · 2026-10-24
> Goal: a Pomodoro focus timer in the spirit of pomofocus.io, built first for one user (me), with
> serious reporting, lossless data, full export, and a hand-crafted interactive mascot.

---

## 1. Competitor landscape

| Product | What it nails | Where it falls short (for us) | Price (approx., verify) |
|---|---|---|---|
| **Pomofocus.io** | Zero-friction web timer; tasks with estimated pomodoros; "finish at" estimate; templates; day/week/month reports | CSV export, projects, yearly reports and webhooks are paywalled; plain visuals; no personality; reports are shallow (no heatmap, no time-of-day insight) | Free / ~$3 mo · ~$18 yr · ~$54 lifetime |
| **Focus Friend** (Hank Green) | Emotional hook: a bean mascot knits socks while you focus and drops its needles if you leave. Hit #1 on the App Store (2025) | Mobile only; light on data and reporting; no export | Free |
| **Forest** | Proves that "consequence + cute" works: a tree grows, and dies if you leave | Little granular time data; mobile-first | ~$3.99 iOS one-time |
| **Session** (Mac/iOS) | Polished; prompts "what did you get done?" after each session; Slack status; app and site blocking | Analytics paywalled (free tier keeps 2 days); Apple-only | Free / $4.99 mo / $39.99 yr |
| **Focus To-Do** | Timer and task manager in one; cross-device sync | Dense, dated UI | Free / small subscription |
| **Toggl Track** | Best-in-class time reporting and exports | It's a time tracker, not a focus ritual; heavy | ~$9/user/mo |
| **Flow** (Mac) | Menu-bar minimalism | Mac-only; basic stats | Free / ~$1.49 mo |
| **Finch** / **Habitica** | Pet and RPG gamification that drives daily return | No real focus timer | Freemium |

### What we take from each
- **Pomofocus:** the core loop (modes, tasks with estimates, "finish at", templates) and its speed. It must load and start in under 1 second.
- **Focus Friend / Forest:** a mascot whose state *is* your focus state. It reacts to starting, finishing, pausing and abandoning.
- **Session:** the post-session reflection ("What did you get done?") and a focus-quality rating.
- **Toggl:** reporting depth and exports.

### Our angle
Everything pomofocus paywalls (CSV export, projects, yearly reports) is free and built in. Reports
go deeper (heatmap, best hours, estimate accuracy). The app has a character that makes you
*want* to open it. Data is treated as sacred: it works offline, nothing is lost, and every record
is exportable.

---

## 2. Feature scope

### MVP (v1) — "I use this every day"
**Timer**
- Modes: Focus, Short Break and Long Break, with a long break every N pomodoros. Durations are configurable.
- Auto-start breaks and pomodoros (each is a toggle).
- The countdown is computed from wall-clock timestamps, so it never drifts, even in a background tab.
- Live countdown in the tab title and favicon.
- Pop-out mini timer using Document Picture-in-Picture, so it stays visible over other windows.
- Desktop notifications, alarm sounds and optional ambient sounds (rain, café, brown noise).
- Keyboard shortcuts: `Space` start/pause, `S` skip, `R` reset, `1/2/3` switch modes, `N` new task.

**Tasks & projects**
- Tasks with estimated and completed pomodoros, notes, and a "Done" state.
- Projects (with colour) and tags. A session belongs to a task and, through it, to a project.
- Templates for recurring task sets, with no limit.
- "Finish at HH:MM" estimate for today's remaining work.

**Reflection**
- After each focus session there is an optional one-line "what did I get done", a 1–5 focus-quality rating and an "interrupted?" flag.
- Manual entry or editing of past sessions, for forgotten timers.

**Reports**
- Today, week, month and year views, plus a custom range.
- Focus hours per day (bar chart), split by project.
- A GitHub-style year heatmap.
- Streaks: current and longest.
- Best focus hours (time-of-day distribution).
- Estimate accuracy: estimated vs actual pomodoros per task.
- Completion vs abandonment rate, and average focus quality.
- Detailed session log table with filter, search and edit.

**Data**
- Offline-first: works with no network, then syncs.
- Export to CSV (sessions, tasks), JSON (full backup) and `.ics` (sessions as calendar events).
- Import from a JSON backup.
- Mirror to Google Sheets (see §4).

**Mascot**
- Interactive character with state-driven animation (see §5).

### v2 — nice to have
- PWA install on phone and desktop, with home-screen widgets via the PWA where supported.
- Webhooks (Zapier, n8n) on session complete.
- Daily and weekly goal targets, with the mascot reacting to progress.
- Weekly email or in-app review: "You focused 14h, +2h vs last week, best day Tuesday."
- Todoist and Google Calendar import of tasks and events.
- Cosmetic unlockables for the mascot, earned by focus hours (never paid; no dark patterns).
- Multi-user SaaS mode: sign-up, billing (Stripe), and per-user data isolation. The schema is user-scoped from day one, so this is a switch-on, not a rewrite.

### Explicitly out of scope (for now)
App and website blocking (it needs native apps), native mobile apps, and team features.

---

## 3. Design direction — "modern, not AI slop"

**Avoid:** purple-to-blue gradients, glassmorphism cards, sparkle emoji, generic Inter-everywhere
layouts, "✨ Supercharge your productivity" copy, and stock 3D blobs.

**Do:**
- **Concept: a warm, tactile desk object.** The timer feels like a physical thing, like a kitchen timer or a well-made clock face, not a dashboard.
- **Palette:** off-white paper (`#F4EFE6`) and ink (`#1D1B18`). Each mode gets one confident accent that floods the background (the way pomofocus does, but with our own colours):
  - Focus: tomato-vermilion `#E4572E`
  - Short break: sage `#7FA38A`
  - Long break: dusk blue `#3E5C76`

  There is a real dark mode (warm charcoal, not pure black).
- **Type:** a characterful display face for numerals and headings (candidates: *Fraunces*, *Instrument Serif* or *Bricolage Grotesque*), a tabular mono for the countdown digits so they don't jitter, and a neutral sans for UI text. A final pick will come from a side-by-side type test.
- **Motion:** springy and physical (Motion/Framer springs). Mode changes flood colour from the timer outward. Buttons have a pressed-down tactile state. Animations are restrained and respect `prefers-reduced-motion`.
- **Texture:** subtle paper grain, hand-drawn icon set (custom, consistent stroke), and illustrated empty states drawn by the mascot.
- **Layout:** single-screen timer, with tasks below and reports on their own page. Built mobile-first and fully keyboard-driven on desktop.

Deliverable before UI build: a **style tile** (palette, type, buttons, timer face, mascot in context)
for approval.

---

## 4. Architecture & data (the "no data will be lost" part)

### Recommendation
**Local-first web app + Cloudflare (Workers + D1) backend + Google Sheets mirror + exports.**

```
 Browser (PWA)                                 Cloudflare
 ┌──────────────────────────────┐            ┌────────────────────────────┐
 │ React UI + mascot            │            │ Worker API (Hono)          │
 │ IndexedDB (Dexie) = truth    │──sync────▶ │ D1 (SQLite) = durable copy │
 │ Outbox queue (retry forever) │◀─pull──────│ Time Travel: 30-day restore│
 └──────────────────────────────┘            │ Cron: nightly JSON → R2    │
                                             │ Cron: append rows → Sheets │
                                             └────────────────────────────┘
```

**Why not Google Sheets as the primary database?** It is slow, rate-limited (around 60
writes/min per user), has no transactions, and is easy to corrupt by editing a cell by hand. It
works well as a **human-readable mirror and backup**: you can open your history in Sheets
anytime, but the app doesn't depend on it.

**Why Cloudflare D1 rather than Supabase?** Both have generous free tiers. Supabase's free projects
pause after a week of inactivity, while D1 doesn't, and D1 has built-in point-in-time restore
("Time Travel"). Supabase is a fine alternative if Postgres or its auth UI is preferred.

### Data-safety guarantees
1. **Append-only session log.** Every session is an immutable record with a client-generated UUID. Edits create a new revision; nothing is overwritten in place.
2. **Running timers survive crashes.** The current timer is persisted on every state change as `{mode, startedAt, pausedAt, accumulatedMs}`. A refresh, closed tab or laptop sleep resumes correctly.
3. **Outbox sync.** Writes land in IndexedDB first, then a queue pushes them to the server with retries. Syncs are idempotent by UUID, so duplicates are impossible. `navigator.storage.persist()` is requested so the browser won't evict data.
4. **Four independent copies:** browser IndexedDB, D1 (with 30-day Time Travel), a nightly JSON snapshot in R2 (kept 90 days), and the Google Sheets mirror.
5. **One-click export and restore:** JSON backup in, JSON backup out. This is tested in CI with a round-trip test.

### Core schema (user-scoped from day one)
```
users(id, email, created_at, settings_json)
projects(id, user_id, name, color, archived, created_at, updated_at)
tasks(id, user_id, project_id, title, notes, est_pomodoros, done, created_at, updated_at, deleted_at)
sessions(id, user_id, task_id, mode, planned_sec, actual_sec,
         started_at, ended_at, status[completed|skipped|abandoned],
         interrupted, quality, note, device, revision, created_at)
templates(id, user_id, name, tasks_json)
```

### Stack
| Layer | Choice | Why |
|---|---|---|
| Frontend | **Vite + React + TypeScript** | Fast, simple SPA; no SSR needed for a timer |
| Styling | Tailwind CSS v4 + CSS variables for theme tokens | Fast iteration, easy mode theming |
| Animation | Motion (Framer Motion) + SVG | Springs, gestures, layout animation |
| Local DB | Dexie (IndexedDB) | Mature, reactive queries |
| Charts | Visx or hand-rolled SVG | Full control over the look; no default-chart aesthetic |
| Backend | Cloudflare Workers + Hono + D1 + R2 | Free tier, no cold starts, no pausing |
| Auth | Google sign-in (Better Auth or Cloudflare Access for single-user mode) | One click, and the same account is used for Sheets |
| Sheets | Google Sheets API from a Worker cron | Mirror and backup |
| Tests | Vitest (unit), Playwright (E2E: timer accuracy, offline→sync, export round-trip) | |
| Hosting | Cloudflare Pages | Same platform; free |

---

## 5. Mascot

### Role
The mascot is the UI's emotional state machine. It reflects the timer, not decoration.

| Timer state | Mascot behaviour |
|---|---|
| Idle | Breathes, blinks, eyes follow the cursor, occasionally fidgets |
| Focus running | Settles into "work mode" with a small looping task animation, then gets steadier and more absorbed as the session goes on |
| Paused | Looks up at you, curious |
| Last 60 seconds | Perks up in anticipation |
| Focus complete | Celebration with a satisfying sound |
| Break | Stretches, sips something, lounges |
| Abandoned or reset mid-focus | Gentle disappointment, never guilt-trippy |
| Streak milestone | A special one-off animation |
| Click or poke | Reacts by squishing or giggling. It's an easter egg that makes it feel alive |

### Concepts (pick one)
1. **"Pip" — a small ember/flame sprite** (recommended). Focus literally "burns" steadily, breaks let it flicker softly, and finishing makes it flare. It ties naturally to the vermilion focus colour, it's simple enough to animate expressively in SVG, and it's ownable (not a tomato, not a bean).
2. **"Mochi" — a squishy round blob creature.** It's maximally expressive through squash and stretch, but it reads closer to existing "cute blob" mascots.
3. **"Tock" — a tiny living kitchen timer with legs.** It's on-theme and charming, but closer to the pomodoro-tomato cliché.

### Production approach
- Hand-built **layered SVG** (body, face, eyes, limbs, and effects as separate parts) driven by a **code state machine** (XState or a small reducer) and Motion springs. This keeps it small (under 30 KB), crisp at any size, and fully interactive (cursor tracking, poke reactions). It also needs no external tools, so I can build it end to end.
- Assets to create first, at high effort, before the app UI:
  1. A character sheet: turnaround, expression set (8 or more), and colour variants per mode.
  2. The animated SVG component with all states above, viewable in a standalone playground page.
  3. Favicon, PWA icons, social card and empty-state illustrations, all from the same character.
- Optional later upgrade: rebuild in **Rive**, which offers richer state-machine animation, if you want to hand it to a motion designer.

---

## 6. Milestones

| # | Milestone | Output | Est. |
|---|---|---|---|
| 0 | Plan sign-off | This doc, with decisions in §8 answered | — |
| 1 | **Brand & mascot** | Style tile; mascot character sheet; animated mascot playground | 2–3 days |
| 2 | **Core timer (local only)** | Timer, modes, settings, sounds, notifications, crash-safe state, PiP, shortcuts | 2–3 days |
| 3 | **Tasks & projects** | Tasks, estimates, projects, templates, finish-at, post-session reflection | 2 days |
| 4 | **Reports** | All report views, heatmap, session log with edit | 3 days |
| 5 | **Export & backup** | CSV, JSON, ICS export; JSON import; round-trip tests | 1 day |
| 6 | **Backend & sync** | Worker API, D1, auth, outbox sync, nightly R2 snapshot | 2–3 days |
| 7 | **Google Sheets mirror** | Cron append to your sheet | 1 day |
| 8 | **Polish & deploy** | PWA, dark mode, a11y pass, reduced motion, Lighthouse ≥ 95, deploy to Cloudflare | 2 days |

That's about 2.5–3 weeks of focused build. After milestone 5 the app is fully usable locally, so
you can start tracking before sync exists, and no data is lost: it all syncs up once milestone 6
lands.

---

## 7. Success criteria
- Timer accuracy within ±1 s over a 50-minute session in a background tab.
- Killing the tab mid-session and reopening it resumes correctly.
- Going offline for a day, doing 10 sessions, then reconnecting gives 10 sessions on the server with zero duplicates.
- Export → wipe → import gives an identical dataset (automated test).
- Opening the app to a running timer takes under 1 second.

---

## 8. Decisions needed from you
1. **Mascot concept:** Pip (ember, recommended), Mochi (blob) or Tock (timer creature)?
2. **Backend:** Cloudflare D1 (recommended) or Supabase, and do you want the Google Sheets mirror in v1?
3. **Scope:** just you for now (single-user, Google sign-in locked to your email), with SaaS multi-user later. OK?
4. **Primary device:** desktop browser, phone, or both equally?
5. **Name/brand:** keep "focusmaxxiing" as the product name, or is that just the repo?
