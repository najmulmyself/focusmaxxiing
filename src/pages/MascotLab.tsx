import { useState } from 'react'
import { Pip, PIP_MOODS, type PipMood } from '../mascot/Pip'

const MOOD_INFO: Record<PipMood, { name: string; when: string; stage: string }> = {
  idle:       { name: 'Idle',        when: 'Timer not started. Eyes follow your cursor; waves hello.', stage: 'var(--paper-2)' },
  focus:      { name: 'Forging',     when: 'Focus running. Hammers out sparks; burns taller as the session goes on.', stage: 'var(--vermilion)' },
  paused:     { name: 'Paused',      when: 'Focus paused. Hammer up, looks at you, a little surprised.', stage: 'var(--vermilion)' },
  almost:     { name: 'Last stretch',when: 'Final minute. Faster strikes, glances up with a grin.', stage: 'var(--vermilion)' },
  celebrate:  { name: 'Done!',       when: 'Pomodoro completed. Three hops and confetti.', stage: 'var(--vermilion)' },
  shortBreak: { name: 'Tea break',   when: 'Short break. Sips tea, relaxed eyes.', stage: 'var(--sage)' },
  longBreak:  { name: 'Cool down',   when: 'Long break. Burns blue and stretches.', stage: 'var(--dusk)' },
  sad:        { name: 'Fizzled',     when: 'Focus abandoned. A puff of smoke — gentle, never guilt-trippy.', stage: 'var(--paper-2)' },
  sleepy:     { name: 'Dozing',      when: 'Left idle for a while. Wakes up when you come back.', stage: 'var(--paper-2)' },
}

const darkStage = (m: PipMood) => !['idle', 'sad', 'sleepy'].includes(m)

export function MascotLab() {
  const [mood, setMood] = useState<PipMood>('idle')
  const [progress, setProgress] = useState(0.3)
  const [pokes, setPokes] = useState(0)
  const info = MOOD_INFO[mood]

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
      <header className="pt-12 pb-8 sm:pt-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Character · v1</p>
        <h1 className="display mt-2 text-6xl font-semibold sm:text-8xl">Meet Pip.</h1>
        <p className="mt-4 max-w-xl text-lg text-muted">
          A small ember who works when you work. Pip forges while you focus, sips tea on breaks, cools to blue on long
          ones, and fizzles — just a little — if you walk away.
        </p>
      </header>

      {/* stage */}
      <section className="card grid overflow-hidden md:grid-cols-[1.3fr_1fr]">
        <div
          className="relative flex min-h-[380px] items-center justify-center transition-colors duration-700 sm:min-h-[460px]"
          style={{ background: info.stage }}
        >
          <Pip mood={mood} progress={progress} size="min(380px, 82vw)" onPoke={setPokes} dozeAfter={0} />
          <span
            className="absolute bottom-4 left-4 font-mono text-[11px] uppercase tracking-widest"
            style={{ color: darkStage(mood) ? 'var(--on-accent)' : 'var(--fg-muted)' }}
          >
            {pokes > 0 ? `poked ×${pokes}` : 'tap Pip'}
          </span>
        </div>
        <div className="flex flex-col gap-6 border-t-2 border-line p-6 md:border-t-0 md:border-l-2 sm:p-8">
          <div>
            <h2 className="display text-3xl font-semibold">{info.name}</h2>
            <p className="mt-2 text-muted">{info.when}</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Mood">
            {PIP_MOODS.map((m) => (
              <button key={m} className="btn px-3 py-1.5 text-sm" aria-pressed={m === mood} onClick={() => setMood(m)}>
                {MOOD_INFO[m].name}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="flex justify-between font-mono text-xs uppercase tracking-widest text-muted">
              <span>Session progress</span>
              <span>{Math.round(progress * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={progress}
              onChange={(e) => setProgress(+e.target.value)}
              className="mt-2 w-full accent-[var(--vermilion)]"
            />
          </label>
          <p className="mt-auto text-sm text-faint">Psst — poke Pip five times quickly.</p>
        </div>
      </section>

      {/* character sheet */}
      <section className="mt-20">
        <h2 className="display text-4xl font-semibold">Character sheet</h2>
        <p className="mt-2 max-w-2xl text-muted">Every state the timer can put Pip in, each one live.</p>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3">
          {PIP_MOODS.map((m) => (
            <figure key={m} className="card overflow-hidden">
              <div className="flex aspect-[5/4] items-center justify-center" style={{ background: MOOD_INFO[m].stage }}>
                <Pip mood={m} progress={0.5} size="78%" dozeAfter={0} />
              </div>
              <figcaption className="border-t-2 border-line p-3 sm:p-4">
                <div className="font-semibold">{MOOD_INFO[m].name}</div>
                <div className="mt-0.5 text-sm text-muted">{MOOD_INFO[m].when}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* construction */}
      <section className="mt-20 grid gap-8 md:grid-cols-2 [&>*]:min-w-0">
        <div>
          <h2 className="display text-4xl font-semibold">Construction</h2>
          <ul className="mt-4 space-y-3 text-muted">
            <li><b className="text-fg">Shape.</b> A teardrop flame over a round belly — readable as a silhouette at 16px.</li>
            <li><b className="text-fg">Line.</b> One ink outline weight (4 units), round joins. A sticker, not a gradient blob.</li>
            <li><b className="text-fg">Layers.</b> Back flame, body, cream core, face. The flame outline is regenerated every frame, so it never loops.</li>
            <li><b className="text-fg">Motion.</b> Springs for squash, limbs and gaze; honours reduced-motion (no particles, minimal flicker).</li>
            <li><b className="text-fg">Never.</b> Guilt, nagging, or paid cosmetics.</li>
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            {[
              ['Body', '#FFB547'], ['Back flame', '#FF7A2F'], ['Core', '#FFF1C9'], ['Cool body', '#8CC3EC'], ['Cool flame', '#4F8FC9'], ['Ink', '#1D1B18'], ['Blush', '#FF6F61'],
            ].map(([n, c]) => (
              <div key={n} className="flex items-center gap-2 text-sm">
                <span className="size-6 rounded-full border-2 border-line" style={{ background: c }} />
                <span>{n}</span>
                <code className="font-mono text-xs text-faint">{c}</code>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-6">
          <h3 className="font-mono text-xs uppercase tracking-widest text-muted">Scale test</h3>
          <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4">
            {[128, 96, 48, 32, 16].map((s) => (
              <div key={s} className="flex flex-col items-center gap-2">
                <Pip still interactive={false} size={s} mood="idle" />
                <span className="font-mono text-[11px] text-faint">{s}</span>
              </div>
            ))}
          </div>
          <h3 className="mt-8 font-mono text-xs uppercase tracking-widest text-muted">On every surface</h3>
          <div className="mt-4 grid grid-cols-5 overflow-hidden rounded-xl border-2 border-line">
            {['var(--paper)', 'var(--vermilion)', 'var(--sage)', 'var(--dusk)', 'var(--charcoal)'].map((bg) => (
              <div key={bg} className="flex aspect-square items-center justify-center" style={{ background: bg }}>
                <Pip still interactive={false} size="80%" mood="idle" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
