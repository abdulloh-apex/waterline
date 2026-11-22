import { config, type State } from '../config'
import { field, growCrystals, WaterField, type PanePoint } from './fields'
import { fragmentSource, vertexSource } from './shader'
import { LakeScene } from './LakeScene'

const stateNames: State[] = ['rain', 'frost', 'mist', 'dust']
const recoveries = [config.rain.recoverySeconds, config.frost.recoverySeconds, config.mist.recoverySeconds, Infinity]
const smooth = (amount: number) => amount * amount * (3 - 2 * amount)
const clamp = (amount: number) => Math.max(0, Math.min(1, amount))

function program(gl: WebGL2RenderingContext) {
  const result = gl.createProgram()!
  const shaders: WebGLShader[] = []
  try {
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
      const shader = gl.createShader(kind)!
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed')
      gl.attachShader(result, shader)
    }
    gl.linkProgram(result)
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? 'Program link failed')
    return result
  } catch (error) {
    gl.deleteProgram(result)
    throw error
  } finally {
    for (const shader of shaders) gl.deleteShader(shader)
  }
}

type Touch = { id: number; point: PanePoint; elapsed: number; dropTimer: number; lastWarmth: number }
type Mask = ReturnType<typeof field> & { dirty: boolean; age: number }

export class Glass {
  private gl: WebGL2RenderingContext
  private pipeline: WebGLProgram
  private quad: WebGLBuffer
  private textures: WebGLTexture[]
  private locations: Record<string, WebGLUniformLocation | null> = {}
  private crystal = field()
  private nuclei: PanePoint[] = []
  private water = new WaterField()
  private masks: Mask[] = stateNames.map(() => ({ ...field(), dirty: true, age: Infinity }))
  private maskBuffer = field()
  private brushTip = field(100, 100)
  private cleanTip = field(100, 100)
  private scene = new LakeScene()
  private sceneTime = 0
  private events = new AbortController()
  private observer: ResizeObserver
  private frame = 0
  private lastTick = 0
  private recoveryTick = 0
  private phase = 1
  private origin = new Float32Array(4)
  private weights = new Float32Array(4)
  private density = [config.rain.density, config.frost.density, config.mist.density, config.dust.density]
  private goal: number
  private touch: Touch | null = null
  private loaded = false
  private disposed = false
  private carryDust = false
  private meltTimer = 0
  private waterTick = 0
  private frameInterval = 1 / 45
  private masksDirty = true
  private needsWater = true

