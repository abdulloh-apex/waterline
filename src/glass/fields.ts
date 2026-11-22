import { config } from '../config'

export function field(width = 1, height = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  return { canvas, ctx }
}

function seeded(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

export function growCrystals(ctx: CanvasRenderingContext2D) {
  const { width, height } = ctx.canvas
  const random = seeded(3981)
  const scale = Math.min(width, height)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.globalCompositeOperation = 'lighter'
  const nuclei: { x: number; y: number }[] = []

  function branch(x: number, y: number, direction: number, length: number, depth: number, light: number) {
    const segments = depth >= 2 ? 9 : depth === 1 ? 5 : 2
    const step = length / segments
    for (let i = 0; i < segments; i++) {
      const angle = direction + (random() - .5) * (depth === 0 ? .53 : .24)
      const endX = x + Math.cos(angle) * step
      const endY = y + Math.sin(angle) * step
      ctx.strokeStyle = `rgba(255,0,0,${(random() * .56 + .25) * light * (1 - i / segments * .25)})`
      ctx.lineWidth = (depth * .39 + .32 + random() * .27) * Math.max(.8, scale / 640)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(endX, endY)
      ctx.stroke()
      if (depth > 0 && i > 0) {
        const side = i % 2 ? -1 : 1
        const fork = (.28 + random() * .32) * (1.12 - i / segments * .65)
        branch(x, y, angle + side * (.54 + random() * .50), length * fork, depth - 1, light * .90)
        if (depth >= 2 && random() > .27) {
          branch(x, y, angle - side * (.60 + random() * .43), length * fork * (.54 + random() * .49), depth - 1, light * .72)
        }
      }
      x = endX
      y = endY
    }
  }

  const count = Math.ceil(86 * width * height / (scale * scale))
  for (let i = 0; i < count; i++) {
    const edge = i % 5
    const margin = random() ** 2.1 * scale * .29
    const x = edge === 0 ? margin : edge === 1 ? width - margin : random() * width
    const y = edge === 2 ? margin : edge === 3 ? height - margin : random() * height
    const length = scale * (.008 + random() ** 2.0 * .087)
    const bright = edge === 4 ? .49 : .86
    const angle = random() * Math.PI * 2
    const bloom = ctx.createRadialGradient(x, y, 0, x, y, length * 1.56)
    bloom.addColorStop(0, `rgba(0,255,0,${bright * (.10 + random() * .16)})`)
    bloom.addColorStop(1, 'rgba(0,255,0,0)')
    ctx.fillStyle = bloom
    ctx.fillRect(x - length * 1.56, y - length * 1.56, length * 3.12, length * 3.12)
    const arms = length > scale * .035 ? 3 + Math.floor(random() * 3) : 2
    for (let arm = 0; arm < arms; arm++) {
      branch(x, y, angle + arm * Math.PI * 1.97 / arms + random() * .6, length * (.35 + random() * .91), length > scale * .03 ? 2 : 1, bright)
    }
    if (length > scale * .044) nuclei.push({ x: x / width, y: y / height })
  }

  // Longer dendrites grow inward from the colder perimeter of the pane.
  const borderCount = Math.round((width + height) / scale * 17)
  for (let i = 0; i < borderCount; i++) {
    const side = i % 4
    const offset = random() * scale * .055
    const x = side === 0 ? offset : side === 1 ? width - offset : random() * width
    const y = side === 2 ? offset : side === 3 ? height - offset : random() * height
    const inward = [0, Math.PI, Math.PI / 2, -Math.PI / 2][side]
    const length = scale * (.038 + random() ** 1.25 * .21)
    branch(x, y, inward + (random() - .5) * 1.96, length, i % 7 === 0 ? 3 : 2, .82 + random() * .19)
    nuclei.push({ x: x / width, y: y / height })
  }
  ctx.globalCompositeOperation = 'source-over'
  return nuclei
}

export type PanePoint = { x: number; y: number }

type Drop = {
  x: number
  y: number
  lastX: number
  lastY: number
  size: number
  stretch: number
  speed: number
  phase: number
  angle: number
  temporary?: true
  releaseAt?: number
}

export class WaterField {
  readonly layer = field()
  private runoff = field()
  private paths = field()
  private lenses = [field(48, 48), field(48, 48), field(48, 48), field(48, 48)]
  private drops: Drop[] = []
  private moving: Drop[] = []
  private width = 1
  private height = 1
  private scale = 1
  private elapsed = 0

  constructor() {
    for (let i = 0; i < this.lenses.length; i++) {
      const { ctx } = this.lenses[i]
      const pixels = ctx.createImageData(48, 48)
      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 48; x++) {
          const v = (y - 23.5) / 22.6
          const u = (x - 23.5) / 22.6 + Math.sin(v * 3.6 + i) * (.02 + i * .035)
          const angle = Math.atan2(v, u)
          const edge = 1 + Math.cos(angle * 3 + i * 1.52) * (.024 + i * .038)
            + Math.sin(angle * 5 + i * .87) * (.012 + i * .009)
          const radius = Math.hypot(u / (1 + v * (.03 + i * .09)), v) / edge
          const volume = Math.max(0, 1 - radius * radius)
          const index = (y * 48 + x) * 4
          pixels.data[index] = 255
          pixels.data[index + 3] = Math.round(Math.pow(volume, .66) * 255)
        }
      }
      ctx.putImageData(pixels, 0, 0)
    }
  }

  resize(width: number, height: number, count: number) {
    this.layer.canvas.width = this.runoff.canvas.width = this.paths.canvas.width = this.width = width
    this.layer.canvas.height = this.runoff.canvas.height = this.paths.canvas.height = this.height = height
    this.scale = Math.max(.59, Math.min(width, height) / 670)
    const random = seeded(9191)
    this.drops = []
    this.moving = []
    for (let i = 0; i < count; i++) {
      const x = random() * width
      const y = random() * height
      const moving = random() > .973
      const size = (moving ? 2.8 + random() ** 1.12 * 6.45 : .70 + random() ** 2.68 * 7.15) * this.scale
      const speed = moving ? (19 + size * 6.2 + random() ** 2 * 103) * Math.max(this.scale, .68) : 0
      const drop = { x, y, lastX: x, lastY: y, size, speed, stretch: moving ? 1.22 + random() * .94 : .74 + random() * .57, phase: random() * 10, angle: (random() - .5) * .95 }
      this.drops.push(drop)
      if (speed) this.moving.push(drop)
    }
  }

  spawn(x: number, y: number, velocity = 1) {
    if (this.moving.length > 93) return
    const size = (2 + Math.random() * 4) * Math.max(.7, this.scale)
    const drop: Drop = {
      x: x * this.width, y: y * this.height,
      lastX: x * this.width, lastY: y * this.height, size,
      stretch: 1.48, speed: velocity * (26 + size * 8), phase: Math.random() * 10,
      angle: 0, temporary: true,
    }
    this.drops.push(drop)
    this.moving.push(drop)
  }

  wipe(from: PanePoint, to: PanePoint, relativeRadius: number) {
    const x = from.x * this.width
    const y = from.y * this.height
    const dx = (to.x - from.x) * this.width
    const dy = (to.y - from.y) * this.height
    const lengthSquared = dx * dx + dy * dy
    const radius = Math.min(this.width, this.height) * relativeRadius
    const reach = radius * .87
    const left = Math.min(x, x + dx) - reach
    const right = Math.max(x, x + dx) + reach
    const top = Math.min(y, y + dy) - reach
    const bottom = Math.max(y, y + dy) + reach
    let moved = false

    for (const drop of this.drops) {
      if (drop.size <= 0 || drop.x < left || drop.x > right || drop.y < top || drop.y > bottom) continue

      const along = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((drop.x - x) * dx + (drop.y - y) * dy) / lengthSquared))
        : 0
      const cx = x + along * dx
      const cy = y + along * dy
      const horizontal = drop.x - cx
      const vertical = drop.y - cy
      const distance = Math.hypot(horizontal, vertical)
      if (distance >= reach) continue
      const normalX = distance > .01 ? horizontal / distance : 0
      const normalY = distance > .01 ? vertical / distance : 1
      const distanceToEdge = radius * (.91 + .12 * Math.abs(Math.sin(drop.phase))) + drop.size * .28

      drop.x = drop.lastX = Math.max(0, Math.min(this.width, cx + normalX * distanceToEdge))
      drop.y = drop.lastY = Math.max(0, Math.min(this.height, cy + normalY * distanceToEdge))
      moved = true

      // Beads collect at the lower edge. The heavier ones release into a run.
      if (!drop.speed && normalY > .12 && drop.size > this.scale * 2.4 && this.moving.length < 72) {
        drop.size *= 1.14
        drop.speed = 21 + drop.size * 8
        drop.stretch = Math.max(1.35, drop.stretch)
        drop.releaseAt = this.elapsed + .14 + Math.abs(Math.sin(drop.phase * 1.7)) * .43
        this.moving.push(drop)
      }
    }

    return moved
  }

  resetRunoff() {
    this.runoff.ctx.clearRect(0, 0, this.width, this.height)
  }

  step(dt: number, rain: number, carriesDust: boolean, mist: number) {
    this.elapsed += dt
    const ctx = this.layer.ctx
    const runoff = this.runoff.ctx
    const paths = this.paths.ctx
    if (dt > 0) {
      paths.globalCompositeOperation = 'destination-out'
      paths.fillStyle = `rgba(0,0,0,${Math.min(.15, dt * .83)})`
      paths.fillRect(0, 0, this.width, this.height)
      paths.globalCompositeOperation = 'source-over'
      paths.lineCap = 'round'
    }
    for (let i = this.moving.length - 1; i >= 0; i--) {
      const drop = this.moving[i]
      drop.lastX = drop.x
      drop.lastY = drop.y
      if (drop.releaseAt !== undefined && this.elapsed < drop.releaseAt) continue
      const flow = .5 + .5 * Math.sin(this.elapsed * (1.5 + drop.phase * .15) + drop.phase)
      const pulse = .09 + flow * flow * 1.28 + .20 * Math.max(0, Math.sin(this.elapsed * 5.3 + drop.phase * 3))
      const release = drop.releaseAt === undefined ? 0 : Math.min(1, (this.elapsed - drop.releaseAt) * 3.3)
      const flowSpeed = drop.releaseAt === undefined ? pulse : (.22 + release * .91) * (.67 + pulse * .33)
      const speed = (drop.temporary ? 1 : Math.max(.07, rain, mist * .09)) * flowSpeed
      drop.x = Math.max(0, Math.min(this.width, drop.x + Math.sin(this.elapsed * 1.47 + drop.phase) * dt * (3 + drop.size * .66) * speed))
      drop.y += drop.speed * dt * speed * config.rain.speed
      if (drop.y > this.height + drop.size * 12) {
        if (drop.temporary) {
          this.drops.splice(this.drops.indexOf(drop), 1)
          this.moving.splice(i, 1)
          continue
        }
        drop.releaseAt = undefined
        drop.y = -drop.size * 5
        drop.x = Math.random() * this.width
        drop.lastY = drop.y
        drop.lastX = drop.x
        drop.size = Math.max(this.scale * 2, drop.size * (.76 + Math.random() * .25))
      }
      if (dt > 0 && rain > .15) {
        for (const bead of this.drops) {
          if (bead.speed || bead.size > drop.size || bead.size < 0) continue
          const reach = (drop.size + bead.size) * .65
          if (Math.abs(bead.x - drop.x) > reach || Math.abs(bead.y - drop.y) > reach * 1.3) continue
          drop.size = Math.min(drop.size + bead.size * .31, 10 * Math.max(this.scale, .7))
          bead.size = -bead.size
          bead.phase = this.elapsed + 4 + Math.random() * 8
        }
      }

      if (dt > 0 && rain > .055 && drop.y > drop.lastY) {
        paths.strokeStyle = `rgba(0,0,255,${Math.min(.83, .27 + drop.size * .05)})`
        paths.lineWidth = Math.max(1, drop.size * (.27 + Math.sin(this.elapsed * 5 + drop.phase) * .085))
        paths.beginPath()
        paths.moveTo(drop.lastX, drop.lastY)
        paths.lineTo(drop.x, drop.y)
        paths.stroke()
      }
      if (carriesDust && dt > 0 && rain > .035) {
        runoff.lineCap = 'round'
        runoff.strokeStyle = 'rgba(0,255,0,.37)'
        runoff.lineWidth = Math.max(5, drop.size * 2.9)
        runoff.beginPath()
        runoff.moveTo(drop.lastX, drop.lastY)
        runoff.lineTo(drop.x, drop.y)
        runoff.stroke()
      }
    }
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, this.width, this.height)
    if (carriesDust) ctx.drawImage(this.runoff.canvas, 0, 0)
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(this.paths.canvas, 0, 0)
    const density = Math.min(1, Math.max(0, config.rain.density))
    const total = Math.floor(this.drops.length * (.28 + density * .72))
    for (let i = 0; i < this.drops.length; i++) {
      const drop = this.drops[i]
      if (i >= total && !drop.temporary) continue
      if (drop.size < 0) {
        if (this.elapsed < drop.phase) continue
        drop.size *= -1
        drop.x = Math.random() * this.width
        drop.y = Math.random() * this.height
      }
      const lens = this.lenses[Math.floor(drop.phase * 3.3) % this.lenses.length].canvas
      if (drop.speed && rain > .05 && (drop.releaseAt === undefined || this.elapsed >= drop.releaseAt)) {
        const tail = drop.size * (1.48 + Math.min(2.63, drop.speed * .024))
        ctx.globalAlpha = .49 * Math.min(1, rain * 2)
        ctx.drawImage(lens, drop.x - drop.size * .22, drop.y - tail, drop.size * .44, tail * 1.25)
      }
      ctx.globalAlpha = .98
      ctx.save()
      ctx.translate(drop.x, drop.y)
      ctx.rotate(drop.angle + .13 * Math.sin(drop.phase + this.elapsed * .7))
      ctx.drawImage(lens, -drop.size, -drop.size * drop.stretch, drop.size * 2, drop.size * drop.stretch * (drop.speed ? 2.2 : 2))
      ctx.restore()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}
