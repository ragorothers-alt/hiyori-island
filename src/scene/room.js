import * as THREE from 'three'
import { buildCabinRoom } from './models/cabinRoom.js'

// 小木屋室內：獨立的場景，專注時もち坐在矮桌前讀書。
// 放在離小島很遠的地方，小島上的 3D 標籤投影時會落在畫面外而自動藏起來
const ORIGIN = new THREE.Vector3(0, -1000, 0)
const FADE_MS = 450
// 室內的色調跟著外面的時段，但沒有太陽光暈，暗角輕一點。
// 泛光用自己的設定：只讓燈泡、爐火、燈罩這些真正的光源發光（屋裡最亮的牆和兩人約 0.6，燈泡約 1）
const ROOM_LOOK = { glare: 0, vignette: 0.12, bloom: { strength: 0.42, threshold: 0.8, radius: 0.45, knee: 0.25 } }
const UP = new THREE.Vector3(0, 1, 0)
const _v = new THREE.Vector3()

export class Room {
  constructor(world, sky) {
    this.world = world
    this.sky = sky
    this.scene = new THREE.Scene()
    const g = (this.group = buildCabinRoom())
    g.position.copy(ORIGIN)
    this.scene.add(g)
    g.updateMatrixWorld(true)
    const bg = g.userData.background ?? { day: '#f3e7d8', night: '#211b2c' }
    this.bgDay = new THREE.Color(bg.day)
    this.bgNight = new THREE.Color(bg.night)
    this.scene.background = new THREE.Color()
    this.pickRoots = []
    // 可見範圍（像素）：扣掉面板和 Dock 之後留給房間的區域，由 main 依版面設定
    this.area = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    this._measure(g)
    // 要進去（true）或要出來（false）時通知 main：收起面板、淡出資訊卡，出來再還原
    this.onToggle = null
    this.active = false
    this.switching = false
    this.state = { night: 0, skyTop: sky.top, skyBottom: sky.bot }
    this.look = { ...sky.look, ...ROOM_LOOK }
    this._right = new THREE.Vector3()
    this._up = new THREE.Vector3()
    this.fade = document.createElement('div')
    this.fade.className = 'stage-fade'
    document.body.append(this.fade)
    world.add((dt, t) => this.update(dt, t))
  }

  // 第 i 個坐墊的位置（世界座標）與面向（0 給もち、1 給ふじ）
  seat(i = 0) {
    const u = this.group.userData
    const s = u.seats?.[i] ?? u.seat
    return { position: this.group.localToWorld(s.position.clone()), facing: s.facing }
  }

  _fadeTo(v) {
    this.fade.style.opacity = v
    return new Promise((r) => setTimeout(r, FADE_MS))
  }

  // instant：重新整理後接著專注，直接在屋裡
  async enter(instant = false) {
    if (this.active || this.switching) return
    this.switching = true
    this.onToggle?.(true)
    if (!instant) await this._fadeTo(1)
    this.active = true
    this.world.setStage(this)
    this.frame(0, 0)
    if (!instant) await this._fadeTo(0)
    this.switching = false
  }

  async exit() {
    if (!this.active || this.switching) return
    this.switching = true
    this.onToggle?.(false)
    await this._fadeTo(1)
    this.world.setStage(null)
    await this._fadeTo(0)
    this.switching = false
  }

  // 被直接切回小島（例如點了面板上的任務、鏡頭飛去看花）
  onLeave() {
    this.active = false
    this.onToggle?.(false)
  }