  constructor(
    private canvas: HTMLCanvasElement,
    private pane: HTMLDivElement,
    initial: State,
    private paused: boolean,
    ready: () => void,
    failed: () => void,
  ) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false })
    if (!gl) throw new Error('WebGL 2 is unavailable')
    this.gl = gl
    this.goal = stateNames.indexOf(initial)
    this.weights[this.goal] = this.origin[this.goal] = 1
    this.pipeline = program(gl)
    gl.useProgram(this.pipeline)

    for (const name of ['uScene','uWater','uCrystal','uBrush','uCover','uOffset','uPixels','uField','uState','uDensity','uRefraction','uSceneTime','uWaterStart']) {
      this.locations[name] = gl.getUniformLocation(this.pipeline, name)
    }
    this.textures = ['uScene','uWater','uCrystal','uBrush'].map((name, index) => {
      const target = index === 3 ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D
      const texture = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE0 + index)
      gl.bindTexture(target, texture)
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, index === 0 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.uniform1i(this.locations[name], index)
      return texture
    })
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(this.pipeline, 'aPosition')
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(position)
    gl.uniform4fv(this.locations.uDensity, this.density)
    gl.uniform1f(this.locations.uRefraction, config.rain.refraction)
    gl.uniform1f(this.locations.uWaterStart, config.scene.waterStart)
    this.createTip(this.brushTip.ctx, .54)
    this.createTip(this.cleanTip.ctx, .77)

    const listeners = { signal: this.events.signal }
    pane.addEventListener('pointerdown', this.start, listeners)
    pane.addEventListener('pointermove', this.move, listeners)
    pane.addEventListener('pointerup', this.end, listeners)
    pane.addEventListener('pointercancel', this.end, listeners)
    pane.addEventListener('lostpointercapture', this.end, listeners)
    document.addEventListener('visibilitychange', this.visibility, listeners)
    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(pane)
    this.scene.load(() => {
      const texture = this.scene.frame(0, true)
      if (texture) this.uploadScene(texture, true)
      this.loaded = true
      this.resize()
      ready()
    }, failed)
  }

  private uploadScene(texture: TexImageSource, first = false) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0)
    if (first) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture)
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture)
    gl.generateMipmap(gl.TEXTURE_2D)
  }

  private createTip(ctx: CanvasRenderingContext2D, core: number) {
    const brush = ctx.createRadialGradient(50, 50, 0, 50, 50, 50)
    brush.addColorStop(0, 'white')
    brush.addColorStop(core, 'rgba(255,255,255,.95)')
    brush.addColorStop(.86, 'rgba(255,255,255,.29)')
    brush.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = brush
    ctx.fillRect(0, 0, 100, 100)
  }

  private resize = () => {
    if (!this.loaded || this.disposed) return
    const { width, height } = this.pane.getBoundingClientRect()
    if (!width || !height) return
    const quality = width <= config.quality.mobileWidth ? config.quality.mobile : config.quality.desktop
    this.frameInterval = width <= config.quality.mobileWidth ? 1 / 30 : 1 / 45
    const ratio = Math.min(devicePixelRatio || 1, quality.pixelRatio, Math.sqrt(quality.maxPixels / (width * height)))
    const fieldScale = Math.min(quality.fieldScale, quality.maxField / Math.max(width, height))
    const fieldWidth = Math.max(1, Math.round(width * fieldScale))
    const fieldHeight = Math.max(1, Math.round(height * fieldScale))
    const brushScale = Math.min(.53, 510 / Math.max(width, height))
    const maskWidth = Math.max(1, Math.round(width * brushScale))
    const maskHeight = Math.max(1, Math.round(height * brushScale))
    const renderWidth = Math.max(1, Math.round(width * ratio))
    const renderHeight = Math.max(1, Math.round(height * ratio))
    const gl = this.gl
    this.canvas.width = renderWidth
    this.canvas.height = renderHeight
    gl.viewport(0, 0, renderWidth, renderHeight)
    const fit = (width / height) / (this.scene.poster.naturalWidth / this.scene.poster.naturalHeight)
    const cropX = Math.min(1, fit)
    const cropY = Math.min(1, 1 / fit)
    const offsetX = (1 - cropX) * config.scene.anchor
    this.scene.setView(offsetX, cropX)
    gl.uniform2f(this.locations.uCover, cropX, cropY)
    gl.uniform2f(this.locations.uOffset, offsetX, (1 - cropY) * .5)
    gl.uniform2f(this.locations.uPixels, renderWidth, renderHeight)
    gl.uniform2f(this.locations.uField, fieldWidth, fieldHeight)
    if (fieldWidth !== this.crystal.canvas.width || fieldHeight !== this.crystal.canvas.height) {
      this.crystal.canvas.width = fieldWidth
      this.crystal.canvas.height = fieldHeight
      this.nuclei = growCrystals(this.crystal.ctx)
      gl.activeTexture(gl.TEXTURE2)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.crystal.canvas)
      this.water.resize(fieldWidth, fieldHeight, quality.drops)
      gl.activeTexture(gl.TEXTURE1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fieldWidth, fieldHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.needsWater = true
    }
    if (maskWidth !== this.masks[0].canvas.width || maskHeight !== this.masks[0].canvas.height) {
      for (const mask of this.masks) {
        this.maskBuffer.canvas.width = mask.canvas.width
        this.maskBuffer.canvas.height = mask.canvas.height
        this.maskBuffer.ctx.drawImage(mask.canvas, 0, 0)
        mask.canvas.width = maskWidth
        mask.canvas.height = maskHeight
        mask.ctx.drawImage(this.maskBuffer.canvas, 0, 0, maskWidth, maskHeight)
        mask.dirty = true
      }
      gl.activeTexture(gl.TEXTURE3)
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, maskWidth, maskHeight, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.masksDirty = true
    }
    this.draw(0)
    this.schedule()
  }

  setState(state: State) {
    const target = stateNames.indexOf(state)
    if (target === this.goal) return
    if (state === 'rain' && this.weights[3] > .06) this.carryDust = true
    if (state === 'dust') {
      this.carryDust = false
      this.water.resetRunoff()
    }
    this.origin.set(this.weights)
    this.phase = 0
    this.goal = target
    this.cancelTouch()
    this.needsWater = true
    if (this.paused) this.draw(0)
    this.schedule()
  }

  reset() {
    const mask = this.masks[this.goal]
    mask.ctx.clearRect(0, 0, mask.canvas.width, mask.canvas.height)
    mask.dirty = this.masksDirty = true
    mask.age = Infinity
    this.draw(0)
  }

  setPaused(paused: boolean) {
    this.paused = paused
    this.lastTick = 0
    this.waterTick = 0
    if (paused) this.draw(0)
    this.schedule()
  }

  private cancelTouch() {
    if (this.touch && this.pane.hasPointerCapture(this.touch.id)) this.pane.releasePointerCapture(this.touch.id)
    this.touch = null
    delete this.pane.dataset.contact
  }

  private point(event: PointerEvent) {
    const rect = this.pane.getBoundingClientRect()
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }
  }

  private updateContact(point: PanePoint) {
    this.pane.style.setProperty('--point-x', `${point.x * 100}%`)
    this.pane.style.setProperty('--point-y', `${point.y * 100}%`)
  }

  private start = (event: PointerEvent) => {
    if (!this.loaded || this.touch || event.button !== 0) return
    this.pane.setPointerCapture(event.pointerId)
    this.touch = { id: event.pointerId, point: this.point(event), elapsed: 0, dropTimer: 0, lastWarmth: 0 }
    this.updateContact(this.touch.point)
    if (event.pointerType === 'mouse') this.pane.dataset.contact = 'true'
    this.paint(this.touch.point, this.goal === 1 ? .16 : 0)
    if (this.goal === 0) this.wipeRain(this.touch.point, this.touch.point)
    if (this.paused) this.draw(0)
    this.schedule()
  }

  private move = (event: PointerEvent) => {
    const touch = this.touch
    if (!touch || event.pointerId !== touch.id) return
    const point = this.point(event)
    if (this.goal !== 1) {
      if (this.goal === 0) this.wipeRain(touch.point, point)
      const width = this.pane.clientWidth
      const height = this.pane.clientHeight
      const steps = Math.max(1, Math.ceil(Math.hypot((point.x - touch.point.x) * width, (point.y - touch.point.y) * height) / 13))
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        this.paint({ x: touch.point.x + (point.x - touch.point.x) * t, y: touch.point.y + (point.y - touch.point.y) * t })
      }
    } else if (Math.hypot(point.x - touch.point.x, point.y - touch.point.y) > .009) {
      touch.elapsed *= .76
      touch.lastWarmth = -1
      this.paint(point, Math.max(.14, touch.elapsed / config.frost.thawSeconds * .58))
    }
    touch.point = point
    if (event.pointerType === 'mouse') this.updateContact(point)
    if (this.paused) this.draw(0)
    this.schedule()
  }

  private end = (event: PointerEvent) => {
    if (this.touch?.id === event.pointerId) this.cancelTouch()
  }

  private wipeRain(from: PanePoint, to: PanePoint) {
    if (this.water.wipe(from, to, config.rain.wipeRadius)) this.needsWater = true
  }

  private paint(point: PanePoint, warmth = 0) {
    const mask = this.masks[this.goal]
    const { width, height } = mask.canvas
    const relative = [config.rain.wipeRadius, .017 + warmth * .162, .089, .073][this.goal]
    const radius = Math.min(width, height) * relative
    const brush = this.goal === 1 || this.goal === 2 ? this.brushTip : this.cleanTip
    mask.ctx.drawImage(brush.canvas, point.x * width - radius, point.y * height - radius, radius * 2, radius * 2)
    mask.dirty = this.masksDirty = true
    mask.age = 0
  }

  private schedule() {
    if (this.frame || this.disposed || !this.loaded || document.hidden) return
    if (this.paused && !(this.touch && this.goal === 1 && this.touch.elapsed < config.frost.thawSeconds)) return
    this.frame = requestAnimationFrame(this.tick)
  }

  private visibility = () => {
    this.lastTick = 0
    if (document.hidden) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      this.cancelTouch()
    }
    this.schedule()
  }

  private tick = (time: number) => {
    this.frame = 0
    const delta = this.lastTick ? Math.min(.048, (time - this.lastTick) / 1000) : 1 / 60
    this.lastTick = time
    const touch = this.touch
    if (touch && this.goal === 1) {
      touch.elapsed += delta
      const warmth = smooth(clamp(touch.elapsed / config.frost.thawSeconds))
      if (warmth - touch.lastWarmth > .055 || (warmth === 1 && touch.lastWarmth < 1)) {
        this.paint(touch.point, warmth)
        touch.lastWarmth = warmth
      }
      touch.dropTimer += delta
      if (!this.paused && warmth > .22 && touch.dropTimer > .24) {
        touch.dropTimer = 0
        const angle = Math.random() * Math.PI * 2
        const radius = (.024 + warmth * .13) * (.54 + Math.random() * .42)
        const aspect = Math.min(1, this.pane.clientHeight / this.pane.clientWidth)
        this.water.spawn(touch.point.x + Math.cos(angle) * radius * aspect, touch.point.y + Math.sin(angle) * radius, .6)
      }
    }
    this.draw(this.paused ? 0 : delta)
    this.schedule()
  }

  private recover(dt: number) {
    this.recoveryTick += dt
    if (this.recoveryTick < .17) return
    for (let i = 0; i < 3; i++) {
      const mask = this.masks[i]
      if (mask.age === Infinity) continue
      mask.age += this.recoveryTick
      const ctx = mask.ctx
      if (mask.age >= recoveries[i] * 4.4) {
        ctx.clearRect(0, 0, mask.canvas.width, mask.canvas.height)
        mask.age = Infinity
      } else {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = `rgba(0,0,0,${1 - Math.exp(-this.recoveryTick / recoveries[i])})`
        ctx.fillRect(0, 0, mask.canvas.width, mask.canvas.height)
        ctx.globalCompositeOperation = 'source-over'
      }
      mask.dirty = this.masksDirty = true
    }
    this.recoveryTick = 0
  }

  private draw(dt: number) {
    if (!this.loaded || this.disposed || document.hidden) return
    const gl = this.gl
    if (this.phase < 1) {
      const melting = this.goal === 0 && this.origin[1] > .06
      const washing = this.goal === 0 && this.origin[3] > .06
      const duration = washing ? config.transition.washSeconds : melting ? config.transition.meltSeconds : config.transition.seconds
      this.phase = this.paused ? 1 : clamp(this.phase + dt / duration)
      const progress = smooth(this.phase)
      for (let i = 0; i < 4; i++) {
        const erosion = i === 3 && washing ? smooth(clamp((this.phase - .24) / .76)) : progress
        const deposit = i === 0 && (melting || washing) ? smooth(clamp(this.phase * 1.32)) : progress
        this.weights[i] = i === this.goal ? this.origin[i] + (1 - this.origin[i]) * deposit : this.origin[i] * (1 - erosion)
      }
    }
    this.sceneTime = (this.sceneTime + dt) % 628.3185307
    gl.uniform1f(this.locations.uSceneTime, this.sceneTime)
    const sceneFrame = this.scene.frame(dt)
    if (sceneFrame) this.uploadScene(sceneFrame)

    if (this.goal === 0 && this.weights[1] > .07 && this.weights[0] > .12) {
      this.meltTimer += dt
      if (this.meltTimer > .06) {
        this.meltTimer = 0
        const site = this.nuclei[Math.floor(Math.random() * this.nuclei.length)]
        if (site) this.water.spawn(site.x, site.y, 1.25)
      }
    }
    const wet = this.weights[0] + this.weights[1] + this.weights[2] > .005
    this.waterTick += dt
    if (this.needsWater || (wet && this.waterTick >= this.frameInterval)) {
      this.water.step(Math.min(this.waterTick, .08), this.weights[0], this.carryDust && this.weights[3] > .008, this.weights[2])
      gl.activeTexture(gl.TEXTURE1)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.water.layer.canvas)
      this.needsWater = false
      this.waterTick = 0
    }
    this.recover(dt)
    if (this.masksDirty) {
      gl.activeTexture(gl.TEXTURE3)
      this.masks.forEach((mask, index) => {
        if (!mask.dirty) return
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, index, mask.canvas.width, mask.canvas.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, mask.canvas)
        mask.dirty = false
      })
      this.masksDirty = false
    }
    gl.uniform4fv(this.locations.uState, this.weights)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose() {
    this.disposed = true
    this.cancelTouch()
    this.events.abort()
    this.observer.disconnect()
    cancelAnimationFrame(this.frame)
    this.scene.dispose()
    for (const texture of this.textures) this.gl.deleteTexture(texture)
    this.gl.deleteBuffer(this.quad)
    this.gl.deleteProgram(this.pipeline)
  }
}
