import { Pip } from '../mascot/Pip'

/**
 * Static brand assets rendered from the live Pip component.
 * `npm run icons` screenshots each [data-asset] node into public/.
 */
export function AssetSheet() {
  return (
    <div className="flex flex-col items-start gap-10 bg-[#ddd] p-10" data-theme="light">
      {/* app icon: full-bleed, Pip inside the 80% maskable safe zone */}
      <div data-asset="icons/icon-512.png" className="relative grid size-[512px] place-items-center overflow-hidden" style={{ background: 'var(--vermilion)' }}>
        <Pip still interactive={false} mood="idle" size={400} className="translate-y-[8px]" />
      </div>

      {/* favicon source: tight crop, extracted as SVG */}
      <div data-svg="favicon.svg" className="size-[256px]">
        <Pip still interactive={false} mood="idle" size={256} />
      </div>

      {/* social card */}
      <div data-asset="og.png" className="relative flex h-[630px] w-[1200px] overflow-hidden" style={{ background: 'var(--paper)' }}>
        <div className="flex flex-1 flex-col justify-between p-16 text-ink">
          <div className="display text-4xl font-semibold">
            focusmaxxiing<span style={{ color: 'var(--vermilion)' }}>.</span>
          </div>
          <div>
            <div className="display text-[104px] leading-[0.92] font-semibold">
              Focus,
              <br />
              <em className="font-normal">with a pulse.</em>
            </div>
            <p className="mt-6 max-w-md text-2xl text-[var(--ink-2)]">A pomodoro timer with real reports, every byte exportable, and a small ember named Pip.</p>
          </div>
        </div>
        <div className="grid w-[460px] place-items-center border-l-[3px] border-ink" style={{ background: 'var(--vermilion)' }}>
          <Pip still interactive={false} mood="focus" progress={0.6} size={420} />
        </div>
      </div>
    </div>
  )
}
