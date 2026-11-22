import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { config, states, type State } from './config'
import { Glass } from './glass/Glass'
import { TextMotion } from './TextMotion'

function ResetIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 11a7 7 0 1 1 2 6m-2-6V5m0 6h6" />
  </svg>
}

// A url() inside a custom property resolves against the stylesheet that reads it (assets/), not the page, so the
// fallback backdrop gets the image as an absolute URL.
const sceneUrl = new URL(config.scene.image, document.baseURI).href

export function App() {
  const initial = config.enabled.includes(config.initial) ? config.initial : (config.enabled[0] ?? config.initial)
  const [state, setState] = useState<State>(initial)
  const [paused, setPaused] = useState(() => !config.motion || matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [ready, setReady] = useState(false)
  const [fallback, setFallback] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const glass = useRef<Glass | null>(null)
  const pausedRef = useRef(paused)
  const stateRef = useRef(state)
  pausedRef.current = paused
  stateRef.current = state

  useEffect(() => {
    const target = canvas.current!
    let mounted = true
    const create = () => {
      if (!mounted) return
      try {
        glass.current = new Glass(target, pane.current!, stateRef.current, pausedRef.current, () => {
          if (!mounted) return
          setFallback(false)
          setReady(true)
        }, () => {
          if (mounted) setFallback(true)
        })
      } catch (error) {
        setFallback(true)
        console.warn('Glass renderer unavailable', error)
      }
    }
    const lost = (event: Event) => {
      event.preventDefault()
      glass.current?.dispose()
      glass.current = null
      setReady(false)
      setFallback(true)
    }
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const reduce = (event: MediaQueryListEvent) => setPaused(!config.motion || event.matches)
    target.addEventListener('webglcontextlost', lost)
    target.addEventListener('webglcontextrestored', create)
    media.addEventListener('change', reduce)
    create()
    return () => {
      mounted = false
      glass.current?.dispose()
      glass.current = null
      target.removeEventListener('webglcontextlost', lost)
      target.removeEventListener('webglcontextrestored', create)
      media.removeEventListener('change', reduce)
    }
  }, [])

  useEffect(() => glass.current?.setPaused(paused), [paused])

  function choose(next: State) {
    if (next !== state) glass.current?.setState(next)
    else if (next === 'dust') glass.current?.reset()
    setState(next)
  }

  return (
    <main className="glass-app" data-static={fallback} data-state={state} data-motion={!paused}
      style={{ '--scene': `url("${sceneUrl}")`, '--anchor': `${config.scene.anchor * 100}%` } as CSSProperties}>
      <div className="backdrop" aria-hidden="true" />
      <canvas ref={canvas} className="glass-canvas" data-ready={ready && !fallback} aria-hidden="true" />
      <div className="grading" aria-hidden="true" />
      <div ref={pane} className="pane" aria-hidden="true" />
      <header className="top">
        <img className="brand-mark" src={`${import.meta.env.BASE_URL}logo.png`} width="42" height="22"
          alt="" aria-hidden="true" />
      </header>
      <footer className="lower">
        <TextMotion as="h1" text={config.title} paused={paused} />
        <div className="bottom">
          <nav className="materials" aria-label="Glass state">
            {config.enabled.map(item => <button key={item} aria-pressed={state === item} onClick={() => choose(item)}>
              <span className="material-indicator" aria-hidden="true" />
              <TextMotion text={states[item].label} paused={paused} />
            </button>)}
          </nav>
          {state === 'dust' && !fallback && <button className="reset" title="reset surface" onClick={() => glass.current?.reset()}>
            <ResetIcon /><TextMotion text="reset surface" paused={paused} />
          </button>}
        </div>
      </footer>
    </main>
  )
}
