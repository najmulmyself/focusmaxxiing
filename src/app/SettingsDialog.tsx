import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { playAlarm, setAmbient, unlockAudio } from '../audio/sound'
import type { AlarmSound, Ambient, Settings, Theme } from '../timer/settings'
import { db } from '../data/db'
import { useLive } from '../data/useLive'
import { addProject, updateProject } from '../data/tasks'
import { PROJECT_COLORS, projectColor, type Project } from '../data/model'
import { useState } from 'react'
import { DataPanel } from './DataPanel'
import { KEYS, readJSON } from '../data/local'
import { sanitize } from '../timer/settings'

const ALARMS: [AlarmSound, string][] = [['anvil', "Pip's anvil"], ['bell', 'Bell'], ['kitchen', 'Kitchen timer'], ['chime', 'Chime'], ['none', 'Silent']]
const AMBIENTS: [Ambient, string][] = [['none', 'Off'], ['fire', 'Fireplace'], ['rain', 'Rain'], ['brown', 'Brown noise']]
const THEMES: [Theme, string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t-2 border-line/15 pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-4 w-full font-mono text-xs uppercase tracking-[0.18em] text-muted">{title}</legend>
      <div className="clear-left flex flex-col gap-4">{children}</div>
    </fieldset>
  )
}

