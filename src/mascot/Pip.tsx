import { useEffect, useId, useRef, useState } from 'react'
import { Spring, clamp, deg, easeInOut, flamePath, lerp, mixHex } from './physics'

/**
 * Pip — the focusmaxxiing ember sprite.
 *
 * Everything is procedural SVG: the flame outline is regenerated every frame,
 * limbs and squash are springs, and a `mood` decides the behaviour loop.
 * The parent only says *what* is happening (mood + progress); Pip decides how
 * to act it out.
 */

export type PipMood =
  | 'idle'
  | 'focus'
  | 'paused'
  | 'almost'
  | 'celebrate'
  | 'shortBreak'
  | 'longBreak'
  | 'sad'
  | 'sleepy'

export const PIP_MOODS: PipMood[] = ['idle', 'focus', 'paused', 'almost', 'celebrate', 'shortBreak', 'longBreak', 'sad', 'sleepy']

type Eyes = 'open' | 'wide' | 'half' | 'happy' | 'closed' | 'dizzy'
type Mouth = 'smile' | 'focus' | 'open' | 'o' | 'frown' | 'w' | 'grin' | 'content'
type Brows = 'none' | 'determined' | 'worried' | 'raised'

interface MoodSpec {
  height: number
  width: number
  /** flicker amplitude */
  amp: number
  /** flicker speed */
  speed: number
  armL: number
  armR: number
  eyes: Eyes
  mouth: Mouth
  brows: Brows
  /** follow the cursor with the eyes */
  track: boolean
  anvil: number
  mug: number
  /** 0 = warm ember, 1 = blue flame */
  tint: number
  /** 0 = full colour, 1 = ashen */
  desat: number
  glow: number
  label: string
}

const MOODS: Record<PipMood, MoodSpec> = {
  idle:       { height: 1,    width: 1,    amp: 0.55, speed: 1,   armL: 18,  armR: 18,  eyes: 'open',   mouth: 'smile',   brows: 'none',       track: true,  anvil: 0, mug: 0, tint: 0, desat: 0, glow: 0.55, label: 'Pip is hanging out' },
  focus:      { height: 1.04, width: 1,    amp: 0.3,  speed: 1.25,armL: 30,  armR: 74,  eyes: 'open',   mouth: 'focus',   brows: 'determined', track: false, anvil: 1, mug: 0, tint: 0, desat: 0, glow: 0.75, label: 'Pip is forging away, focused' },
  paused:     { height: 0.97, width: 1,    amp: 0.5,  speed: 0.9, armL: 22,  armR: 160, eyes: 'wide',   mouth: 'o',       brows: 'raised',     track: true,  anvil: 1, mug: 0, tint: 0, desat: 0, glow: 0.5,  label: 'Pip paused and is looking at you' },
  almost:     { height: 1.12, width: 1.02, amp: 0.4,  speed: 1.5, armL: 30,  armR: 74,  eyes: 'open',   mouth: 'grin',    brows: 'determined', track: false, anvil: 1, mug: 0, tint: 0, desat: 0, glow: 0.95, label: 'Pip is almost done' },
  celebrate:  { height: 1.22, width: 1.04, amp: 0.8,  speed: 1.6, armL: 150, armR: 150, eyes: 'happy',  mouth: 'open',    brows: 'none',       track: false, anvil: 0, mug: 0, tint: 0, desat: 0, glow: 1,    label: 'Pip is celebrating' },
  shortBreak: { height: 0.88, width: 1.03, amp: 0.6,  speed: 0.6, armL: 14,  armR: 34, eyes: 'half',   mouth: 'content', brows: 'none',       track: true,  anvil: 0, mug: 1, tint: 0, desat: 0, glow: 0.45, label: 'Pip is sipping tea on a break' },
  longBreak:  { height: 0.9,  width: 1.04, amp: 0.55, speed: 0.55,armL: 12,  armR: 12,  eyes: 'half',   mouth: 'content', brows: 'none',       track: true,  anvil: 0, mug: 0, tint: 1, desat: 0, glow: 0.5,  label: 'Pip is cooling down on a long break' },
  sad:        { height: 0.72, width: 1.06, amp: 0.2,  speed: 0.5, armL: 6,   armR: 6,   eyes: 'open',   mouth: 'frown',   brows: 'worried',    track: false, anvil: 0, mug: 0, tint: 0, desat: 1, glow: 0.15, label: 'Pip is a little disappointed' },
  sleepy:     { height: 0.8,  width: 1.05, amp: 0.25, speed: 0.4, armL: 8,   armR: 8,   eyes: 'closed', mouth: 'o',       brows: 'none',       track: false, anvil: 0, mug: 0, tint: 0, desat: 0.25, glow: 0.3, label: 'Pip is dozing' },
}

