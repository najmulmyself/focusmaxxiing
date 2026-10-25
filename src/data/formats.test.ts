import { describe, expect, it } from 'vitest'
import type { SessionRecord } from '../timer/engine'
import type { Task } from './model'
import { BackupError, buildBackup, foldLine, mergeById, parseBackup, sessionVersion, sessionsCSV, sessionsICS, tasksCSV, toCSV, type Dataset } from './formats'

const T = new Date(2026, 9, 24, 9, 30).getTime()
const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1', mode: 'focus', status: 'completed', plannedSec: 1500, actualSec: 1500, startedAt: T, endedAt: T + 1_500_000, pauses: 0,
  taskId: 't1', projectId: 'p1', note: 'Drafted intro, "v2"', quality: 4, device: 'd', createdAt: T, revision: 1, ...over,
})
const task: Task = { id: 't1', title: 'Write, edit', notes: '', projectId: 'p1', est: 3, done: true, doneAt: T + 2e6, order: 1, createdAt: T - 1e6, updatedAt: T, deletedAt: null }
const data: Dataset = {
  sessions: [session(), session({ id: 's2', deletedAt: T }), session({ id: 's3', mode: 'short', taskId: null, projectId: null, note: '', quality: null })],
  tasks: [task],
  projects: [{ id: 'p1', name: 'Writing', color: 1, archived: false, order: 1, createdAt: T, updatedAt: T }],
  templates: [],
}

describe('CSV', () => {
  it('quotes delimiters and quotes, and guards formulas', () => {
    const csv = toCSV(['a', 'b', 'c'], [['x,y', 'say "hi"', '=SUM(A1)']])
    expect(csv).toBe('﻿a,b,c\r\n"x,y","say ""hi""",\'=SUM(A1)\r\n')
  })
  it('exports sessions with names resolved, skipping deleted ones', () => {
    const lines = sessionsCSV(data).trim().split('\r\n')
    expect(lines).toHaveLength(3) // header + s1 + s3
    expect(lines[1]).toBe('2026-10-24,09:30,09:55,25,Focus,Completed,"Write, edit",Writing,4,"Drafted intro, ""v2""",0,' + new Date(T).toISOString() + ',' + new Date(T + 1_500_000).toISOString() + ',s1')
  })
  it('exports tasks with pomodoro counts', () => {
    const line = tasksCSV(data).trim().split('\r\n')[1]
    expect(line.startsWith('"Write, edit",Writing,3,1,25,yes,')).toBe(true)
  })
})

describe('iCalendar', () => {
  it('writes one event per focus session, escaped and folded', () => {
    const ics = sessionsICS(data, T)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(ics).toContain('UID:s1@focusmaxxiing')
    expect(ics).toContain('SUMMARY:Focus: Write\\, edit')
    expect(ics).toContain('CATEGORIES:Writing')
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true)
  })
  it('folds long lines at 75 octets', () => {
    const folded = foldLine('DESCRIPTION:' + 'é'.repeat(80))
    for (const l of folded.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join('')).toBe('DESCRIPTION:' + 'é'.repeat(80))
  })
})

describe('JSON backup', () => {
  it('round-trips exactly, deleted rows included', () => {
    const b = buildBackup(data, null, 'dev', T)
    const parsed = parseBackup(JSON.stringify(b))
    expect(parsed.data).toEqual(data)
    expect(parsed.counts.sessions).toBe(3)
  })
  it('rejects files that are not backups, with a useful message', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError)
    expect(() => parseBackup('{"format":"other"}')).toThrow(/isn't a focusmaxxiing backup/)
    expect(() => parseBackup(JSON.stringify({ format: 'focusmaxxiing-backup', version: 99, data: {} }))).toThrow(/newer version/)
    const broken = buildBackup(data, null, 'dev', T) as unknown as { data: { sessions: unknown[] } }
    broken.data.sessions[1] = { id: 's2' }
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(/Record 2 in “sessions” is damaged/)
  })
})

describe('merge', () => {
  it('adds missing, takes newer, keeps local otherwise', () => {
    const local = [session({ id: 'a', revision: 2, note: 'local' }), session({ id: 'b', revision: 1, note: 'old' })]
    const incoming = [session({ id: 'a', revision: 1, note: 'stale' }), session({ id: 'b', revision: 3, note: 'new' }), session({ id: 'c' })]
    const r = mergeById(local, incoming, sessionVersion)
    expect([r.added, r.updated, r.unchanged]).toEqual([1, 1, 1])
    expect(r.put.map((x) => x.id)).toEqual(['b', 'c'])
    expect(r.put[0].note).toBe('new')
  })
})
