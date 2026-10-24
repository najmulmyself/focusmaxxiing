import { useEffect, useState } from 'react'
import { MascotLab } from './pages/MascotLab'
import { StyleTile } from './pages/StyleTile'
import { AssetSheet } from './pages/AssetSheet'
import { TimerApp } from './app/TimerApp'

type Route = 'timer' | 'style' | 'mascot' | 'assets'

function readRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  return h === 'mascot' || h === 'assets' || h === 'style' ? h : 'timer'
}

/** The timer is the app; the style tile and mascot lab stay as design references. */
export function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (route === 'assets') return <AssetSheet />
  if (route === 'timer') return <TimerApp />
  return (
    <div className="grain min-h-dvh">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 pt-5 sm:px-8">
        <a href="#/" className="display text-xl font-semibold tracking-tight">
          focusmaxxiing<span className="text-[var(--vermilion)]">.</span>
        </a>
        <div className="flex gap-2 text-sm">
          <a className="btn px-3 py-1.5" href="#/">Timer</a>
          <a className="btn px-3 py-1.5" aria-pressed={route === 'style'} href="#/style">Style tile</a>
          <a className="btn px-3 py-1.5" aria-pressed={route === 'mascot'} href="#/mascot">Meet Pip</a>
        </div>
      </nav>
      {route === 'mascot' ? <MascotLab /> : <StyleTile />}
    </div>
  )
}
