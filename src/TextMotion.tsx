import { gsap } from 'gsap'
import { useLayoutEffect, useRef } from 'react'

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null

function splitText(copy: HTMLElement, text: string) {
  const content = document.createDocumentFragment()
  const letters: HTMLSpanElement[] = []

  for (const token of text.split(/(\s+)/u)) {
    if (!token) continue
    if (/^\s+$/u.test(token)) {
      content.append(token)
      continue
    }

    const word = document.createElement('span')
    word.className = 'text-motion-word'
    const graphemes = segmenter ? Array.from(segmenter.segment(token), item => item.segment) : Array.from(token)
    for (const grapheme of graphemes) {
      const letter = document.createElement('span')
      letter.className = 'text-motion-letter'
      letter.textContent = grapheme
      word.append(letter)
      letters.push(letter)
    }
    content.append(word)
  }

  copy.replaceChildren(content)
  return letters
}

type Props = {
  as?: 'span' | 'h1' | 'h2' | 'p' | 'small'
  text: string
  id?: string
  paused?: boolean
}

export function TextMotion({ as: Tag = 'span', text, id, paused = false }: Props) {
  const copyRef = useRef<HTMLSpanElement>(null)
  const finishRef = useRef<(() => void) | undefined>(undefined)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useLayoutEffect(() => {
    if (!text.trim()) return
    const copy = copyRef.current!
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    let current: ReturnType<typeof gsap.context> | undefined
    let master: ReturnType<typeof gsap.timeline> | undefined
    let cancelled = false
    let fontsReady = false
    let finished = false
    let fading = preference.matches || pausedRef.current
    let metrics = ''

    function makeTimeline(time = 0) {
      current?.revert()
      const letters = fading ? [] : splitText(copy, text)
      if (fading) copy.textContent = text

      current = gsap.context(() => {
        const timeline = gsap.timeline({ paused: true, onComplete: () => {
          finished = true
          observer.disconnect()
          document.fonts?.removeEventListener('loadingdone', measureFonts)
          document.removeEventListener('visibilitychange', syncPlayback)
          preference.removeEventListener('change', reduce)
          copy.dataset.textMotion = 'complete'
        } })
        master = timeline
        copy.dataset.textMotion = 'pending'

        if (fading) {
          gsap.set(copy, { opacity: 0 })
          timeline.to(copy, { opacity: 1, duration: .2, ease: 'none' })
        } else {
          gsap.set(letters, { y: '0.45em', opacity: 0, transformOrigin: '50% 50%' })
          const cycle = gsap.timeline()
          cycle.to(letters, { y: 0, opacity: 1, duration: .7, stagger: .03, ease: 'power3.out' })
          timeline.add(cycle, .1)
        }
        timeline.set(fading ? copy : letters, { clearProps: 'opacity,transform,transformOrigin' })
        timeline.time(Math.min(time, Math.max(0, timeline.duration() - .001)), true)
      }, copy)

      syncPlayback()
    }

    function syncPlayback() {
      if (!master || !fontsReady || finished || cancelled) return
      if (document.hidden) master.pause()
      else {
        copy.dataset.textMotion = 'playing'
        master.play()
      }
    }

    function measure() {
      if (finished || cancelled || fading) return
      const host = copy.parentElement!
      const { width, height } = host.getBoundingClientRect()
      const next = `${width}:${height}:${getComputedStyle(host).fontSize}`
      if (next === metrics) return
      metrics = next
      makeTimeline(master?.time() ?? 0)
    }

    function measureFonts() {
      metrics = ''
      measure()
    }

    function reduce() {
      const next = preference.matches || pausedRef.current
      if (finished || next === fading) return
      fading = next
      makeTimeline()
    }

    const observer = new ResizeObserver(measure)
    makeTimeline()
    observer.observe(copy.parentElement!)
    document.addEventListener('visibilitychange', syncPlayback)
    document.fonts?.addEventListener('loadingdone', measureFonts)
    preference.addEventListener('change', reduce)
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (cancelled) return
      fontsReady = true
      measureFonts()
      syncPlayback()
    })

    const finish = () => {
      if (!finished && !fading && !preference.matches) master?.progress(1)
    }
    finishRef.current = finish
    return () => {
      cancelled = true
      observer.disconnect()
      document.removeEventListener('visibilitychange', syncPlayback)
      document.fonts?.removeEventListener('loadingdone', measureFonts)
      preference.removeEventListener('change', reduce)
      current?.revert()
      delete copy.dataset.textMotion
      copy.textContent = text
      if (finishRef.current === finish) finishRef.current = undefined
    }
  }, [text])

  useLayoutEffect(() => {
    if (paused) finishRef.current?.()
  }, [paused])

  return (
    <Tag className="text-motion" id={id}>
      <span className="sr-only">{text}</span>
      <span key={text} ref={copyRef} className="text-motion-copy" aria-hidden="true">{text}</span>
    </Tag>
  )
}
