import type { AlarmSound, Ambient } from '../timer/settings'

/**
 * All sound is synthesized with WebAudio — no audio files to load or cache.
 * Browsers only allow audio after a user gesture, so call `unlockAudio()` from
 * a click/keypress (the Start button does).
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function unlockAudio() {
  getCtx()
}

type Partial = [freq: number, amp: number, decay: number]

/** A struck metal/glass tone: summed sines with independent exponential decays. */
function strike(c: AudioContext, out: AudioNode, at: number, partials: Partial[], click = 0) {
  for (const [f, a, d] of partials) {
    const o = c.createOscillator()
    const g = c.createGain()
    o.frequency.value = f
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(a, at + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, at + d)
    o.connect(g).connect(out)
    o.start(at)
    o.stop(at + d + 0.05)
  }
  if (click > 0) {
    const n = c.createBufferSource()
    n.buffer = noiseBuffer(c, 0.03)
    const hp = c.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 3000
    const g = c.createGain()
    g.gain.setValueAtTime(click, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03)
    n.connect(hp).connect(g).connect(out)
    n.start(at)
  }
}

function noiseBuffer(c: AudioContext, seconds: number) {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return b
}

const ALARMS: Record<Exclude<AlarmSound, 'none'>, { length: number; play: (c: AudioContext, out: AudioNode, t: number) => void }> = {
  // Pip's anvil: three bright, inharmonic clinks
  anvil: {
    length: 1.5,
    play(c, out, t) {
      const p: Partial[] = [[1046, 0.25, 1.1], [2093, 0.5, 0.8], [3140, 0.28, 0.55], [4870, 0.18, 0.32], [6210, 0.1, 0.2]]
      strike(c, out, t, p, 0.35)
      strike(c, out, t + 0.28, p, 0.3)
      strike(c, out, t + 0.56, p.map(([f, a, d]) => [f, a * 1.1, d * 1.6]), 0.35)
    },
  },
  bell: {
    length: 2.4,
    play(c, out, t) {
      const f = 659.25
      strike(c, out, t, [[f, 0.5, 2.4], [f * 2, 0.25, 1.7], [f * 2.76, 0.18, 1.1], [f * 5.4, 0.08, 0.6], [f * 8.93, 0.04, 0.3]])
    },
  },
  // mechanical kitchen-timer ring: a fast-hammered small bell
  kitchen: {
    length: 1.6,
    play(c, out, t) {
      for (let i = 0; i < 22; i++) strike(c, out, t + i * 0.055, [[2637, 0.16, 0.09], [3951, 0.07, 0.06]])
    },
  },
  chime: {
    length: 1.6,
    play(c, out, t) {
      const note = (f: number, at: number) => strike(c, out, at, [[f, 0.45, 1.2], [f * 4, 0.08, 0.15], [f * 10, 0.03, 0.05]])
      note(659.25, t)
      note(987.77, t + 0.18)
      note(1318.5, t + 0.36)
    },
  },
}

export function playAlarm(kind: AlarmSound, volume: number, repeat = 1) {
  if (kind === 'none' || volume <= 0) return
  const c = getCtx()
  if (!c) return
  const a = ALARMS[kind]
  const out = c.createGain()
  out.gain.value = volume
  out.connect(c.destination)
  const t0 = c.currentTime + 0.05
  for (let i = 0; i < repeat; i++) a.play(c, out, t0 + i * (a.length + 0.25))
}

/* ------------------------------------------------------------------ */
/* ambient loops                                                       */
/* ------------------------------------------------------------------ */

const LOOP_SEC = 14
const FADE_SEC = 0.6
const cache = new Map<Ambient, AudioBuffer>()

function makeAmbient(c: AudioContext, kind: Exclude<Ambient, 'none'>): AudioBuffer {
  const sr = c.sampleRate
  const n = Math.floor(sr * (LOOP_SEC + FADE_SEC))
  const raw = new Float32Array(n)
  let brown = 0
  // Paul Kellet's pink-noise filter state
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  // sparse events (drops, crackles): remaining samples + amplitude + decay
  let evLeft = 0, evAmp = 0, evDecay = 1
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1
    brown = (brown + 0.02 * w) / 1.02
    let v = 0
    if (kind === 'brown') {
      v = brown * 3.2
    } else if (kind === 'rain') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.08
      b6 = w * 0.115926
      if (evLeft <= 0 && Math.random() < 60 / sr) { evLeft = sr * 0.012; evAmp = 0.05 + Math.random() * 0.18; evDecay = Math.exp(-1 / (sr * 0.002)) }
      v = pink + brown * 0.8
      if (evLeft > 0) { v += w * evAmp; evAmp *= evDecay; evLeft-- }
    } else {
      // fireplace: low rumble + clustered crackles and the occasional snap
      if (evLeft <= 0 && Math.random() < (Math.random() < 0.02 ? 400 : 7) / sr) {
        const snap = Math.random() < 0.08
        evLeft = sr * (snap ? 0.03 : 0.006)
        evAmp = snap ? 0.7 : 0.15 + Math.random() * 0.35
        evDecay = Math.exp(-1 / (sr * (snap ? 0.006 : 0.0012)))
      }
      v = brown * 2.4
      if (evLeft > 0) { v += w * evAmp; evAmp *= evDecay; evLeft-- }
    }
    raw[i] = v
  }
  // crossfade the tail into the head so the loop has no seam
  const len = Math.floor(sr * LOOP_SEC)
  const fade = n - len
  const buf = c.createBuffer(1, len, sr)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = raw[i]
  for (let i = 0; i < fade; i++) {
    const k = i / fade
    d[i] = raw[i] * k + raw[len + i] * (1 - k)
  }
  return buf
}

let current: { kind: Ambient; src: AudioBufferSourceNode; gain: GainNode } | null = null

/** Start, retune, or stop the ambient loop. Idempotent — call it with the desired state. */
export function setAmbient(kind: Ambient, volume: number) {
  const c = kind === 'none' && !current ? null : getCtx()
  if (!c) return
  if (current && (current.kind !== kind || volume <= 0)) {
    const old = current
    old.gain.gain.cancelScheduledValues(c.currentTime)
    old.gain.gain.setTargetAtTime(0, c.currentTime, 0.25)
    old.src.stop(c.currentTime + 1.5)
    current = null
  }
  if (kind === 'none' || volume <= 0) return
  if (current) {
    current.gain.gain.setTargetAtTime(volume, c.currentTime, 0.15)
    return
  }
  let buf = cache.get(kind)
  if (!buf) {
    buf = makeAmbient(c, kind)
    cache.set(kind, buf)
  }
  const src = c.createBufferSource()
  src.buffer = buf
  src.loop = true
  const gain = c.createGain()
  gain.gain.value = 0
  // rain and noise are bright; tame them a little
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = kind === 'rain' ? 7000 : 4500
  src.connect(lp).connect(gain).connect(c.destination)
  src.start()
  gain.gain.setTargetAtTime(volume, c.currentTime, 0.4)
  current = { kind, src, gain }
}