const INK = '#1D1B18'
const PAL = {
  body: '#FFB547', back: '#FF7A2F', core: '#FFF1C9',
  bodyBlue: '#8CC3EC', backBlue: '#4F8FC9', coreBlue: '#EEF8FF',
  ash: '#CDBFAA', ashBack: '#A8978A', ashCore: '#EEE6DA',
  cheek: '#FF6F61', tongue: '#FF8A8F',
}
const CONFETTI = ['#E4572E', '#7FA38A', '#3E5C76', '#FFB547', '#1D1B18', '#FFF1C9']

type Kind = 'spark' | 'ember' | 'confetti' | 'smoke' | 'steam' | 'z' | 'heart'
interface Particle {
  kind: Kind
  x: number; y: number; vx: number; vy: number
  life: number; max: number; size: number
  rot: number; vr: number; color: string
}

export interface PipProps {
  mood?: PipMood
  /** 0..1 progress through the current session; Pip burns steadier and taller as it rises */
  progress?: number
  /** css size (width); height follows the 1:1 viewBox */
  size?: number | string
  /** cursor tracking + poke reactions */
  interactive?: boolean
  /** render a single settled frame, no animation loop (icons, thumbnails) */
  still?: boolean
  /** let Pip doze off after this many seconds of idle without interaction (0 = never) */
  dozeAfter?: number
  className?: string
  onPoke?: (count: number) => void
}

