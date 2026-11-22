import { config } from '../config'
import { field } from './fields'

const frameInterval = 1 / 27

export class LakeScene {
  readonly poster = new Image()
  private sailboat = new Image()
  private composite = field()
  private occupied = false
  private refresh = true
  private viewLeft = 0
  private viewWidth = 1
  private travel = NaN
  private elapsed = 0
  private sinceFrame = 0

  load(ready: () => void, failed: () => void) {
    const vessel = config.scene.vessel
    let posterReady = false
    let vesselSettled = !vessel
    const finish = () => {
      if (posterReady && vesselSettled) ready()
    }
    this.poster.onload = () => {
      const scale = Math.min(1, 1440 / this.poster.naturalWidth)
      this.composite.canvas.width = Math.round(this.poster.naturalWidth * scale)
      this.composite.canvas.height = Math.round(this.poster.naturalHeight * scale)
      posterReady = true
      finish()
    }
    this.poster.onerror = failed
    if (vessel) {
      this.sailboat.onload = this.sailboat.onerror = () => {
        vesselSettled = true
        finish()
      }
      this.sailboat.src = vessel.sprite
    }
    this.poster.src = config.scene.image
  }

  setView(left: number, width: number) {
    if (left === this.viewLeft && width === this.viewWidth) return

    const vessel = config.scene.vessel
    if (vessel) {
      const oldX = this.viewLeft + this.travel - vessel.scale
      const visible = Number.isFinite(oldX) && oldX + vessel.scale > left && oldX < left + width
      this.travel = visible ? oldX - left + vessel.scale : width * .47 + vessel.scale * .5
    }
    this.viewLeft = left
    this.viewWidth = width
    this.refresh = true
  }

  frame(dt: number, first = false): TexImageSource | null {
    this.elapsed += dt
    this.sinceFrame += dt

    const { ctx, canvas } = this.composite
    const { width, height } = canvas
    const motion = config.scene.vessel
    if (!motion || !this.sailboat.naturalWidth) {
      if (!first) return null
      ctx.drawImage(this.poster, 0, 0, width, height)
      return canvas
    }

    const crossing = this.viewWidth + motion.scale
    const coastPause = Math.max(0, motion.interval * motion.speed - (1 + motion.scale))
    if (!Number.isFinite(this.travel)) this.travel = this.viewWidth * .47 + motion.scale * .5
    this.travel = (this.travel + dt * motion.speed) % (crossing + coastPause)

    if (!first && !this.refresh && this.sinceFrame < frameInterval) return null
    this.sinceFrame %= frameInterval
    this.refresh = false

    const span = width * motion.scale
    const sailHeight = span * this.sailboat.naturalHeight / this.sailboat.naturalWidth
    const x = (this.viewLeft + this.travel - motion.scale) * width
    const visible = this.travel < crossing
    if (!first && !visible && !this.occupied) return null
    this.occupied = visible
    ctx.drawImage(this.poster, 0, 0, width, height)
    if (visible) {
      const waterline = height * motion.waterline + Math.sin(this.elapsed * 1.8) * .65
      this.drawWake(ctx, x, waterline, span)

      ctx.save()
      ctx.translate(x, waterline + 1)
      ctx.scale(1, -.42)
      ctx.globalAlpha = .23
      ctx.filter = 'blur(2px)'
      ctx.drawImage(this.sailboat, 0, -sailHeight, span, sailHeight)
      ctx.restore()

      ctx.save()
      ctx.translate(x + span * .54, waterline)
      ctx.rotate(Math.sin(this.elapsed * .96) * .014)
      ctx.globalAlpha = .96
      ctx.filter = 'brightness(.88) saturate(.70)'
      ctx.drawImage(this.sailboat, -span * .54, -sailHeight, span, sailHeight)
      ctx.restore()
    }
    return canvas
  }

  private drawWake(ctx: CanvasRenderingContext2D, x: number, waterline: number, span: number) {
    const length = span * .91
    const wake = ctx.createLinearGradient(x - length, 0, x + span * .22, 0)
    wake.addColorStop(0, '#f8faf300')
    wake.addColorStop(.67, '#f8faf375')
    wake.addColorStop(1, '#f8faf300')
    ctx.save()
    ctx.strokeStyle = wake
    ctx.lineWidth = Math.max(1, span * .014)
    ctx.filter = 'blur(.7px)'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(x - length, waterline + side * span * .062)
      ctx.quadraticCurveTo(x - length * .30, waterline + side * span * .018, x + span * .22, waterline + 1)
      ctx.stroke()
    }
    ctx.restore()
  }

  dispose() {
    this.poster.onload = this.poster.onerror = null
    this.sailboat.onload = this.sailboat.onerror = null
  }
}