function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={htmlFor} className="min-w-0">
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function Switch({ id, on, onChange }: { id: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-8 w-14 shrink-0 rounded-full border-2 border-line transition-colors ${on ? 'bg-[var(--vermilion)]' : 'bg-[var(--paper-2)]'}`}
    >
      <span className={`absolute top-0.5 size-6 rounded-full border-2 border-line bg-paper transition-[left] duration-200 ease-[cubic-bezier(.3,.7,.4,1.4)] ${on ? 'left-[26px]' : 'left-0.5'}`} />
    </button>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={v === value} onClick={() => onChange(v)} className="btn px-3 py-1.5 text-sm aria-checked:bg-fg aria-checked:text-bg">
          {l}
        </button>
      ))}
    </div>
  )
}

const field = 'rounded-xl border-2 border-line bg-bg px-3 py-2 font-mono tabular-nums outline-none focus:shadow-[0_0_0_3px_var(--vermilion)]'

export function SettingsDialog({ open, onClose, settings: s, update, focusing }: { open: boolean; onClose: () => void; settings: Settings; update: (p: Partial<Settings>) => void; focusing: boolean }) {
  const num = (k: 'focusMin' | 'shortMin' | 'longMin' | 'longInterval') => ({
    id: `set-${k}`,
    type: 'number' as const,
    inputMode: 'numeric' as const,
    min: 1,
    value: s[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => e.target.value !== '' && update({ [k]: Number(e.target.value) }),
    className: field,
  })

  async function toggleNotifications(on: boolean) {
    if (on && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission()
      if (p !== 'granted') return update({ notifications: false })
    }
    update({ notifications: on })
  }

  const notifBlocked = 'Notification' in window && Notification.permission === 'denied'

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="flex flex-col gap-6">
        <Group title="Timer · minutes">
          <div className="grid grid-cols-3 gap-3">
            {([['focusMin', 'Focus'], ['shortMin', 'Short break'], ['longMin', 'Long break']] as const).map(([k, l]) => (
              <label key={k} htmlFor={`set-${k}`} className="text-sm font-semibold">
                {l}
                <input {...num(k)} max={180} className={`${field} mt-1.5 w-full`} />
              </label>
            ))}
          </div>
          <Row label="Long break every" hint="focus sessions" htmlFor="set-longInterval">
            <input {...num('longInterval')} max={12} className={`${field} w-20 text-center`} />
          </Row>
          <Row label="Auto-start breaks" htmlFor="set-auto-breaks">
            <Switch id="set-auto-breaks" on={s.autoStartBreaks} onChange={(v) => update({ autoStartBreaks: v })} />
          </Row>
          <Row label="Auto-start focus" hint="after a break ends" htmlFor="set-auto-focus">
            <Switch id="set-auto-focus" on={s.autoStartFocus} onChange={(v) => update({ autoStartFocus: v })} />
          </Row>
        </Group>

        <Group title="Sound">
          <div>
            <div className="mb-2 font-semibold">Alarm</div>
            <Segmented
              label="Alarm sound"
              value={s.alarm}
              options={ALARMS}
              onChange={(v) => {
                unlockAudio()
                update({ alarm: v })
                playAlarm(v, s.alarmVolume, 1)
              }}
            />
          </div>
          <Row label="Alarm volume" htmlFor="set-alarm-vol">
            <input id="set-alarm-vol" type="range" min={0} max={1} step={0.05} value={s.alarmVolume} onChange={(e) => update({ alarmVolume: +e.target.value })} onPointerUp={() => playAlarm(s.alarm, s.alarmVolume, 1)} className="w-40 accent-[var(--vermilion)]" />
          </Row>
          <Row label="Repeat alarm" htmlFor="set-alarm-rep">
            <input id="set-alarm-rep" type="number" min={1} max={5} value={s.alarmRepeat} onChange={(e) => e.target.value !== '' && update({ alarmRepeat: +e.target.value })} className={`${field} w-20 text-center`} />
          </Row>
          <div>
            <div className="mb-2 font-semibold">
              While focusing <span className="text-sm font-normal text-muted">· plays during focus sessions</span>
            </div>
            <Segmented
              label="Ambient sound"
              value={s.ambient}
              options={AMBIENTS}
              onChange={(v) => {
                unlockAudio()
                update({ ambient: v })
                // short preview when idle; during focus the timer screen switches the loop itself
                if (!focusing && v !== 'none') {
                  setAmbient(v, s.ambientVolume)
                  setTimeout(() => setAmbient('none', 0), 2500)
                }
              }}
            />
          </div>
          <Row label="Ambient volume" htmlFor="set-amb-vol">
            <input id="set-amb-vol" type="range" min={0} max={1} step={0.05} value={s.ambientVolume} onChange={(e) => update({ ambientVolume: +e.target.value })} className="w-40 accent-[var(--vermilion)]" />
          </Row>
        </Group>

        <Group title="Projects">
          <ProjectsEditor />
        </Group>

        <Group title="Your data">
          <DataPanel onRestored={() => update(sanitize(readJSON(KEYS.settings)))} />
        </Group>

        <Group title="Elsewhere">
          <Row label="Desktop notifications" hint={notifBlocked ? 'Blocked in your browser settings' : 'When a session ends and this tab is hidden'} htmlFor="set-notif">
            <Switch id="set-notif" on={s.notifications && !notifBlocked} onChange={toggleNotifications} />
          </Row>
          <div>
            <div className="mb-2 font-semibold">Theme</div>
            <Segmented label="Theme" value={s.theme} options={THEMES} onChange={(v) => update({ theme: v })} />
          </div>
        </Group>
      </div>
    </Modal>
  )
}

function ProjectRow({ p }: { p: Project }) {
  const [name, setName] = useState(p.name)
  const [picking, setPicking] = useState(false)
  return (
    <li className={`flex flex-wrap items-center gap-2 ${p.archived ? 'opacity-55' : ''}`}>
      <button
        className="size-7 shrink-0 rounded-full border-2 border-line"
        style={{ background: projectColor(p.color) }}
        aria-label={`Colour for ${p.name}`}
        aria-expanded={picking}
        onClick={() => setPicking(!picking)}
      />
      <label htmlFor={`proj-name-${p.id}`} className="sr-only">Project name</label>
      <input
        id={`proj-name-${p.id}`}
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== p.name && void updateProject(p.id, { name: name.trim() })}
        className="min-w-0 flex-1 rounded-lg border-2 border-transparent bg-transparent px-2 py-1 font-medium outline-none hover:border-line/20 focus:border-line"
      />
      <button className="btn px-2.5 py-1 text-xs" onClick={() => void updateProject(p.id, { archived: !p.archived })}>
        {p.archived ? 'Restore' : 'Archive'}
      </button>
      {picking && (
        <div className="flex w-full gap-1.5 pl-9" role="radiogroup" aria-label={`Colour for ${p.name}`}>
          {Array.from({ length: PROJECT_COLORS }, (_, i) => i + 1).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={c === p.color}
              aria-label={`Colour ${c}`}
              onClick={() => {
                void updateProject(p.id, { color: c })
                setPicking(false)
              }}
              className={`size-7 rounded-full border-2 border-line ${c === p.color ? 'ring-2 ring-fg ring-offset-2 ring-offset-surface' : ''}`}
              style={{ background: projectColor(c) }}
            />
          ))}
        </div>
      )}
    </li>
  )
}

function ProjectsEditor() {
  const projects = useLive(() => db.projects.orderBy('order').toArray(), [], [] as Project[])
  const [draft, setDraft] = useState('')
  return (
    <div>
      {projects.length === 0 && <p className="text-sm text-muted">Group tasks into projects to see where your focus goes.</p>}
      <ul className="flex flex-col gap-2">
        {projects.map((p) => (
          <ProjectRow key={p.id} p={p} />
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!draft.trim()) return
          await addProject(draft)
          setDraft('')
        }}
      >
        <label htmlFor="new-project" className="sr-only">New project</label>
        <input id="new-project" value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)} placeholder="New project" className={`${field} min-w-0 flex-1 font-sans`} />
        <button className="btn px-4 text-sm">Add</button>
      </form>
    </div>
  )
}