export function Pip({
  mood = 'idle',
  progress = 0,
  size = 240,
  interactive = true,
  still = false,
  dozeAfter = 90,
  className,
  onPoke,
}: PipProps) {
  const uid = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const [, setTick] = useState(0)

  const reduced = useRef(false)
  const inputs = useRef({ mood, progress, interactive, dozeAfter, onPoke })
  inputs.current = { mood, progress, interactive, dozeAfter, onPoke }

  const sim = useRef<Sim | null>(null) as { current: Sim }
  if (!sim.current) sim.current = createSim(mood)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduced.current = mq.matches
    const onChange = () => (reduced.current = mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // pointer tracking for the eyes
  useEffect(() => {
    if (!interactive || still) return
    const onMove = (e: PointerEvent) => {
      const s = sim.current
      s.pointer = { x: e.clientX, y: e.clientY }
      s.lastInteraction = s.t
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [interactive, still])

  // animation loop
  useEffect(() => {
    const s = sim.current
    if (still) {
      // skip past entrance behaviour (hello wave) and any blink
      s.t = 5
      s.nextBlink = Infinity
      step(s, 1 / 60, { ...inputs.current, dozeAfter: 0 }, true, svgRef.current)
      settle(s)
      setTick((n) => n + 1)
      return
    }
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      // clamp dt so a backgrounded tab doesn't explode the springs on return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      step(s, dt, inputs.current, reduced.current, svgRef.current)
      setTick((n) => (n + 1) % 1_000_000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [still])

  const poke = () => {
    if (!interactive) return
    const s = sim.current
    s.lastInteraction = s.t
    s.sp.sy.kick(-3.2)
    s.sp.sx.kick(2.4)
    s.pokeUntil = s.t + 0.65
    s.pokes = s.pokes.filter((p) => s.t - p < 2.2)
    s.pokes.push(s.t)
    if (s.pokes.length >= 5) {
      s.dizzyUntil = s.t + 2.4
      s.pokes = []
    }
    const g = geometry(s)
    for (let i = 0; i < 2; i++) {
      spawn(s, 'heart', g.cx + (i ? 30 : -30), g.base - 120, (i ? 1 : -1) * 20, -50, 1.3, 7)
    }
    inputs.current.onPoke?.(s.pokes.length)
  }

  const s = sim.current
  const f = render(s)
  const spec = MOODS[s.effectiveMood]

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 240 240"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={spec.label}
      onPointerDown={poke}
      style={{ cursor: interactive ? 'pointer' : undefined, overflow: 'visible', touchAction: 'manipulation' }}
    >
      <defs>
        <radialGradient id={`glow-${uid}`}>
          <stop offset="0%" stopColor={f.colors.back} stopOpacity={0.55} />
          <stop offset="55%" stopColor={f.colors.body} stopOpacity={0.18} />
          <stop offset="100%" stopColor={f.colors.body} stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* glow */}
      <circle cx={f.cx} cy={f.base - 70} r={110} fill={`url(#glow-${uid})`} opacity={f.glow} />

      {/* ground shadow */}
      <ellipse cx={f.cx} cy={222} rx={44 * f.shadow} ry={5 * f.shadow} fill={INK} opacity={0.14 * f.shadow} />

      {/* anvil sits on the ground, outside the squash group */}
      {f.anvil > 0.01 && <Anvil x={200} y={202} t={f.anvil} />}

      <g transform={`translate(0 ${f.hop})`}>
        {/* feet */}
        <ellipse cx={f.cx - 21} cy={218} rx={11} ry={6.5} fill={f.colors.back} stroke={INK} strokeWidth={3.5} />
        <ellipse cx={f.cx + 21} cy={218} rx={11} ry={6.5} fill={f.colors.back} stroke={INK} strokeWidth={3.5} />

        <g transform={`translate(${f.cx} ${f.base}) scale(${f.sx} ${f.sy}) translate(${-f.cx} ${-f.base})`}>
          <path d={f.backPath} fill={f.colors.back} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
          {/* arms tuck behind the body unless reaching across the front */}
          <Arm shoulder={f.shoulderL} angle={f.armL} side={-1} color={f.colors.back} />
          {f.armR >= 0 && <Arm shoulder={f.shoulderR} angle={f.armR} side={1} color={f.colors.back} />}
          <path d={f.bodyPath} fill={f.colors.body} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
          <path d={f.corePath} fill={f.colors.core} />

          <Face f={f} />

          {f.mug > 0.01 && <Mug hand={handPos(f.shoulderR, f.armR, 1)} t={f.mug} tilt={f.mugTilt} dir={f.armR < -30 ? -1 : 1} />}
          {f.armR < 0 && <Arm shoulder={f.shoulderR} angle={f.armR} side={1} color={f.colors.back} />}
          {f.anvil > 0.01 && <Hammer hand={handPos(f.shoulderR, f.armR, 1)} angle={f.armR} t={f.anvil} />}
        </g>
      </g>

      <Particles list={s.particles} />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* simulation                                                          */
/* ------------------------------------------------------------------ */

function createSim(mood: PipMood) {
  const m = MOODS[mood]
  return {
    t: 0,
    mood,
    effectiveMood: mood as PipMood,
    moodStart: 0,
    pointer: null as { x: number; y: number } | null,
    lastInteraction: 0,
    nextBlink: 1.5,
    blinkUntil: 0,
    pokeUntil: 0,
    dizzyUntil: 0,
    pokes: [] as number[],
    beat: 0,
    nextSpawn: 0,
    sip: 0,
    stretching: false,
    particles: [] as Particle[],
    sp: {
      h: new Spring(m.height, 110, 13),
      w: new Spring(m.width, 110, 13),
      sx: new Spring(1, 260, 9),
      sy: new Spring(1, 260, 9),
      hop: new Spring(0, 320, 18),
      armL: new Spring(m.armL, 230, 17),
      armR: new Spring(m.armR, 520, 30),
      lookX: new Spring(0, 140, 16),
      lookY: new Spring(0, 140, 16),
      lid: new Spring(1, 900, 45),
      anvil: new Spring(m.anvil, 160, 20),
      mug: new Spring(m.mug, 160, 20),
      mugTilt: new Spring(0, 120, 16),
      tint: new Spring(m.tint, 30, 11),
      desat: new Spring(m.desat, 30, 11),
      glow: new Spring(m.glow, 60, 12),
    },
  }
}
type Sim = ReturnType<typeof createSim>

function settle(s: Sim) {
  for (const k of Object.keys(s.sp) as (keyof Sim['sp'])[]) s.sp[k].snap()
  s.particles = []
}

function step(
  s: Sim,
  dt: number,
  inp: { mood: PipMood; progress: number; interactive: boolean; dozeAfter: number },
  reduced: boolean,
  svg: SVGSVGElement | null,
) {
  s.t += dt
  const t = s.t

  // doze off when idle and ignored
  let mood = inp.mood
  if (mood === 'idle' && inp.dozeAfter > 0 && t - s.lastInteraction > inp.dozeAfter) mood = 'sleepy'

  if (mood !== s.effectiveMood) onEnter(s, mood, reduced)
  s.mood = inp.mood
  s.effectiveMood = mood
  const m = MOODS[mood]
  const p = clamp(inp.progress, 0, 1)
  const local = t - s.moodStart
  const { sp } = s

  // base targets
  sp.h.target = m.height * (mood === 'focus' ? 1 + p * 0.1 : 1)
  sp.w.target = m.width
  sp.armL.target = m.armL
  sp.armR.target = m.armR
  sp.anvil.target = m.anvil
  sp.mug.target = m.mug
  sp.mugTilt.target = 0
  sp.tint.target = m.tint
  sp.desat.target = m.desat
  sp.glow.target = m.glow + (mood === 'focus' ? p * 0.2 : 0)
  sp.sx.target = 1
  sp.sy.target = 1
  sp.hop.target = 0

  let lookTarget: { x: number; y: number } | null = null
  let glance = false

  switch (mood) {
    case 'focus':
    case 'almost': {
      // hammer cycle: slow wind-up, snap down; the spring does the strike
      const tempo = mood === 'almost' ? 0.95 : 0.78
      const phase = local * tempo
      const frac = phase % 1
      sp.armR.target = frac < 0.62 ? lerp(74, 150, easeInOut(frac / 0.62)) : 68
      if (frac >= 0.62 && s.beat !== Math.floor(phase) + 1 && sp.armR.x < 80) {
        s.beat = Math.floor(phase) + 1
        strike(s, reduced)
      }
      glance = mood === 'almost' && Math.floor(phase) % 3 === 2
      lookTarget = glance ? null : { x: 4.5, y: 4 }
      sp.armL.target = 30 + Math.sin(local * 2) * 4
      break
    }
    case 'paused':
      sp.armR.target = 160 + Math.sin(local * 1.4) * 4
      break
    case 'celebrate': {
      const hops = 3
      const period = 0.52
      const n = Math.floor(local / period)
      if (n < hops && s.beat !== n + 1 && !reduced) {
        s.beat = n + 1
        sp.hop.kick(-290)
        sp.sy.kick(2.4)
        burst(s, 'confetti', n === 0 ? 26 : 8)
      }
      sp.armL.target = 150 + Math.sin(local * 11) * 14
      sp.armR.target = 150 + Math.sin(local * 11 + 1.6) * 14
      break
    }
    case 'shortBreak': {
      // sip every few seconds
      const cyc = local % 5.5
      const sipping = cyc > 3.6 && cyc < 4.8
      sp.armR.target = sipping ? -118 : 34
      sp.mugTilt.target = sipping ? -28 : 0
      s.sip = sipping ? 1 : 0
      if (!reduced && t > s.nextSpawn && !sipping) {
        s.nextSpawn = t + 0.5
        const hand = handPos(geometry(s).shoulderR, sp.armR.x, 1)
        spawn(s, 'steam', hand.x + 13 + (Math.random() - 0.5) * 6, hand.y - 16, (Math.random() - 0.5) * 6, -16, 2.2, 4)
      }
      break
    }
    case 'longBreak': {
      const cyc = local % 8
      s.stretching = cyc > 4.5 && cyc < 6.3
      if (s.stretching) {
        sp.armL.target = 165
        sp.armR.target = 165
        sp.h.target = m.height * 1.12
        sp.w.target = m.width * 0.95
      }
      break
    }
    case 'sleepy':
      if (!reduced && t > s.nextSpawn) {
        s.nextSpawn = t + 1.7
        const g = geometry(s)
        spawn(s, 'z', g.cx + 34, g.base - 135, 10, -14, 2.6, 10)
      }
      sp.sy.target = 1 + Math.sin(local * 1.1) * 0.03
      break
    case 'sad':
      lookTarget = { x: 0, y: 3.5 }
      break
    case 'idle':
      if (local < 1.6 && !reduced) sp.armR.target = 140 + Math.sin(local * 13) * 22 // hello wave
      break
  }

  // ambient embers off the tip while focusing
  if ((mood === 'focus' || mood === 'almost') && !reduced && Math.random() < dt * (2 + p * 4)) {
    const g = geometry(s)
    spawn(s, 'ember', g.cx + g.sway + (Math.random() - 0.5) * 10, g.base - g.h + 8, (Math.random() - 0.5) * 20, -40 - Math.random() * 30, 1.2, 2 + Math.random() * 1.6)
  }

  // eyes: cursor, a scripted target, or straight ahead
  if (lookTarget) {
    sp.lookX.target = lookTarget.x
    sp.lookY.target = lookTarget.y
  } else if ((m.track || glance) && inp.interactive && s.pointer && svg) {
    const r = svg.getBoundingClientRect()
    const g = geometry(s)
    const ex = r.left + (g.cx / 240) * r.width
    const ey = r.top + ((g.base - 62) / 240) * r.height
    sp.lookX.target = clamp((s.pointer.x - ex) / 220, -1, 1) * 4.5
    sp.lookY.target = clamp((s.pointer.y - ey) / 220, -1, 1) * 3.5
  } else {
    sp.lookX.target = 0
    sp.lookY.target = 0
  }

  // blinking
  if (t > s.nextBlink) {
    s.blinkUntil = t + 0.13
    s.nextBlink = t + 2.2 + Math.random() * 3.4
  }
  sp.lid.target = t < s.blinkUntil ? 0.08 : 1

  // breathing
  sp.sy.target *= 1 + Math.sin(t * 1.7) * (reduced ? 0.004 : 0.014)
  sp.sx.target *= 1 - Math.sin(t * 1.7) * (reduced ? 0.002 : 0.007)

  for (const k of Object.keys(sp) as (keyof typeof sp)[]) sp[k].step(dt)

  // particles
  for (const q of s.particles) {
    q.life += dt
    q.x += q.vx * dt
    q.y += q.vy * dt
    q.rot += q.vr * dt
    if (q.kind === 'spark') { q.vy += 520 * dt; q.vx *= 0.985 }
    else if (q.kind === 'confetti') { q.vy += 300 * dt; q.vx *= 0.97; q.vy = Math.min(q.vy, 90) }
    else if (q.kind === 'z' || q.kind === 'steam' || q.kind === 'smoke') { q.vx += Math.sin(q.life * 3 + q.size) * 14 * dt }
    else if (q.kind === 'heart') { q.vy += 40 * dt }
  }
  s.particles = s.particles.filter((q) => q.life < q.max)
}

function onEnter(s: Sim, mood: PipMood, reduced: boolean) {
  s.moodStart = s.t
  s.beat = 0
  s.nextSpawn = s.t + 0.2
  const sp = s.sp
  if (mood === 'sad' && !reduced) burst(s, 'smoke', 6)
  if (mood === 'celebrate') {
    sp.glow.kick(4)
    if (reduced) burst(s, 'confetti', 10)
  }
  if (mood === 'focus') { sp.sy.kick(-1.6); sp.sx.kick(1.2) }
  if (mood === 'paused') sp.sy.kick(1.2)
}

function strike(s: Sim, reduced: boolean) {
  s.sp.sy.kick(-0.9)
  s.sp.sx.kick(0.6)
  s.sp.glow.kick(2.5)
  if (reduced) return
  for (let i = 0; i < 7; i++) {
    const a = deg(-90 + (Math.random() - 0.5) * 130)
    const v = 90 + Math.random() * 120
    spawn(s, 'spark', 200 + (Math.random() - 0.5) * 8, 199, Math.cos(a) * v, Math.sin(a) * v, 0.45 + Math.random() * 0.3, 1.6 + Math.random() * 1.6)
  }
}

function burst(s: Sim, kind: Kind, n: number) {
  const g = geometry(s)
  for (let i = 0; i < n; i++) {
    if (kind === 'confetti') {
      const a = deg(-90 + (Math.random() - 0.5) * 150)
      const v = 160 + Math.random() * 180
      spawn(s, 'confetti', g.cx, g.base - 100, Math.cos(a) * v, Math.sin(a) * v, 1.6 + Math.random() * 0.8, 4 + Math.random() * 3)
    } else {
      spawn(s, kind, g.cx + (Math.random() - 0.5) * 30, g.base - g.h + 20, (Math.random() - 0.5) * 20, -20 - Math.random() * 20, 1.8 + Math.random(), 6 + Math.random() * 6)
    }
  }
}

function spawn(s: Sim, kind: Kind, x: number, y: number, vx: number, vy: number, max: number, size: number) {
  if (s.particles.length > 90) return
  s.particles.push({
    kind, x, y, vx, vy, max, size, life: 0,
    rot: Math.random() * 360,
    vr: (Math.random() - 0.5) * 720,
    color: kind === 'confetti' ? CONFETTI[(Math.random() * CONFETTI.length) | 0] : '',
  })
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

const BASE = 214
const R = 56
const H = 150

function geometry(s: Sim) {
  const { sp, t } = s
  const m = MOODS[s.effectiveMood]
  const amp = m.amp
  const sp_ = m.speed
  const cx = 120 - 20 * clamp(sp.anvil.x, 0, 1)
  const r = R * sp.w.x
  const h = H * sp.h.x * (1 + Math.sin(t * sp_ * 4.4) * 0.025 * amp)
  const sway = (Math.sin(t * sp_ * 2.1) * 7 + Math.sin(t * sp_ * 5.3 + 1) * 2.6) * amp
  const wobA = Math.sin(t * sp_ * 3.7) * 4.5 * amp
  const wobB = Math.sin(t * sp_ * 4.9 + 2) * 4 * amp
  return { cx, base: BASE, r, h, sway, wobA, wobB, shoulderR: { x: cx + r * 0.86, y: BASE - r * 0.72 } }
}

function render(s: Sim) {
  const g = geometry(s)
  const { sp, t } = s
  const { cx, base, r, h, sway, wobA, wobB } = g
  const m = MOODS[s.effectiveMood]

  const tint = clamp(sp.tint.x, 0, 1)
  const ash = clamp(sp.desat.x, 0, 1) * 0.6
  const col = (warm: string, blue: string, grey: string) => mixHex(mixHex(warm, blue, tint), grey, ash)

  const poked = t < s.pokeUntil
  const dizzy = t < s.dizzyUntil

  let eyes: Eyes = m.eyes
  let mouth: Mouth = m.mouth
  if (s.effectiveMood === 'longBreak' && s.stretching) { eyes = 'closed'; mouth = 'o' }
  if (s.effectiveMood === 'shortBreak' && s.sip) { eyes = 'closed'; mouth = 'o' }
  if (s.effectiveMood === 'almost' && Math.floor((t - s.moodStart) * 0.95) % 3 === 2) { eyes = 'open'; mouth = 'grin' }
  if (poked) { eyes = eyes === 'closed' ? 'happy' : eyes === 'open' || eyes === 'half' ? 'happy' : eyes; mouth = 'w' }
  if (dizzy) { eyes = 'dizzy'; mouth = 'w' }

  const faceY = base - r * 1.12
  const hopY = sp.hop.x
  return {
    cx, base, t,
    hop: hopY,
    shadow: clamp(1 + hopY / 120, 0.4, 1.1),
    sx: sp.sx.x,
    sy: sp.sy.x,
    sway,
    bodyPath: flamePath(cx, base, r, h, sway, wobA, wobB),
    backPath: flamePath(cx, base + 1, r * 1.03, h * 1.15, -sway * 0.8 + Math.sin(t * 3.1) * 3 * m.amp, -wobB, wobA),
    corePath: flamePath(cx, base - 5, r * 0.64, h * 0.56, sway * 0.4, wobA * 0.4, wobB * 0.4),
    colors: {
      body: col(PAL.body, PAL.bodyBlue, PAL.ash),
      back: col(PAL.back, PAL.backBlue, PAL.ashBack),
      core: col(PAL.core, PAL.coreBlue, PAL.ashCore),
    },
    glow: clamp(sp.glow.x, 0, 1.3) * (0.85 + Math.sin(t * 7.3) * 0.08 * m.amp),
    face: { x: cx + sp.lookX.x * 0.55, y: faceY + sp.lookY.x * 0.5 },
    look: { x: sp.lookX.x, y: sp.lookY.x },
    lid: sp.lid.x,
    eyes, mouth, brows: dizzy ? 'none' as Brows : m.brows,
    cheeks: poked ? 1.35 : 1,
    shoulderL: { x: cx - r * 0.86, y: base - r * 0.72 },
    shoulderR: { x: cx + r * 0.86, y: base - r * 0.72 },
    armL: sp.armL.x,
    armR: sp.armR.x,
    anvil: clamp(sp.anvil.x, 0, 1),
    mug: clamp(sp.mug.x, 0, 1),
    mugTilt: sp.mugTilt.x,
  }
}
type Frame = ReturnType<typeof render>

const ARM = 32
function handPos(sh: { x: number; y: number }, angle: number, side: 1 | -1) {
  return { x: sh.x + side * Math.sin(deg(angle)) * ARM, y: sh.y + Math.cos(deg(angle)) * ARM }
}

/* ------------------------------------------------------------------ */
/* parts                                                               */
/* ------------------------------------------------------------------ */

function Arm({ shoulder, angle, side, color }: { shoulder: { x: number; y: number }; angle: number; side: 1 | -1; color: string }) {
  const hand = handPos(shoulder, angle, side)
  // slight elbow bend, perpendicular to the arm
  const mx = (shoulder.x + hand.x) / 2
  const my = (shoulder.y + hand.y) / 2
  const nx = -(hand.y - shoulder.y) / ARM
  const ny = (hand.x - shoulder.x) / ARM
  const bend = 4 * side
  return (
    <g>
      <path d={`M${shoulder.x} ${shoulder.y} Q${mx + nx * bend} ${my + ny * bend} ${hand.x} ${hand.y}`} stroke={INK} strokeWidth={5} strokeLinecap="round" fill="none" />
      <circle cx={hand.x} cy={hand.y} r={5.6} fill={color} stroke={INK} strokeWidth={3} />
    </g>
  )
}

function Face({ f }: { f: Frame }) {
  const { x, y } = f.face
  const ex = 17
  const lx = f.look.x * 0.6
  const ly = f.look.y * 0.6
  return (
    <g>
      {/* cheeks */}
      <ellipse cx={x - 28} cy={y + 14} rx={6.5 * f.cheeks} ry={3.6 * f.cheeks} fill={PAL.cheek} opacity={0.55} />
      <ellipse cx={x + 28} cy={y + 14} rx={6.5 * f.cheeks} ry={3.6 * f.cheeks} fill={PAL.cheek} opacity={0.55} />

      <Eye x={x - ex + lx} y={y + ly} kind={f.eyes} lid={f.lid} t={f.t} side={-1} />
      <Eye x={x + ex + lx} y={y + ly} kind={f.eyes} lid={f.lid} t={f.t} side={1} />
      <Brow x={x - ex + lx} y={y - 15 + ly} kind={f.brows} side={-1} />
      <Brow x={x + ex + lx} y={y - 15 + ly} kind={f.brows} side={1} />

      <MouthShape x={x + lx * 0.6} y={y + 16 + ly * 0.5} kind={f.mouth} t={f.t} />
    </g>
  )
}

function Eye({ x, y, kind, lid, t, side }: { x: number; y: number; kind: Eyes; lid: number; t: number; side: 1 | -1 }) {
  const stroke = { stroke: INK, strokeWidth: 3.6, strokeLinecap: 'round' as const, fill: 'none' }
  switch (kind) {
    case 'happy':
      return <path d={`M${x - 6.5} ${y + 2.5} Q${x} ${y - 7} ${x + 6.5} ${y + 2.5}`} {...stroke} />
    case 'closed':
      return <path d={`M${x - 6.5} ${y - 0.5} Q${x} ${y + 5.5} ${x + 6.5} ${y - 0.5}`} {...stroke} />
    case 'dizzy':
      return (
        <g transform={`translate(${x} ${y}) rotate(${t * 540 * side})`}>
          <path d="M0 0 m-1 0 a1 1 0 1 1 2 0 a2.4 2.4 0 1 1 -4.8 0 a3.8 3.8 0 1 1 7.6 0 a5.2 5.2 0 1 1 -10.4 0" stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
        </g>
      )
    case 'half': {
      const sy = 0.5 * lid
      return (
        <g>
          <g transform={`translate(${x} ${y + 2}) scale(1 ${sy})`}>
            <ellipse rx={6.6} ry={9} fill={INK} />
          </g>
          <path d={`M${x - 8} ${y + 3 - 9 * sy} Q${x} ${y - 2 - 9 * sy} ${x + 8} ${y + 3 - 9 * sy}`} {...stroke} strokeWidth={3} />
        </g>
      )
    }
    default: {
      const scale = kind === 'wide' ? 1.14 : 1
      return (
        <g transform={`translate(${x} ${y}) scale(${scale} ${scale * lid})`}>
          <ellipse rx={6.6} ry={9} fill={INK} />
          <circle cx={-2.2} cy={-3.6} r={2.4} fill="#FFFDF7" />
          <circle cx={2.4} cy={3.2} r={1} fill="#FFFDF7" opacity={0.8} />
        </g>
      )
    }
  }
}

function Brow({ x, y, kind, side }: { x: number; y: number; kind: Brows; side: 1 | -1 }) {
  if (kind === 'none') return null
  const p = { stroke: INK, strokeWidth: 3.2, strokeLinecap: 'round' as const, fill: 'none' }
  // `side` mirrors: inner end is toward the face centre
  const inner = x - side * 6
  const outer = x + side * 6
  if (kind === 'determined') return <path d={`M${outer} ${y - 2} L${inner} ${y + 2}`} {...p} />
  if (kind === 'worried') return <path d={`M${outer} ${y + 2} L${inner} ${y - 2.5}`} {...p} />
  return <path d={`M${x - 6} ${y - 1} Q${x} ${y - 6} ${x + 6} ${y - 1}`} {...p} />
}

function MouthShape({ x, y, kind, t }: { x: number; y: number; kind: Mouth; t: number }) {
  const p = { stroke: INK, strokeWidth: 3.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  switch (kind) {
    case 'smile':
      return <path d={`M${x - 7} ${y} Q${x} ${y + 7} ${x + 7} ${y}`} {...p} />
    case 'content':
      return <path d={`M${x - 5} ${y + 1} Q${x} ${y + 4.5} ${x + 5} ${y + 1}`} {...p} />
    case 'focus': {
      // concentration tongue, pokes out a little on its own rhythm
      const tongue = 2.6 + Math.max(0, Math.sin(t * 1.3)) * 1.6
      return (
        <g>
          <ellipse cx={x + 4} cy={y + 2.6} rx={2.8} ry={tongue} fill={PAL.tongue} stroke={INK} strokeWidth={2.2} />
          <path d={`M${x - 6} ${y + 1} Q${x} ${y + 2.8} ${x + 6} ${y + 0.5}`} {...p} />
        </g>
      )
    }
    case 'open':
      return (
        <g>
          <path d={`M${x - 9} ${y - 1} Q${x} ${y + 15} ${x + 9} ${y - 1} Z`} fill={INK} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
          <ellipse cx={x} cy={y + 7} rx={4} ry={2.6} fill={PAL.tongue} />
        </g>
      )
    case 'grin':
      return <path d={`M${x - 8} ${y - 0.5} Q${x} ${y + 10} ${x + 8} ${y - 0.5} Z`} fill={INK} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
    case 'o':
      return <ellipse cx={x} cy={y + 2} rx={3.4} ry={4.2} fill={INK} />
    case 'frown':
      return <path d={`M${x - 6} ${y + 4} Q${x} ${y - 2} ${x + 6} ${y + 4}`} {...p} />
    case 'w':
      return <path d={`M${x - 7} ${y} q3.5 5 7 0 q3.5 5 7 0`} {...p} />
  }
}

function Anvil({ x, y, t }: { x: number; y: number; t: number }) {
  // pops up from the ground
  const s = clamp(t, 0, 1)
  return (
    <g transform={`translate(${x} ${222}) scale(${s}) translate(${-x} ${-222})`} opacity={s}>
      <path
        d={`M${x - 22} ${y - 4} L${x + 16} ${y - 4} Q${x + 26} ${y - 4} ${x + 27} ${y - 1} L${x + 14} ${y + 3} L${x + 9} ${y + 3} L${x + 9} ${y + 10} L${x + 15} ${y + 18} L${x - 15} ${y + 18} L${x - 9} ${y + 10} L${x - 9} ${y + 3} L${x - 18} ${y + 3} Q${x - 22} ${y + 1} ${x - 22} ${y - 4} Z`}
        fill="#4A4540"
        stroke={INK}
        strokeWidth={3.2}
        strokeLinejoin="round"
      />
      <path d={`M${x - 18} ${y - 1} L${x + 14} ${y - 1}`} stroke="#8C847A" strokeWidth={1.8} strokeLinecap="round" />
    </g>
  )
}

function Hammer({ hand, angle, t }: { hand: { x: number; y: number }; angle: number; t: number }) {
  return (
    <g transform={`translate(${hand.x} ${hand.y}) rotate(${-angle}) scale(${clamp(t, 0, 1)})`}>
      <rect x={-2.4} y={-3} width={4.8} height={27} rx={2} fill="#9A6440" stroke={INK} strokeWidth={2.4} />
      <rect x={-9} y={21} width={18} height={10} rx={2.4} fill="#6E6862" stroke={INK} strokeWidth={2.8} />
      <path d={`M-6 24 L6 24`} stroke="#A9A198" strokeWidth={1.6} strokeLinecap="round" />
    </g>
  )
}

function Mug({ hand, t, tilt, dir }: { hand: { x: number; y: number }; t: number; tilt: number; dir: 1 | -1 }) {
  // dir flips the mug to the inner side of the hand while sipping
  const s = clamp(t, 0, 1)
  return (
    <g transform={`translate(${hand.x + 13 * dir} ${hand.y - 3}) rotate(${tilt}) scale(${s * dir} ${s})`}>
      <path d="M-10 -2 q-7 0 -7 6 q0 6 7 6" stroke={INK} strokeWidth={3} fill="none" />
      <rect x={-10} y={-8} width={20} height={20} rx={4} fill="#F4EFE6" stroke={INK} strokeWidth={3} />
      <path d="M-10 -1 L10 -1" stroke="#7FA38A" strokeWidth={3.2} />
    </g>
  )
}

function Particles({ list }: { list: Particle[] }) {
  return (
    <g pointerEvents="none">
      {list.map((q, i) => {
        const k = 1 - q.life / q.max
        switch (q.kind) {
          case 'spark':
            return <circle key={i} cx={q.x} cy={q.y} r={q.size * (0.5 + k * 0.5)} fill={k > 0.5 ? '#FFE9A8' : '#FFB547'} stroke={INK} strokeWidth={0.8} opacity={Math.min(1, k * 2)} />
          case 'ember':
            return <circle key={i} cx={q.x} cy={q.y} r={q.size * k} fill="#FF7A2F" opacity={k} />
          case 'confetti':
            return <rect key={i} x={q.x - q.size / 2} y={q.y - q.size / 4} width={q.size} height={q.size / 2} fill={q.color} transform={`rotate(${q.rot} ${q.x} ${q.y})`} opacity={Math.min(1, k * 3)} />
          case 'smoke':
            return <circle key={i} cx={q.x} cy={q.y} r={q.size * (1.6 - k)} fill="#9C9389" opacity={k * 0.45} />
          case 'steam':
            return <circle key={i} cx={q.x} cy={q.y} r={q.size * (1.4 - k * 0.6)} fill="none" stroke={INK} strokeWidth={1.6} opacity={k * 0.35} />
          case 'z':
            return (
              <text key={i} x={q.x} y={q.y} fontFamily="'Fraunces Variable', serif" fontWeight={700} fontSize={q.size * (1.5 - k * 0.6)} fill={INK} opacity={Math.min(1, k * 2) * 0.75}>
                z
              </text>
            )
          case 'heart':
            return (
              <path key={i} transform={`translate(${q.x} ${q.y}) scale(${(q.size / 7) * (0.6 + (1 - k) * 0.6)})`} d="M0 3 C-6 -2 -4 -7 0 -4 C4 -7 6 -2 0 3 Z" fill="#E4572E" stroke={INK} strokeWidth={1.4} opacity={Math.min(1, k * 2.5)} />
            )
        }
      })}
    </g>
  )
}
