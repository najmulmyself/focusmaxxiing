import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { sessionsBetween } from '../data/db'
import type { SessionRecord } from '../timer/engine'

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Today's sessions, live: updates whenever a session is saved (in any tab). */
export function useToday() {
  const [day, setDay] = useState(startOfDay)
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null)

  useEffect(() => {
    const sub = liveQuery(() => sessionsBetween(day, day + 86_400_000)).subscribe({
      next: setSessions,
      error: () => setSessions([]),
    })
    return () => sub.unsubscribe()
  }, [day])

  // roll over at midnight
  useEffect(() => {
    const id = setInterval(() => {
      const d = startOfDay()
      if (d !== day) setDay(d)
    }, 60_000)
    return () => clearInterval(id)
  }, [day])

  return sessions
}
