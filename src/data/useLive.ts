import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'

/** Subscribe to an IndexedDB query; re-runs whenever the tables it reads change (in any tab). */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial)
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: (e) => console.error(e) })
    return () => sub.unsubscribe()
  }, deps)
  return value
}
