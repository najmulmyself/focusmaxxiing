import { useMemo, useState } from 'react'

/* Sample data only — the real reports read from the session log in milestone 4. */

const PROJECTS = [
  { name: 'Deep work', color: 'var(--series-1)' },
  { name: 'Study', color: 'var(--series-2)' },
  { name: 'Writing', color: 'var(--series-3)' },
  { name: 'Admin', color: 'var(--series-4)' },
]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// minutes per project per day
const WEEK = [
  [100, 50, 25, 25],
  [150, 25, 50, 0],
  [75, 75, 25, 25],
  [125, 0, 75, 25],
  [100, 50, 0, 50],
  [0, 100, 25, 0],
  [25, 25, 0, 0],
]

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)

interface Tip { x: number; y: number; title: string; lines: string[] }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border-2 border-line bg-surface px-3 py-2 text-xs shadow-[0_3px_0_var(--line)]"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      <div className="font-semibold">{tip.title}</div>
      {tip.lines.map((l) => (
        <div key={l} className="font-mono text-muted">{l}</div>
      ))}
    </div>
  )
}

export function WeekChart() {
  const [tip, setTip] = useState<Tip | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const W = 420
  const H = 220
  const pad = { l: 30, r: 6, t: 8, b: 26 }
  const max = 240 // 4h axis
  const ih = H - pad.t - pad.b
  const bw = 30
  const step = (W - pad.l - pad.r) / 7
  const y = (m: number) => pad.t + ih - (m / max) * ih

  return (
    <figure>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <figcaption className="display text-2xl font-semibold">This week</figcaption>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {PROJECTS.map((p) => (
            <li key={p.name} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
              {p.name}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative mt-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Focus minutes per day this week, stacked by project">
          {[0, 60, 120, 180, 240].map((m) => (
            <g key={m}>
              <line x1={pad.l} x2={W - pad.r} y1={y(m)} y2={y(m)} stroke="var(--fg-faint)" strokeOpacity={m === 0 ? 0.9 : 0.25} strokeDasharray={m === 0 ? undefined : '2 4'} />
              <text x={pad.l - 6} y={y(m) + 3.5} textAnchor="end" fontSize={10} fill="var(--fg-faint)" fontFamily="JetBrains Mono">{m / 60}h</text>
            </g>
          ))}
          {WEEK.map((day, i) => {
            const x = pad.l + step * i + (step - bw) / 2
            const total = day.reduce((a, b) => a + b, 0)
            let acc = 0
            const segs = day.map((m, k) => {
              const y0 = y(acc)
              acc += m
              const y1 = y(acc)
              // 2px surface gap between stacked segments
              return m > 0 ? <rect key={k} x={x} y={y1 + 1} width={bw} height={Math.max(0, y0 - y1 - 2)} fill={PROJECTS[k].color} /> : null
            })
            return (
              <g key={i} opacity={hover === null || hover === i ? 1 : 0.45} style={{ transition: 'opacity .15s' }}>
                <clipPath id={`bar-${i}`}>
                  <rect x={x} y={y(total)} width={bw} height={ih} rx={4} />
                </clipPath>
                <g clipPath={`url(#bar-${i})`}>{segs}</g>
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--fg-muted)" fontFamily="Instrument Sans">{DAYS[i]}</text>
                {/* generous hit target */}
                <rect
                  x={pad.l + step * i}
                  y={pad.t}
                  width={step}
                  height={ih}
                  fill="transparent"
                  onPointerEnter={(e) => {
                    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                    setHover(i)
                    setTip({
                      x: ((x + bw / 2) / W) * box.width,
                      y: (y(total) / H) * box.height,
                      title: `${DAYS[i]} · ${fmtMin(total)}`,
                      lines: day.flatMap((m, k) => (m ? [`${PROJECTS[k].name} ${fmtMin(m)}`] : [])),
                    })
                  }}
                  onPointerLeave={() => { setHover(null); setTip(null) }}
                />
              </g>
            )
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-widest text-muted">View as table</summary>
        <table className="mt-2 w-full font-mono text-xs">
          <thead><tr className="text-left text-muted"><th className="py-1">Day</th>{PROJECTS.map((p) => <th key={p.name}>{p.name}</th>)}</tr></thead>
          <tbody>{WEEK.map((d, i) => <tr key={i} className="border-t border-line/15"><td className="py-1">{DAYS[i]}</td>{d.map((m, k) => <td key={k}>{fmtMin(m)}</td>)}</tr>)}</tbody>
        </table>
      </details>
    </figure>
  )
}

/** deterministic pseudo-random so the sample looks the same every load */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

export function YearHeatmap() {
  const [tip, setTip] = useState<Tip | null>(null)
  const weeks = 53
  const cell = 11
  const gap = 2
  const data = useMemo(() => {
    const r = rng(7)
    const end = new Date(2026, 9, 24)
    const start = new Date(end)
    start.setDate(end.getDate() - (weeks * 7 - 1) + (6 - ((end.getDay() + 6) % 7)))
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const weekend = d.getDay() === 0 || d.getDay() === 6
      const ramp = 0.35 + (i / (weeks * 7)) * 0.65 // habit getting stronger through the year
      const v = r() < (weekend ? 0.35 : 0.85) * ramp + 0.1 ? Math.round(r() * 220 * ramp + 25) : 0
      return { date: d, min: d > end ? -1 : v }
    })
  }, [])
  const level = (m: number) => (m <= 0 ? 0 : m < 60 ? 1 : m < 120 ? 2 : m < 180 ? 3 : 4)
  const W = weeks * (cell + gap)
  const H = 7 * (cell + gap) + 16
  const months = data.filter((d, i) => i % 7 === 0 && d.date.getDate() <= 7)

  return (
    <figure>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <figcaption className="display text-2xl font-semibold">The year in focus</figcaption>
        <span className="font-mono text-xs uppercase tracking-widest text-muted">412h · 236 days</span>
      </div>
      <div className="relative mt-4 overflow-x-auto pb-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="Daily focus minutes over the past year">
          {months.map((d, i) => (
            <text key={i} x={Math.floor(data.indexOf(d) / 7) * (cell + gap)} y={9} fontSize={9} fill="var(--fg-faint)" fontFamily="JetBrains Mono">
              {d.date.toLocaleString('en', { month: 'short' })}
            </text>
          ))}
          {data.map((d, i) =>
            d.min < 0 ? null : (
              <rect
                key={i}
                x={Math.floor(i / 7) * (cell + gap)}
                y={16 + (i % 7) * (cell + gap)}
                width={cell}
                height={cell}
                rx={2.5}
                fill={`var(--heat-${level(d.min)})`}
                onPointerEnter={(e) => {
                  const svg = e.currentTarget.ownerSVGElement as SVGSVGElement
                  const box = svg.getBoundingClientRect()
                  const parent = svg.parentElement!.getBoundingClientRect()
                  setTip({
                    x: box.left - parent.left + ((Math.floor(i / 7) * (cell + gap) + cell / 2) / W) * box.width,
                    y: ((16 + (i % 7) * (cell + gap)) / H) * box.height,
                    title: d.date.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }),
                    lines: [d.min ? `${fmtMin(d.min)} focused` : 'No focus'],
                  })
                }}
                onPointerLeave={() => setTip(null)}
              />
            ),
          )}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 font-mono text-[11px] text-muted">
        Less
        {[0, 1, 2, 3, 4].map((l) => <span key={l} className="size-[11px] rounded-[2.5px]" style={{ background: `var(--heat-${l})` }} />)}
        More
      </div>
    </figure>
  )
}
