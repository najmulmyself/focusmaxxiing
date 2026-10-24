/** Critically-ish damped spring, stepped with semi-implicit Euler. */
export class Spring {
  x: number
  v = 0
  target: number
  constructor(
    initial: number,
    public stiffness = 170,
    public damping = 18,
  ) {
    this.x = initial
    this.target = initial
  }
  step(dt: number) {
    const a = -this.stiffness * (this.x - this.target) - this.damping * this.v
    this.v += a * dt
    this.x += this.v * dt
  }
  snap() {
    this.x = this.target
    this.v = 0
  }
  kick(velocity: number) {
    this.v += velocity
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
export const deg = (d: number) => (d * Math.PI) / 180

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Linear blend of two #rrggbb colours. */
export function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a
  if (t >= 1) return b
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const c = (x: number, y: number) => Math.round(lerp(x, y, t)).toString(16).padStart(2, '0')
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`
}

/**
 * Teardrop flame outline anchored at its bottom-centre.
 * `r` is the half-width of the round belly, `h` the total height to the tip,
 * `sway` shifts the tip sideways, `wobA`/`wobB` ripple the two flanks.
 */
export function flamePath(cx: number, base: number, r: number, h: number, sway: number, wobA: number, wobB: number) {
  const f = (n: number) => n.toFixed(2)
  const belly = base - r * 0.95
  return [
    `M${f(cx)} ${f(base)}`,
    `C${f(cx + r * 0.98)} ${f(base)} ${f(cx + r * 1.04)} ${f(base - r * 0.42)} ${f(cx + r)} ${f(belly)}`,
    `C${f(cx + r * 0.96 + wobA)} ${f(base - r * 1.55)} ${f(cx + sway * 0.5 + r * 0.42)} ${f(base - h * 0.78 + wobB)} ${f(cx + sway)} ${f(base - h)}`,
    `C${f(cx + sway * 0.5 - r * 0.3)} ${f(base - h * 0.8 - wobA)} ${f(cx - r * 0.98 - wobB)} ${f(base - r * 1.6)} ${f(cx - r)} ${f(belly)}`,
    `C${f(cx - r * 1.04)} ${f(base - r * 0.42)} ${f(cx - r * 0.98)} ${f(base)} ${f(cx)} ${f(base)}Z`,
  ].join('')
}
