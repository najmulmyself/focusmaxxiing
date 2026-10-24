/* Hand-tuned 24px icons: 2.2 stroke, round caps, consistent with the sticker style. */
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }

export const IconReset = () => <svg {...base}><path d="M4 12a8 8 0 1 0 2.5-5.8" /><path d="M4 4v4.5h4.5" /></svg>
export const IconSkip = () => <svg {...base}><path d="M5 5l9 7-9 7z" /><path d="M18 5v14" /></svg>
export const IconSettings = () => (
  <svg {...base}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2.2" />
    <circle cx="9" cy="17" r="2.2" />
  </svg>
)
export const IconPip = () => <svg {...base}><rect x="3" y="5" width="18" height="14" rx="2.5" /><rect x="12" y="11" width="6.5" height="5.5" rx="1.2" fill="currentColor" stroke="none" /></svg>
export const IconKeys = () => <svg {...base}><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" /></svg>
export const IconPlay = () => <svg {...base} strokeWidth={0} fill="currentColor"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8z" /></svg>
export const IconPause = () => <svg {...base} strokeWidth={0} fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1.2" /><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" /></svg>
export const IconSound = ({ muted }: { muted?: boolean }) => (
  <svg {...base}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
  </svg>
)
export const IconChart = () => <svg {...base}><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></svg>
