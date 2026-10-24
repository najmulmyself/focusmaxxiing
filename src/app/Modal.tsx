import { useEffect, useRef, type ReactNode } from 'react'

/** Accessible modal built on <dialog>: Escape and backdrop click close it, focus returns on close. */
export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-2rem)] ${width} rounded-[20px] border-2 border-line bg-surface p-0 text-fg shadow-[0_6px_0_var(--line)] backdrop:bg-[color-mix(in_oklab,var(--ink)_45%,transparent)] backdrop:backdrop-blur-[2px]`}
      aria-label={title}
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <h2 className="display text-3xl font-semibold">{title}</h2>
            <button className="btn size-9 shrink-0 text-lg" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M2 2l10 10M12 2L2 12" /></svg>
            </button>
          </div>
          <div className="mt-5">{children}</div>
        </div>
      )}
    </dialog>
  )
}
