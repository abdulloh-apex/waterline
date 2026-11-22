export type State = 'rain' | 'frost' | 'mist' | 'dust'

export type Vessel = {
  sprite: string
  scale: number
  waterline: number
  speed: number
  interval: number
}

export const config = {
  title: 'waterline',
  scene: {
    image: `${import.meta.env.BASE_URL}silver-lake.webp`,
    anchor: 0.47,
    waterStart: .48,
    vessel: {
      sprite: `${import.meta.env.BASE_URL}sail.webp`,
      scale: .113,
      waterline: .615,
      speed: .019,
      interval: 61,
    } as Vessel | null,
  },
  initial: 'rain' as State,
  enabled: ['rain', 'frost', 'mist', 'dust'] as State[],
  motion: true,
  quality: {
    desktop: { pixelRatio: 1.4, maxPixels: 2_100_000, fieldScale: 0.85, maxField: 1440, drops: 1280 },
    mobile: { pixelRatio: 1.25, maxPixels: 830_000, fieldScale: 0.88, maxField: 850, drops: 520 },
    mobileWidth: 640,
  },
  transition: { seconds: 1.7, meltSeconds: 2.45, washSeconds: 3.25 },
  rain: { density: 0.87, speed: 1, refraction: 1, wipeRadius: .066, recoverySeconds: 6.2 },
  frost: { density: 0.96, thawSeconds: 1.28, recoverySeconds: 28 },
  mist: { density: 0.91, recoverySeconds: 18 },
  dust: { density: 0.85 },
}

export const states = {
  rain: { label: 'rain' },
  frost: { label: 'frost' },
  mist: { label: 'mist' },
  dust: { label: 'dust' },
} satisfies Record<State, { label: string }>
