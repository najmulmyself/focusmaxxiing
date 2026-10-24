# focusmaxxiing

A pomodoro timer with real reports, lossless and exportable data, and **Pip** — a small ember who works when you work.

See [`PLAN.md`](./PLAN.md) for the product plan, competitor analysis, architecture, and milestones.

## Status

**Milestone 1 — brand & mascot** ✅

- `#/style` — style tile: a working timer demo (with Pip reacting), palette, type, components, report charts, dark mode
- `#/mascot` — Pip's lab: every mood live, character sheet, construction notes, scale and surface tests
- `#/assets` — the source page that brand assets are rendered from

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
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
