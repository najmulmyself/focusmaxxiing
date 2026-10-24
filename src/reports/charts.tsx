import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { addDays, dayKey, fmtDuration, startOfDay, type Bucket } from './stats'

/*
 * Charts are hand-drawn SVG. Rules (from the dataviz checklist): one y-axis,
 * thin marks with 4px rounded data ends, 2px surface gaps between stacked
 * segments, recessive grid, a hover tooltip on every mark, legend + table view.
 */

export interface Series {
  key: string
  name: string
  color: string
}

/** Track an element's width so charts draw at 1:1 and labels stay readable on phones. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

interface Tip {
  x: number
  y: number
  title: string
  lines: string[]
}

export function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none absolute z-10 w-max max-w-56 -translate-x-1/2 -translate-y-full rounded-lg border-2 border-line bg-surface px-3 py-2 text-xs text-fg shadow-[0_3px_0_var(--line)]"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      <div className="font-semibold">{tip.title}</div>
      {tip.lines.map((l, i) => (
        <div key={i} className="font-mono text-muted">{l}</div>
      ))}
    </div>
  )
}

/** Hour-based ticks: picks a step so there are 3–5 gridlines. */
export function hourTicks(maxSec: number): { max: number; ticks: number[] } {
  const maxH = Math.max(maxSec / 3600, 0.25)
  const steps = [0.25, 0.5, 1, 2, 3, 4, 5, 10, 20, 25, 50, 100, 200, 500]
  const step = steps.find((s) => maxH / s <= 4) ?? 1000
  const top = Math.ceil(maxH / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v * 3600)
  return { max: top * 3600, ticks }
}

const tickLabel = (sec: number) => {
  const h = sec / 3600
  return h === 0 ? '0' : h < 1 ? `${Math.round(h * 60)}m` : `${+h.toFixed(2)}h`
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.name}
        </li>
      ))}
    </ul>
  )
}

export function TableView({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-mono text-xs uppercase tracking-widest text-muted">View as table</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full font-mono text-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted">{head.map((h) => <th key={h} className="py-1 pr-3 font-normal">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line/15">{r.map((c, j) => <td key={j} className="py-1 pr-3">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** Stacked bars of focus time per bucket, split by series (projects). */
export function StackedBars({ buckets, data, series, height = 220 }: { buckets: Bucket[]; data: Map<string, number>[]; series: Series[]; height?: number }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const totals = data.map((m) => [...m.values()].reduce((a, b) => a + b, 0))
  const { max, ticks } = hourTicks(Math.max(0, ...totals))
  const [box, W] = useWidth<HTMLDivElement>(640)
  const H = height
  const pad = { l: 36, r: 4, t: 10, b: 24 }
  const ih = H - pad.t - pad.b
  const step = (W - pad.l - pad.r) / buckets.length
  const bw = Math.max(2, Math.min(36, step * 0.62))
  const y = (sec: number) => pad.t + ih - (sec / max) * ih
  const uid = useRef(`sb${Math.random().toString(36).slice(2, 8)}`).current

  // thin out axis labels when bars get narrow
  const every = Math.ceil(28 / step)
  return (
    <div>
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Focus time per period, stacked by project">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--fg-faint)" strokeOpacity={v === 0 ? 0.9 : 0.25} strokeDasharray={v === 0 ? undefined : '2 4'} />
              <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--fg-faint)" fontFamily="JetBrains Mono, monospace">{tickLabel(v)}</text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x = pad.l + step * i + (step - bw) / 2
            let acc = 0
            return (
              <g key={b.key} opacity={hover === null || hover === i ? 1 : 0.45} style={{ transition: 'opacity .15s' }}>
                {totals[i] > 0 && (
                  <>
                    <clipPath id={`${uid}-${i}`}>
                      <rect x={x} y={y(totals[i])} width={bw} height={ih} rx={Math.min(4, bw / 2)} />
                    </clipPath>
                    <g clipPath={`url(#${uid}-${i})`}>
                      {series.map((s) => {
                        const v = data[i].get(s.key) ?? 0
                        if (!v) return null
                        const y0 = y(acc)
                        acc += v
                        const y1 = y(acc)
                        const gap = acc < totals[i] - 1e-6 ? 2 : 0
                        return <rect key={s.key} x={x} y={y1 + gap} width={bw} height={Math.max(0, y0 - y1 - gap)} fill={s.color} />
                      })}
                    </g>
                  </>
                )}
                {b.label && (buckets.length <= 12 || i % every === 0) && (
                  <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize={10.5} fill="var(--fg-muted)" fontFamily="Instrument Sans, sans-serif">{b.label}</text>
                )}
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
                      y: (y(totals[i]) / H) * box.height,
                      title: `${b.long} · ${fmtDuration(totals[i])}`,
                      lines: series.flatMap((s) => (data[i].get(s.key) ? [`${s.name} ${fmtDuration(data[i].get(s.key)!)}`] : [])),
                    })
                  }}
                  onPointerLeave={() => {
                    setHover(null)
                    setTip(null)
                  }}
                />
              </g>
            )
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <TableView
        head={['', ...series.map((s) => s.name), 'Total']}
        rows={buckets.map((b, i) => [b.long, ...series.map((s) => fmtDuration(data[i].get(s.key) ?? 0)), fmtDuration(totals[i])])}
      />
    </div>
  )
}

