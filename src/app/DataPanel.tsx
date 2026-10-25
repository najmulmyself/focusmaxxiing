import { useRef, useState } from 'react'
import { createBackup, download, fileStamp, importBackup, lastBackupAt, markBackedUp, readDataset, type ImportSummary } from '../data/backup'
import { BackupError, sessionsCSV, sessionsICS, tasksCSV, type Dataset } from '../data/formats'

export interface ExportRange {
  from: number
  to: number
  label: string
}

const ago = (ms: number) => {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function inRange(d: Dataset, r: ExportRange | null): Dataset {
  if (!r) return d
  return { ...d, sessions: d.sessions.filter((s) => s.startedAt >= r.from && s.startedAt < r.to) }
}

/** Export (backup, CSV, calendar) and restore. Used in Settings and from Reports. */
export function DataPanel({ range, onRestored }: { range?: ExportRange; onRestored?: () => void }) {
  const [scope, setScope] = useState<'all' | 'range'>(range ? 'range' : 'all')
  const [last, setLast] = useState(lastBackupAt)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [withSettings, setWithSettings] = useState(true)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: true; summary: ImportSummary } | { ok: false; error: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const active = scope === 'range' && range ? range : null
  const suffix = active ? `${fileStamp(active.from)}_to_${fileStamp(active.to - 1)}` : fileStamp()

  async function backup() {
    const b = await createBackup()
    download(`focusmaxxiing-backup-${fileStamp()}.json`, JSON.stringify(b, null, 1), 'application/json')
    markBackedUp()
    setLast(Date.now())
  }

  async function exportAs(kind: 'sessions' | 'tasks' | 'ics') {
    const d = inRange(await readDataset(), active)
    if (kind === 'sessions') download(`focusmaxxiing-sessions-${suffix}.csv`, sessionsCSV(d), 'text/csv;charset=utf-8')
    if (kind === 'tasks') download(`focusmaxxiing-tasks-${fileStamp()}.csv`, tasksCSV(d), 'text/csv;charset=utf-8')
    if (kind === 'ics') download(`focusmaxxiing-focus-${suffix}.ics`, sessionsICS(d), 'text/calendar;charset=utf-8')
  }

  async function restore() {
    if (!file) return
    setBusy(true)
    setResult(null)
    try {
      const summary = await importBackup(await file.text(), { mode, settings: withSettings })
      setResult({ ok: true, summary })
      setFile(null)
      setConfirmReplace(false)
      if (fileRef.current) fileRef.current.value = ''
      onRestored?.()
    } catch (e) {
      setResult({ ok: false, error: e instanceof BackupError ? e.message : 'The backup could not be read. Your data was not changed.' })
    } finally {
      setBusy(false)
    }
  }

  const row = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2'
  const sub = 'block text-sm text-muted'

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border-2 border-line bg-bg p-4">
        <div className={row}>
          <div className="min-w-0">
            <span className="font-semibold">Full backup</span>
            <span className={sub}>Everything: sessions, tasks, projects, templates and settings. Restorable here.</span>
          </div>
          <button className="btn bg-fg px-4 py-2 text-sm text-bg" onClick={() => void backup()}>Export backup</button>
        </div>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-muted">
          {last ? `Last backup: ${ago(last)}` : 'No backup yet from this browser'}
        </p>
      </div>

      <div>
        <div className="mb-2 font-semibold">Spreadsheets &amp; calendar</div>
        {range && (
          <div role="radiogroup" aria-label="What to export" className="mb-3 flex flex-wrap gap-1.5">
            <button role="radio" aria-checked={scope === 'range'} onClick={() => setScope('range')} className="btn px-3 py-1.5 text-sm aria-checked:bg-fg aria-checked:text-bg">{range.label}</button>
            <button role="radio" aria-checked={scope === 'all'} onClick={() => setScope('all')} className="btn px-3 py-1.5 text-sm aria-checked:bg-fg aria-checked:text-bg">All time</button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn px-4 py-2 text-sm" onClick={() => void exportAs('sessions')}>Sessions (.csv)</button>
          <button className="btn px-4 py-2 text-sm" onClick={() => void exportAs('tasks')}>Tasks (.csv)</button>
          <button className="btn px-4 py-2 text-sm" onClick={() => void exportAs('ics')}>Calendar (.ics)</button>
        </div>
        <p className="mt-2 text-sm text-muted">CSV opens in Excel, Numbers or Google Sheets. The calendar file adds your focus sessions as events.</p>
      </div>

      <div className="border-t-2 border-line/10 pt-5">
        <div className="font-semibold">Restore from a backup</div>
        <label htmlFor="restore-file" className={sub}>Choose a .json file made with “Export backup”.</label>
        <input
          id="restore-file"
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setResult(null)
          }}
          className="mt-2 block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-lg file:border-2 file:border-line file:bg-surface file:px-3 file:py-1.5 file:font-semibold file:text-fg"
        />
        {file && (
          <div className="mt-3 flex flex-col gap-3">
            <div role="radiogroup" aria-label="How to restore" className="flex flex-col gap-2">
              <label className="flex items-start gap-2">
                <input type="radio" name="restore-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} className="mt-1 accent-[var(--vermilion)]" />
                <span><b>Merge</b> <span className="text-muted">(recommended): adds what's missing and keeps the newer copy of anything edited. Nothing here is deleted.</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="restore-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-1 accent-[var(--vermilion)]" />
                <span><b>Replace</b> <span className="text-muted">: makes this browser an exact copy of the backup. Anything not in the backup is removed. If sync is on, anything still in your cloud copy comes back on the next sync.</span></span>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withSettings} onChange={(e) => setWithSettings(e.target.checked)} className="size-4 accent-[var(--vermilion)]" />
              Also restore settings
            </label>
            {mode === 'replace' && (
              <label className="flex items-center gap-2 rounded-lg border-2 border-[var(--vermilion)] px-3 py-2 text-sm">
                <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} className="size-4 accent-[var(--vermilion)]" />
                I understand this replaces all data in this browser.
              </label>
            )}
            <div>
              <button className="btn btn-accent px-5 py-2 text-sm" data-mode="focus" disabled={busy || (mode === 'replace' && !confirmReplace)} onClick={() => void restore()}>
                {busy ? 'Restoring…' : mode === 'merge' ? 'Merge backup' : 'Replace with backup'}
              </button>
            </div>
          </div>
        )}
        {result && (
          <div role="status" className={`mt-3 rounded-lg border-2 px-3 py-2 text-sm ${result.ok ? 'border-[var(--series-2)]' : 'border-[var(--vermilion)]'}`}>
            {result.ok ? (
              <>
                <b>Restored.</b>{' '}
                {result.summary.sessions.added} sessions, {result.summary.tasks.added} tasks and {result.summary.projects.added} projects added
                {result.summary.sessions.updated + result.summary.tasks.updated > 0 && `; ${result.summary.sessions.updated + result.summary.tasks.updated} updated to newer versions`}
                .{result.summary.settings && ' Settings restored.'}
              </>
            ) : (
              <><b>Nothing was imported.</b> {result.error}</>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
