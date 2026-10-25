import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { tween, updateTweens, tweensActive, ease } from './util.js'

const HOME_POS = new THREE.Vector3(0, 21, 30.5)
const HOME_TARGET = new THREE.Vector3(0, -0.6, 0)

// 渲染器、相機、後製、互動拾取與主迴圈
export class World {
  constructor(canvas) {
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }))
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(innerWidth, innerHeight, false)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.05

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 600)
    this.camera.position.copy(HOME_POS)

    const controls = (this.controls = new OrbitControls(this.camera, canvas))
    controls.target.copy(HOME_TARGET)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.minDistance = 9
    controls.maxDistance = 52
    controls.minPolarAngle = 0.2
    controls.maxPolarAngle = 1.42
    controls.enablePan = false
    controls.autoRotateSpeed = 0.35
    controls.addEventListener('start', () => this._interacted())

    this.composer = new EffectComposer(renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.55, 0.86)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.timer = new THREE.Timer()
    this.timer.connect(document)
    this.updaters = []
    this.pickRoots = []
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.hovered = null
    this.onPick = () => {}
    this.onHover = () => {}
    // dragHandler: { start(hit, e) → boolean, move(ray, e), end(e) }；start 回傳 true 就接管這次拖曳（不旋轉鏡頭）
    this.dragHandler = null
    this.dragging = false
    // 擺放模式等需要原始射線的功能：onPointerMove(ray, e)、onClick(ray, e) 回傳 true 表示已處理
    this.onPointerMove = null
    this.onClick = null
    this.lastInteract = performance.now()
    this.idleRotate = true
    // 省電：閒置時降低幀率（powerSave 由設定控制）
    this.powerSave = true
    this.renders = 0
    this._lastRender = 0
    this.busyUntil = 0
    this.shift = { x: 0, y: 0 }
    this.shiftTarget = { x: 0, y: 0 }

    this._bindPointer(canvas)
    addEventListener('resize', () => this.resize())
    this.resize()
    this.camera.position.copy(this._homePos())
  }

  add(fn) {
    this.updaters.push(fn)
  }
  addPickable(obj) {
    this.pickRoots.push(obj)
  }

  resize() {
    const w = innerWidth
    const h = innerHeight
    this.camera.aspect = w / h
    // 手機直式畫面拉遠一點，讓整座島入鏡
    this.camera.fov = w / h < 0.8 ? 50 : 38
    // 直式畫面：拉遠到時之環（半徑約 12）能完整放進螢幕寬度
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (w / h)
    this.distFactor = Math.max(1, 12 / halfH / HOME_POS.distanceTo(HOME_TARGET))
    this.controls.maxDistance = 52 * this.distFactor
    this._applyShift()
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.bloom.resolution.set(w / 2, h / 2)
  }

  // 讓畫面中心避開側邊面板：x>0 往左移、y>0 往上移（像素）
  setViewShift(x, y = 0) {
    this.shiftTarget = { x, y }
  }
  _applyShift() {
    const { x, y } = this.shift
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) this.camera.clearViewOffset()
    else this.camera.setViewOffset(innerWidth, innerHeight, x, y, innerWidth, innerHeight)
    this.camera.updateProjectionMatrix()
  }

  start() {
    this.renderer.setAnimationLoop((t) => this._frame(t))
  }

  // 閒置程度：0 = 全速、1 = 30fps、2 = 15fps 且停止自動旋轉
  idleLevel(now = performance.now()) {
    if (!this.powerSave || this.dragging || this._focusing || tweensActive() || now < this.busyUntil) return 0
    const quiet = now - this.lastInteract
    return quiet > 90000 ? 2 : quiet > 15000 ? 1 : 0
  }
  // 有特效在播（爆花、煙火、天燈）時呼叫，暫時維持全速
  keepAwake(ms = 2500) {
    this.busyUntil = Math.max(this.busyUntil, performance.now() + ms)
  }

  _frame(t) {
    const level = this.idleLevel()
    const interval = [0, 1000 / 30, 1000 / 15][level]
    if (interval && t - this._lastRender < interval - 1) return
    this._lastRender = t
    this.renders++
    this.timer.update(t)
    const dt = Math.min(this.timer.getDelta(), 0.1)
    const el = this.timer.getElapsed()
    updateTweens(dt)
    const s = this.shift
    const st = this.shiftTarget
    if (Math.abs(s.x - st.x) > 0.3 || Math.abs(s.y - st.y) > 0.3) {
      const k = Math.min(1, dt * 6)
      s.x += (st.x - s.x) * k
      s.y += (st.y - s.y) * k
      this._applyShift()
    }
    for (const fn of this.updaters) fn(dt, el)
    const idle = performance.now() - this.lastInteract > 25000
    this.controls.autoRotate = this.idleRotate && idle && !this._focusing && level < 2
    // 白天的 bloom 幾乎看不出來，直接關掉這個後製 pass 省 GPU
    this.bloom.enabled = this.bloom.strength > 0.2
    this.controls.update(dt)
    this.composer.render()
  }

  _interacted() {
    this.lastInteract = performance.now()
  }

  // ── 拾取 ──
  _setRay(e) {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
  }

  _raycast(e) {
    this._setRay(e)
    const hits = this.raycaster.intersectObjects(this.pickRoots, true)
    for (const h of hits) {
      let o = h.object
      if (!o.visible) continue
      while (o && !o.userData.pick) o = o.parent
      if (o) return { pick: o.userData.pick, object: o, point: h.point }
    }
    return null
  }

  _bindPointer(canvas) {
    let down = null
    let raf = 0
    let lastMove = null
    // capture 階段先檢查是否要拖曳 3D 物件；接管時阻止 OrbitControls 收到事件
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0 || !this.dragHandler) return
        const hit = this._raycast(e)
        if (hit && this.dragHandler.start(hit, e)) {
          this.dragging = true
          e.stopImmediatePropagation()
          canvas.setPointerCapture(e.pointerId)
          this._interacted()
        }
      },
      { capture: true },
    )
    const endDrag = (e) => {
      if (!this.dragging) return false
      this.dragging = false
      this.dragHandler.end(e)
      return true
    }
    canvas.addEventListener('pointercancel', endDrag)
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() }
      this._interacted()
    })
    canvas.addEventListener('pointerup', (e) => {
      if (endDrag(e)) return
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      const quick = performance.now() - down.t < 600
      down = null
      if (moved > 6 || !quick) return
      this._setRay(e)
      if (this.onClick?.(this.raycaster.ray, e)) return
      const hit = this._raycast(e)
      this.onPick(hit?.pick || null, hit)
    })
    canvas.addEventListener('pointermove', (e) => {
      this.lastInteract = performance.now()
      if (this.dragging) {
        this._setRay(e)
        this.dragHandler.move(this.raycaster.ray, e)
        return
      }
      lastMove = e
      if (e.pointerType === 'touch') return
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (this.onPointerMove) {
          this._setRay(lastMove)
          this.onPointerMove(this.raycaster.ray, lastMove)
        }
        const hit = this._raycast(lastMove)
        const key = hit ? hit.pick.type + ':' + hit.pick.id : null
        canvas.style.cursor = hit ? 'pointer' : ''
        if (key !== this.hovered) {
          this.hovered = key
          this.onHover(hit?.pick || null, hit, lastMove)
        } else if (hit) {
          this.onHover(hit.pick, hit, lastMove, true)
        }
      })
    })
    canvas.addEventListener('pointerleave', () => {
      if (this.hovered) {
        this.hovered = null
        this.onHover(null)
      }
    })
    canvas.addEventListener('wheel', () => this._interacted(), { passive: true })
    addEventListener('keydown', () => this._interacted())
    // 面板上的操作也算互動（讓動畫回到全速）
    addEventListener('pointerdown', () => this._interacted(), { capture: true })
  }

  // ── 鏡頭 ──
  flyTo(target, distance = 13, { elevation = 0.62, duration = 1.1 } = {}) {
    const c = this.controls
    const fromT = c.target.clone()
    const fromP = this.camera.position.clone()
    const dir = fromP.clone().sub(fromT)
    dir.y = 0
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1)
    dir.normalize()
    const toT = target.clone()
    const toP = toT.clone().add(dir.multiplyScalar(distance * Math.cos(elevation))).add(new THREE.Vector3(0, distance * Math.sin(elevation), 0))
    this._focusing = true
    this._interacted()
    tween(
      duration,
      (k) => {
        c.target.lerpVectors(fromT, toT, k)
        this.camera.position.lerpVectors(fromP, toP, k)
      },
      { easing: ease.inOutCubic, onDone: () => (this._focusing = false) },
    )
  }
  _homePos() {
    return HOME_POS.clone().sub(HOME_TARGET).multiplyScalar(this.distFactor || 1).add(HOME_TARGET)
  }
  home(duration = 1.3) {
    const c = this.controls
    const fromT = c.target.clone()
    const fromP = this.camera.position.clone()
    const toP = this._homePos()
    this._focusing = true
    tween(
      duration,
      (k) => {
        c.target.lerpVectors(fromT, HOME_TARGET, k)
        this.camera.position.lerpVectors(fromP, toP, k)
      },
      { easing: ease.inOutCubic, onDone: () => (this._focusing = false) },
    )
  }
}