/** Focus by hour of day. Single series, so no legend: the title names it. */
export function HourBars({ profile, highlight }: { profile: number[]; highlight?: { start: number; width: number } | null }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const { max, ticks } = hourTicks(Math.max(...profile))
  const [box, W] = useWidth<HTMLDivElement>(480)
  const H = 170
  const pad = { l: 34, r: 4, t: 8, b: 22 }
  const ih = H - pad.t - pad.b
  const step = (W - pad.l - pad.r) / 24
  const bw = step * 0.7
  const y = (v: number) => pad.t + ih - (v / max) * ih
  const hourName = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString('en', { hour: 'numeric' })
  const labelEvery = W < 360 ? 6 : 3
  return (
    <div>
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Focus time by hour of day">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--fg-faint)" strokeOpacity={v === 0 ? 0.9 : 0.25} strokeDasharray={v === 0 ? undefined : '2 4'} />
              <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--fg-faint)" fontFamily="JetBrains Mono, monospace">{tickLabel(v)}</text>
            </g>
          ))}
          {profile.map((v, h) => {
            const x = pad.l + step * h + (step - bw) / 2
            const inBest = highlight && h >= highlight.start && h < highlight.start + highlight.width
            return (
              <g key={h}>
                {v > 0 && <rect x={x} y={y(v)} width={bw} height={y(0) - y(v)} rx={Math.min(3, bw / 2)} fill={inBest ? 'var(--series-1)' : 'color-mix(in oklab, var(--series-1) 45%, var(--surface))'} />}
                {h % labelEvery === 0 && (
                  <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--fg-muted)" fontFamily="JetBrains Mono, monospace">{h}</text>
                )}
                <rect
                  x={pad.l + step * h}
                  y={pad.t}
                  width={step}
                  height={ih}
                  fill="transparent"
                  onPointerEnter={(e) => {
                    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                    setTip({ x: ((x + bw / 2) / W) * box.width, y: (y(v) / H) * box.height, title: `${hourName(h)}–${hourName((h + 1) % 24)}`, lines: [fmtDuration(v)] })
                  }}
                  onPointerLeave={() => setTip(null)}
                />
              </g>
            )
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <TableView head={['Hour', 'Focus']} rows={profile.map((v, h) => [hourName(h), fmtDuration(v)])} />
    </div>
  )
}

/** Past-year calendar heatmap ending on `end`, one column per week (Mon–Sun). */
export function YearHeatmap({ daily, end }: { daily: Map<string, number>; end: number }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const weeks = 53
  const cell = 11
  const gap = 2
  const days = useMemo(() => {
    const last = startOfDay(end)
    const lastCol = addDays(last, 6 - ((new Date(last).getDay() + 6) % 7))
    const first = addDays(lastCol, -(weeks * 7 - 1))
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const t = addDays(first, i)
      return { t, key: dayKey(t), future: t > last }
    })
  }, [end])
  const level = (sec: number) => (sec <= 0 ? 0 : sec <= 50 * 60 ? 1 : sec <= 100 * 60 ? 2 : sec <= 150 * 60 ? 3 : 4)
  const W = weeks * (cell + gap)
  const H = 7 * (cell + gap) + 16
  const total = days.reduce((a, d) => a + (d.future ? 0 : daily.get(d.key) ?? 0), 0)
  const active = days.filter((d) => !d.future && (daily.get(d.key) ?? 0) > 0).length

  return (
    <figure>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <figcaption className="display text-2xl font-semibold">The year in focus</figcaption>
        <span className="font-mono text-xs uppercase tracking-widest text-muted">
          {fmtDuration(total)} · {active} days
        </span>
      </div>
      <div className="relative mt-4 overflow-x-auto pb-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[620px]" role="img" aria-label="Daily focus over the past year">
          {days.map((d, i) =>
            i % 7 === 0 && new Date(d.t).getDate() <= 7 ? (
              <text key={`m${i}`} x={Math.floor(i / 7) * (cell + gap)} y={9} fontSize={9} fill="var(--fg-faint)" fontFamily="JetBrains Mono, monospace">
                {new Date(d.t).toLocaleString('en', { month: 'short' })}
              </text>
            ) : null,
          )}
          {days.map((d, i) => {
            if (d.future) return null
            const sec = daily.get(d.key) ?? 0
            const x = Math.floor(i / 7) * (cell + gap)
            const yy = 16 + (i % 7) * (cell + gap)
            return (
              <rect
                key={d.key}
                x={x}
                y={yy}
                width={cell}
                height={cell}
                rx={2.5}
                fill={`var(--heat-${level(sec)})`}
                onPointerEnter={(e) => {
                  const svg = e.currentTarget.ownerSVGElement as SVGSVGElement
                  const box = svg.getBoundingClientRect()
                  const parent = svg.parentElement!.getBoundingClientRect()
                  setTip({
                    x: box.left - parent.left + svg.parentElement!.scrollLeft + ((x + cell / 2) / W) * box.width,
                    y: (yy / H) * box.height,
                    title: new Date(d.t).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
                    lines: [sec ? `${fmtDuration(sec)} focused` : 'No focus'],
                  })
                }}
                onPointerLeave={() => setTip(null)}
              />
            )
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 font-mono text-[11px] text-muted">
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="size-[11px] rounded-[2.5px]" style={{ background: `var(--heat-${l})` }} />
        ))}
        More
        <span className="ml-2 text-faint">· 1 step ≈ 2 pomodoros</span>
      </div>
    </figure>
  )
}
