import * as THREE from 'three'
import { buildCabinRoom } from './models/cabinRoom.js'

// 小木屋室內：獨立的場景，專注時もち坐在矮桌前讀書。
// 放在離小島很遠的地方，小島上的 3D 標籤投影時會落在畫面外而自動藏起來
const ORIGIN = new THREE.Vector3(0, -1000, 0)
const FADE_MS = 450

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
    // 可見範圍：佔畫面的比例（w、h）與它的中心離鏡頭中心的像素偏移（dx 往右、dy 往下），由 main 依版面設定
    this.area = { w: 1, h: 1, dx: 0, dy: 0 }
    this.active = false
    this.switching = false
    this.state = { night: 0, skyTop: sky.top, skyBottom: sky.bot }
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
    await this._fadeTo(1)
    this.world.setStage(null)
    await this._fadeTo(0)
    this.switching = false
  }

  // 被直接切回小島（例如點了面板上的任務、鏡頭飛去看花）
  onLeave() {
    this.active = false
  }

  // 每幀擺鏡頭：拉到房間剛好放進可見範圍的距離、平移到可見範圍中間，加一點很慢的呼吸晃動
  frame(dt, t) {
    const { target, dir, radius } = this.group.userData.view
    const { w, h, dx, dy } = this.area
    const cam = this.world.camera
    const at = this.group.localToWorld(target.clone())
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    const half = Math.min(Math.atan(tan * h), Math.atan(tan * cam.aspect * w))
    // 多留一點邊，左下角的每日任務卡不會壓到房間
    const dist = radius * 1.1 / Math.sin(half)
    cam.position.copy(at).addScaledVector(dir, dist)
    cam.position.x += Math.sin(t * 0.13) * 0.06
    cam.position.y += Math.sin(t * 0.11) * 0.04
    cam.lookAt(at)
    // 鏡頭往反方向平移，房間就落在可見範圍的中心
    const px = 2 * dist * tan / innerHeight
    cam.position.addScaledVector(this._right.set(1, 0, 0).applyQuaternion(cam.quaternion), -dx * px)
    cam.position.addScaledVector(this._up.set(0, 1, 0).applyQuaternion(cam.quaternion), dy * px)
  }

  update(dt, t) {
    if (!this.active) return
    const s = this.state
    s.night = this.sky.night
    this.scene.background.copy(this.bgDay).lerp(this.bgNight, s.night)
    this.group.userData.anim(t, dt, s)
  }
}
