import { useState } from 'react'
import { updateSession } from '../../data/db'
import { setDone } from '../../data/tasks'
import type { Task } from '../../data/model'
import type { SessionRecord } from '../../timer/engine'

const LABELS = ['Scattered', 'Distracted', 'Okay', 'Focused', 'In the zone']

function Ember({ filled }: { filled: boolean }) {
  return (
    <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden>
      <path
        d="M11 2c1.5 4 7 6.5 7 13a7 7 0 0 1-14 0c0-3 1.4-5 3-6.5.3 2 1.2 3.2 2.4 3.6C9 9 9.6 5 11 2z"
        fill={filled ? '#FFB547' : 'transparent'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** After a focus session: one line on what got done, and how focused it felt. Optional, never blocking. */
export function Reflection({ record, task, onClose, onTaskDone }: { record: SessionRecord; task: Task | null; onClose: () => void; onTaskDone: () => void }) {
  const [note, setNote] = useState('')
  const [quality, setQuality] = useState<number | null>(null)
  const [markDone, setMarkDone] = useState(false)

  async function save() {
    if (note.trim() || quality !== null) await updateSession(record.id, { note: note.trim(), quality })
    if (markDone && task) {
      await setDone(task.id, true)
      onTaskDone()
    }
    onClose()
  }

  return (
    <form
      aria-label="Reflect on this session"
      className="mt-6 w-full max-w-md rounded-2xl border-2 border-line bg-surface p-4 text-fg shadow-[0_4px_0_var(--line)]"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label htmlFor="reflect-note" className="font-semibold">
        {Math.round(record.actualSec / 60)} minutes done. What did you get done?
      </label>
      <input
        id="reflect-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={task ? `On “${task.title}”…` : 'One line is plenty'}
        maxLength={500}
        className="mt-2 w-full rounded-lg border-2 border-line bg-bg px-3 py-2 outline-none focus:shadow-[0_0_0_3px_var(--vermilion)]"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="How focused were you?" className="flex items-center gap-0.5">
          {LABELS.map((l, i) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={quality === i + 1}
              aria-label={`${i + 1} of 5: ${l}`}
              title={l}
              onClick={() => setQuality(quality === i + 1 ? null : i + 1)}
              className="rounded-md p-0.5 transition-transform hover:-translate-y-0.5"
            >
              <Ember filled={quality !== null && i < quality} />
            </button>
          ))}
          <span className="ml-2 font-mono text-xs uppercase tracking-widest text-muted">{quality ? LABELS[quality - 1] : 'Focus?'}</span>
        </div>
        {task && !task.done && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} className="size-4 accent-[var(--vermilion)]" />
            Task finished
          </label>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn px-4 py-2 text-sm" onClick={onClose}>Skip</button>
        <button type="submit" className="btn bg-fg px-5 py-2 text-sm text-bg">Save</button>
      </div>
    </form>
  )
}