  // 把房間每個頂點換到鏡頭的方向上（橫、直、朝鏡頭的深度），取景時用來算剛好放得下的距離
  _measure(g) {
    const { dir } = g.userData.view
    this.center = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3())
    const right = new THREE.Vector3().crossVectors(UP, dir).normalize()
    const up = new THREE.Vector3().crossVectors(dir, right)
    let n = 0
    g.traverse((o) => o.isMesh && (n += o.geometry.attributes.position.count))
    const pts = (this.pts = new Float32Array(n * 3))
    let i = 0
    g.traverse((o) => {
      if (!o.isMesh) return
      const pos = o.geometry.attributes.position
      for (let k = 0; k < pos.count; k++, i += 3) {
        _v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld).sub(this.center)
        pts[i] = _v.dot(right)
        pts[i + 1] = _v.dot(up)
        pts[i + 2] = _v.dot(dir)
      }
    })
    this._fitKey = ''
  }

  // 讓整間房剛好放進斜率 ±tx、±ty 的鏡頭距離 d，以及讓它置中的橫直平移 ox、oy（範圍沒變就用上次的結果）
  _fit(tx, ty) {
    const key = `${tx.toFixed(4)},${ty.toFixed(4)}`
    if (key === this._fitKey) return this._fitVal
    const P = this.pts
    let d = 30
    let ox = 0
    let oy = 0
    for (let k = 0; k < 8; k++) {
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (let i = 0; i < P.length; i += 3) {
        const z = d - P[i + 2]
        const sx = (P[i] - ox) / z
        const sy = (P[i + 1] - oy) / z
        if (sx < x0) x0 = sx
        if (sx > x1) x1 = sx
        if (sy < y0) y0 = sy
        if (sy > y1) y1 = sy
      }
      // 把畫面上的範圍中心移回鏡頭正前方，再依比較緊的一邊拉近或拉遠
      ox += ((x0 + x1) / 2) * d
      oy += ((y0 + y1) / 2) * d
      d *= Math.max((x1 - x0) / 2 / tx, (y1 - y0) / 2 / ty)
    }
    this._fitKey = key
    return (this._fitVal = { d, ox, oy })
  }

  // 每幀擺鏡頭：拉到整間房剛好放進可見範圍的距離、平移到可見範圍中間，加一點很慢的呼吸晃動
  frame(dt, t) {
    const { dir } = this.group.userData.view
    const r = this.area
    const W = innerWidth
    const H = innerHeight
    const cam = this.world.camera
    const at = this.center
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    // 可見範圍的半高、半寬換成鏡頭的斜率，四周留 3% 的邊；
    // 直式畫面房間顯得很扁，左右各裁掉一點外牆，屋裡就能大一些；畫面越瘦長裁得越多
    const aw = r.right - r.left
    const ah = r.bottom - r.top
    const ty = tan * (ah / H) * 0.97
    const tx = tan * cam.aspect * (aw / W) * (aw < ah ? THREE.MathUtils.clamp((ah / aw) * 0.75, 1.22, 1.5) : 0.97)
    const { d, ox, oy } = this._fit(tx, ty)
    cam.position.copy(at).addScaledVector(dir, d)
    cam.position.x += Math.sin(t * 0.13) * 0.06
    cam.position.y += Math.sin(t * 0.11) * 0.04
    cam.lookAt(at)
    // 鏡頭往旁邊平移：先讓房間在鏡頭正中，再移到可見範圍的中心（viewOffset 是整個畫面為了面板和構圖做的偏移）
    const s = this.world.viewOffset()
    const dx = (r.left + r.right) / 2 - (W / 2 - s.x)
    const dy = (r.top + r.bottom) / 2 - (H / 2 - s.y)
    const px = 2 * d * tan / H
    cam.position.addScaledVector(this._right.set(1, 0, 0).applyQuaternion(cam.quaternion), ox - dx * px)
    cam.position.addScaledVector(this._up.set(0, 1, 0).applyQuaternion(cam.quaternion), oy + dy * px)
  }

  update(dt, t) {
    if (!this.active) return
    const s = this.state
    s.night = this.sky.night
    Object.assign(this.look, this.sky.look, ROOM_LOOK)
    this.scene.background.copy(this.bgDay).lerp(this.bgNight, s.night)
    this.group.userData.anim(t, dt, s)
  }
}
