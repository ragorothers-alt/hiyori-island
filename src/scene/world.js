import './shading.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { FinalPass } from './postfx.js'
import { tween, updateTweens, tweensActive, ease } from './util.js'

// 預設視角看的中心：島中心稍微上方
const HOME_TARGET = new THREE.Vector3(0, 0.5, 0)
const UP = new THREE.Vector3(0, 1, 0)
// 構圖：地平線落在可見區域上方的比例；時之環前緣（含數字標籤）的半徑與它離下緣（Dock／抽屜）至少要留的像素
const SKY = 0.22
const RING_FRONT = 13.9
const RING_SIDE = 13.6
const MARGIN = 12
// 閒置時左右慢慢擺動（不整圈轉到背面）：振幅與角速度
const SWAY = 1.0
const SWAY_W = 0.04
// 畫質：high＝反鋸齒（composer 4× MSAA）＋白天也開泛光；standard（手機）＝不做 MSAA、泛光只在夜晚
const QUALITY = {
  high: { dpr: 1.5, samples: 4, dayBloom: true },
  standard: { dpr: 1.5, samples: 0, dayBloom: false },
}
const _sunP = new THREE.Vector3()
const _fwd = new THREE.Vector3()

// 渲染器、相機、後製、互動拾取與主迴圈
export class World {
  constructor(canvas) {
    // 畫面先畫進 composer 的 render target（自己做 MSAA），預設畫布的反鋸齒用不到
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }))
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(innerWidth, innerHeight, false)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.05

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 900)

    const controls = (this.controls = new OrbitControls(this.camera, canvas))
    controls.target.copy(HOME_TARGET)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.minDistance = 9
    controls.maxDistance = 70
    controls.minPolarAngle = 0.2
    controls.maxPolarAngle = 1.42
    controls.enablePan = false
    controls.addEventListener('start', () => this._interacted())
    // 預設視角（由 compose 依版面解出）：仰角、距離，以及整個畫面往下移的像素（讓上方露出天空）
    this.view = { elev: THREE.MathUtils.degToRad(20), dist: 36 }
    this.lens = 0
    this._sway = null

    this.composer = new EffectComposer(renderer)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.55, 0.86)
    // 泛光取亮時把亮度封頂：光滑水面的太陽反光、燈籠裡點光源照到的表面 HDR 亮度會到上千，不封頂會暈成一大團
    const hp = this.bloom.materialHighPassFilter
    hp.fragmentShader = hp.fragmentShader.replace(
      'gl_FragColor = mix( outputColor, texel, alpha );',
      'texel.rgb *= min( 1.0, BLOOM_MAX / max( v, 1e-4 ) );\n\t\t\tgl_FragColor = mix( outputColor, texel, alpha );',
    )
    hp.defines = { ...hp.defines, BLOOM_MAX: '3.0' }
    hp.needsUpdate = true
    this.composer.addPass(this.bloom)
    this.final = new FinalPass()
    this.composer.addPass(this.final)
    // 每幀的色調：天空依時段算好放在 look；另一個場景（小木屋室內）可以帶自己的 look
    this.look = null
    this.qualityName = null
    this.setQuality('high')

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
    // 全螢幕面板蓋住場景時：不更新也不畫，畫面停在最後一幀；
    // 只每半秒跑一次 coveredTick(dt)，給不能停的輕量工作（例如天色到了晚上要換深色玻璃）
    this.covered = false
    this.coveredTick = null
    this._lastTick = 0
    // 改了 canvas 尺寸會清空畫面，蓋住時也要補畫一幀
    this._redraw = false
    this.renders = 0
    this._lastRender = 0
    this.busyUntil = 0
    this.shift = { x: 0, y: 0 }
    this.shiftTarget = { x: 0, y: 0 }
    // 另一個場景（小木屋室內）：{ scene, pickRoots, frame(dt, t), onLeave() }；null 時是小島
    this.stage = null
    // 小鎮長大時預設視角往後拉：距離倍率與看的中心（見 setTownView）
    this.zoomOut = 1
    this.homeTarget = HOME_TARGET.clone()

    this._bindPointer(canvas)
    addEventListener('resize', () => this.resize())
    this.resize()
    this.compose()
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
    this._applyShift()
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.bloom.resolution.set(w / 2, h / 2)
    this._redraw = true
  }

  // 依版面解出預設視角。layout（像素）：面板展開時的畫面位移 shiftX／shiftY（同 setViewShift），
  // 島可以用的區域 left／right／bottom（bottom 是 Dock 或手機抽屜的上緣）。
  // 條件：地平線落在可見區域上方 SKY 的位置、時之環前緣的數字不被下緣擋住、整圈時之環左右放得下；
  // 在這些條件下鏡頭盡量靠近，島越大越好
  compose({ shiftX = 0, shiftY = 0, left = 0, right = innerWidth, bottom = innerHeight } = {}) {
    const W = innerWidth
    const H = innerHeight
    const portrait = W / H < 0.8
    const fov = portrait ? 58 : 50
    const elev = THREE.MathUtils.degToRad(portrait ? 28 : 20)
    const tanF = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const sin = Math.sin(elev)
    const cos = Math.cos(elev)
    const ty = HOME_TARGET.y
    // 地平線：鏡頭往下看 elev，地平線在畫面中心上方 tan(elev)/tanF（NDC）；整個畫面往下移 lens 像素讓它落到想要的高度
    const horizonNdc = 1 - (2 * bottom * SKY) / H
    const lens = shiftY + (H / 2) * (sin / cos / tanF - horizonNdc)
    const off = (2 * (shiftY - lens)) / H
    // 時之環前緣 (0, 0, RING_FRONT)：相對鏡頭的上下偏移固定是 -k，只有深度（= ty·sin + dist - rf·cos）跟距離有關；
    // 小鎮把看的中心往後移時（setTownView），前緣離中心更遠
    const rf = RING_FRONT - this.homeTarget.z
    const k = ty * cos + rf * sin
    const room = off - (1 - (2 * (bottom - MARGIN)) / H)
    const front = room > 0.02 ? k / (tanF * room) - ty * sin + rf * cos : 90
    // 左右：時之環兩側 (±RING_SIDE, 0, 0) 放進 left..right（深度 = ty·sin + dist）
    const halfW = Math.max(60, (right - left) / 2 - MARGIN)
    const side = (RING_SIDE * (W / 2)) / (tanF * this.camera.aspect * halfW) - ty * sin
    const dist = THREE.MathUtils.clamp(Math.max(front, side), 18, 90) / this.zoomOut
    this.view = { elev, dist }
    this.lens = lens
    this.camera.fov = fov
    this.controls.maxDistance = Math.max(52, dist * 1.6) * this.zoomOut
    this._applyShift()
  }

  // 讓畫面中心避開側邊面板：x>0 往左移、y>0 往上移（像素）
  setViewShift(x, y = 0) {
    this.shiftTarget = { x, y }
  }
  // 實際套到鏡頭上的位移：面板位移加上構圖的下移
  viewOffset(shift = this.shift) {
    return { x: shift.x, y: shift.y - this.lens }
  }
  _applyShift() {
    const { x, y } = this.viewOffset()
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) this.camera.clearViewOffset()
    else this.camera.setViewOffset(innerWidth, innerHeight, x, y, innerWidth, innerHeight)
    this.camera.updateProjectionMatrix()
  }

  start() {
    this.renderer.setAnimationLoop((t) => this._frame(t))
  }

  // 'high' | 'standard'（見 QUALITY）
  setQuality(name) {
    if (!QUALITY[name] || name === this.qualityName) return
    this.qualityName = name
    const q = (this.quality = QUALITY[name])
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.dpr))
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      rt.samples = q.samples
      rt.dispose()
    }
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this._redraw = true
  }

  // 把這一幀的色調套到泛光與最後一道後製；太陽方向換算成畫面座標給光暈用
  _applyLook() {
    const look = this.stage?.look ?? this.look
    if (!look) return
    const b = this.bloom
    b.strength = look.bloom.strength
    b.threshold = look.bloom.threshold
    b.radius = look.bloom.radius
    b.highPassUniforms.smoothWidth.value = look.bloom.knee
    b.enabled = b.strength > 0.02 && (this.quality.dayBloom || look.night > 0.15)
    this.final.apply(look)
    let glare = look.glare
    if (glare > 0 && look.sunDir) {
      const cam = this.camera
      cam.getWorldDirection(_fwd)
      // 太陽在鏡頭背後時不畫光暈；在畫面外但在前方時，從靠近太陽的那一側漏光
      glare *= THREE.MathUtils.smoothstep(_fwd.dot(look.sunDir), -0.15, 0.45)
      _sunP.copy(cam.position).addScaledVector(look.sunDir, 100).project(cam)
      this.final.uniforms.uSun.value.set(
        THREE.MathUtils.clamp(_sunP.x * 0.5 + 0.5, -1.5, 2.5),
        THREE.MathUtils.clamp(_sunP.y * 0.5 + 0.5, -1.5, 2.5),
      )
    }
    this.final.uniforms.uGlare.value = glare
  }

  // 閒置程度：0 = 全速、1 = 30fps、2 = 15fps 且停止自動旋轉
  idleLevel(now = performance.now()) {
    if (this.covered) return 2
    if (!this.powerSave || this.dragging || this._focusing || tweensActive() || now < this.busyUntil) return 0
    const quiet = now - this.lastInteract
    return quiet > 90000 ? 2 : quiet > 15000 ? 1 : 0
  }
  // 場景停住時（covered）要求補畫一幀
  redraw() {
    this._redraw = true
  }
  // 有特效在播（爆花、煙火、天燈）時呼叫，暫時維持全速
  keepAwake(ms = 2500) {
    this.busyUntil = Math.max(this.busyUntil, performance.now() + ms)
  }

  _frame(t) {
    if (this.covered && !this._redraw) {
      // dt 用實際經過的秒數：切換外觀時的天色快轉才會照真實時間跑完
      if (t - this._lastTick >= 500) {
        this.coveredTick?.(Math.min((t - this._lastTick) / 1000, 1))
        this._lastTick = t
      }
      return
    }
    const level = this.idleLevel()
    const interval = [0, 1000 / 30, 1000 / 15][level]
    if (interval && t - this._lastRender < interval - 1) return
    this._redraw = false
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
    if (this.idleRotate && idle && !this._focusing && level < 2 && !this.stage) this._swayStep(dt)
    else this._sway = null
    if (this.stage) this.stage.frame(dt, el)
    else this.controls.update(dt)
    this._applyLook()
    this.composer.render()
  }

  // 閒置時鏡頭在正面左右 ±SWAY 之間慢慢擺動：遠景、太陽都在島的後方，整圈轉到背面會只看到空蕩的一側。
  // 從目前的角度接上擺動的相位；如果被轉到範圍外，先慢慢轉回來
  _swayStep(dt) {
    const c = this.controls
    const theta = c.getAzimuthalAngle()
    if (this._sway == null) this._sway = Math.asin(THREE.MathUtils.clamp(theta / SWAY, -1, 1))
    this._sway += dt * SWAY_W
    const step = THREE.MathUtils.clamp(Math.sin(this._sway) * SWAY - theta, -dt * 0.06, dt * 0.06)
    _sunP.copy(this.camera.position).sub(c.target).applyAxisAngle(UP, step)
    this.camera.position.copy(c.target).add(_sunP)
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
    const scene = this.stage?.scene ?? this.scene
    const hits = this.raycaster.intersectObjects(this.stage?.pickRoots ?? this.pickRoots, true)
    for (const h of hits) {
      let o = h.object
      // 自己或上層被隱藏、或不在目前顯示的場景裡（例如待在小木屋室內的もち）就不算點到
      let shown = true
      let top = o
      for (let p = o; p; p = p.parent) {
        shown &&= p.visible
        top = p
      }
      if (!shown || top !== scene) continue
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
  // 換到另一個場景；設成 null 回到小島，鏡頭回到進去之前的位置
  setStage(stage) {
    const prev = this.stage
    if (stage === prev) return
    if (stage && !prev) this._islandView = { pos: this.camera.position.clone(), target: this.controls.target.clone() }
    this.stage = stage
    this.renderPass.scene = stage?.scene ?? this.scene
    this.controls.enabled = !stage
    if (!stage && this._islandView) {
      this.camera.position.copy(this._islandView.pos)
      this.controls.target.copy(this._islandView.target)
      this.camera.lookAt(this.controls.target)
      this._islandView = null
    }
    this._interacted()
    prev?.onLeave?.()
  }
  // 預設視角的相機（不受目前拖曳影響），shift 是要套用的畫面偏移
  homeCamera(shift = this.shiftTarget) {
    const cam = (this._homeCam ??= new THREE.PerspectiveCamera())
    cam.copy(this.camera, false)
    cam.position.copy(this._homePos())
    cam.lookAt(this.homeTarget)
    const { x, y } = this.viewOffset(shift)
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) cam.clearViewOffset()
    else cam.setViewOffset(innerWidth, innerHeight, x, y, innerWidth, innerHeight)
    cam.updateMatrixWorld()
    return cam
  }
  // 讓半徑 r 的球完整入鏡所需的距離（取垂直、水平視角中較窄的一邊）
  fitDistance(r) {
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2)
    const narrow = Math.min(half, Math.atan(Math.tan(half) * this.camera.aspect))
    return r / Math.sin(narrow)
  }
  // dir：從哪個水平方向看過去（省略時沿用目前的方向）
  flyTo(target, distance = 13, { elevation = 0.62, duration = 1.1, dir: from = null } = {}) {
    this.setStage(null)
    const c = this.controls
    const fromT = c.target.clone()
    const fromP = this.camera.position.clone()
    const dir = from ? from.clone() : fromP.clone().sub(fromT)
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
    const { elev, dist } = this.view
    const d = dist * this.zoomOut
    return new THREE.Vector3(0, Math.sin(elev) * d, Math.cos(elev) * d).add(this.homeTarget)
  }
  // 小鎮的街區浮在島後方：zoom 是預設距離的倍率，back 是看的中心往後（-z）移多少
  setTownView(zoom, back = 0) {
    this.zoomOut = zoom
    this.homeTarget.set(HOME_TARGET.x, HOME_TARGET.y, HOME_TARGET.z - back)
    this.controls.maxDistance = Math.max(52, this.view.dist * 1.6) * zoom
  }
  home(duration = 1.3) {
    this.setStage(null)
    const c = this.controls
    const fromT = c.target.clone()
    const fromP = this.camera.position.clone()
    const toP = this._homePos()
    this._focusing = true
    tween(
      duration,
      (k) => {
        c.target.lerpVectors(fromT, this.homeTarget, k)
        this.camera.position.lerpVectors(fromP, toP, k)
      },
      { easing: ease.inOutCubic, onDone: () => (this._focusing = false) },
    )
  }
}
