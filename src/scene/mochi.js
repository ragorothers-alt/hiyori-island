import * as THREE from 'three'
import { LAYOUT } from './island.js'
import { tween, ease, rng } from './util.js'
import { SEASONS } from './season.js'

// もち：白色麻糬小精靈。會呼吸、眨眼、閒晃，完成任務時跳過去慶祝。
const HOME = new THREE.Vector3(LAYOUT.home.x, 0, LAYOUT.home.z)
const play = (dur, fn, opts = {}) => new Promise((res) => tween(dur, fn, { ...opts, onDone: res }))

export class Mochi {
  constructor(world, labels, sky) {
    this.world = world
    this.sky = sky
    this.labels = labels
    this.rand = rng(Date.now() % 100000)
    const root = (this.root = new THREE.Group())
    root.position.copy(HOME)
    root.scale.setScalar(1.3)
    root.userData.pick = { type: 'mochi', id: 'mochi' }
    world.scene.add(root)
    world.addPickable(root)

    this.body = new THREE.Group()
    root.add(this.body)
    const skin = new THREE.MeshPhysicalMaterial({
      color: '#fffdfa', roughness: 0.42, sheen: 1, sheenColor: new THREE.Color('#ffe3ec'), sheenRoughness: 0.5,
      clearcoat: 0.25, clearcoatRoughness: 0.4, emissive: '#fff1f4', emissiveIntensity: 0.08,
    })
    const blob = new THREE.Mesh(new THREE.SphereGeometry(0.6, 48, 32), skin)
    blob.scale.set(1, 0.82, 1)
    blob.position.y = 0.49
    blob.castShadow = true
    this.skin = skin
    this.body.add(blob)

    const ink = new THREE.MeshStandardMaterial({ color: '#363a46', roughness: 0.3 })
    this.eyes = []
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), ink)
      eye.scale.set(0.8, 1.25, 0.5)
      eye.position.set(s * 0.19, 0.58, 0.55)
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
      shine.position.set(0.012, 0.022, 0.03)
      eye.add(shine)
      this.body.add(eye)
      this.eyes.push(eye)

      const blush = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), new THREE.MeshBasicMaterial({ color: '#f8a9bb', transparent: true, opacity: 0.6, depthWrite: false }))
      blush.position.set(s * 0.33, 0.49, 0.505)
      blush.rotation.y = s * 0.585
      this.body.add(blush)

      const nub = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skin)
      nub.scale.set(1, 0.8, 0.9)
      nub.position.set(s * 0.56, 0.24, 0.12)
      nub.castShadow = true
      this.body.add(nub)
    }
    this.nubs = this.body.children.filter((c) => c.geometry?.parameters?.radius === 0.11)

    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.011, 6, 14, Math.PI), ink)
    mouth.position.set(0, 0.5, 0.6)
    mouth.rotation.z = Math.PI
    this.mouth = mouth
    this.body.add(mouth)

    // 頭上的小櫻花髮飾
    const clip = new THREE.Group()
    const petalMat = (this.clipMat = new THREE.MeshStandardMaterial({ color: '#f7b3c6', roughness: 0.5, emissive: '#ffc9d6', emissiveIntensity: 0.2 }))
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), petalMat)
      const a = (i / 5) * Math.PI * 2
      p.scale.set(1.3, 0.35, 0.9)
      p.position.set(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07)
      p.rotation.y = -a
      clip.add(p)
    }
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffe29a' }))
    clip.add(center)
    clip.position.set(0.24, 0.92, 0.12)
    clip.rotation.set(0.3, 0, -0.5)
    this.body.add(clip)

    // 冬天的小圍巾
    const scarfMat = new THREE.MeshStandardMaterial({ color: '#ef8e93', roughness: 0.85 })
    this.scarf = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.075, 8, 40), scarfMat)
    ring.rotation.x = Math.PI / 2
    ring.scale.set(1.13, 1.13, 0.85)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.28, 0.05), scarfMat)
    tail.position.set(0.24, -0.13, 0.5)
    tail.rotation.z = 0.25
    this.scarf.add(ring, tail)
    this.scarf.position.y = 0.37
    this.scarf.visible = false
    this.body.add(this.scarf)

    this.busy = false
    this.mode = 'idle'
    this.chain = Promise.resolve()
    this.pending = 0
    this.blinkT = 2
    this.wanderT = 6
    this.faceAngle = 0
    this.bubble = null
    world.add((dt, t) => this.update(dt, t))
  }

  setSeason(key) {
    const s = SEASONS[key]
    this.clipMat.color.set(s.clip)
    this.clipMat.emissive.set(s.clip)
    this.scarf.visible = !!s.scarf
  }

  get position() {
    return this.root.position
  }

  headAnchor() {
    return this.root.position.clone().add(new THREE.Vector3(0, 1.75 + this.body.position.y * 1.3, 0))
  }

  // ── 對話泡泡 ──
  say(text, ms = 3400) {
    if (!text) return
    if (this.bubble) {
      const old = this.bubble
      old.el.classList.add('out')
      setTimeout(() => this.labels.remove(old), 300)
    }
    const el = document.createElement('div')
    el.className = 'bubble'
    el.textContent = text
    const item = (this.bubble = this.labels.add(el, () => this.headAnchor()))
    clearTimeout(this._sayTimer)
    this._sayTimer = setTimeout(() => {
      el.classList.add('out')
      setTimeout(() => {
        this.labels.remove(item)
        if (this.bubble === item) this.bubble = null
      }, 300)
    }, ms)
  }

  // ── 動作 ──
  _enqueue(fn) {
    this.pending++
    this.chain = this.chain.then(fn).catch(() => {}).finally(() => this.pending--)
    return this.chain
  }

  async _hop(to, { height = 0.42, dur = 0.32 } = {}) {
    const from = this.root.position.clone()
    from.y = 0
    const b = this.body
    await play(0.08, (k) => b.scale.set(1 + 0.12 * k, 1 - 0.18 * k, 1 + 0.12 * k))
    await play(dur, (k) => {
      this.root.position.lerpVectors(from, to, k)
      this.root.position.y = Math.sin(k * Math.PI) * height
      const s = Math.sin(k * Math.PI)
      b.scale.set(1 - 0.07 * s, 1 + 0.14 * s, 1 - 0.07 * s)
    }, { easing: ease.linear })
    this.root.position.y = 0
    await play(0.14, (k) => {
      const s = Math.sin(k * Math.PI)
      b.scale.set(1 + 0.14 * s, 1 - 0.2 * s, 1 + 0.14 * s)
    }, { easing: ease.linear })
    b.scale.set(1, 1, 1)
  }

  async _travel(target, hopLen = 0.85) {
    const start = this.root.position.clone()
    start.y = 0
    const end = target.clone()
    end.y = 0
    const delta = end.clone().sub(start)
    const dist = delta.length()
    if (dist < 0.05) return
    this.faceAngle = Math.atan2(delta.x, delta.z)
    const n = Math.max(1, Math.ceil(dist / hopLen))
    for (let i = 1; i <= n; i++) {
      await this._hop(start.clone().addScaledVector(delta, i / n))
    }
  }

  async _celebrate() {
    const b = this.body
    const r0 = this.root.rotation.y
    await play(0.1, (k) => b.scale.set(1 + 0.15 * k, 1 - 0.25 * k, 1 + 0.15 * k))
    await play(0.62, (k) => {
      this.root.position.y = Math.sin(k * Math.PI) * 1.0
      this.root.rotation.y = r0 + k * Math.PI * 2
      const s = Math.sin(k * Math.PI)
      b.scale.set(1 - 0.08 * s, 1 + 0.18 * s, 1 - 0.08 * s)
      for (const n of this.nubs) n.position.y = 0.24 + s * 0.25
    }, { easing: ease.inOutSine })
    this.root.position.y = 0
    for (const n of this.nubs) n.position.y = 0.24
    await play(0.35, (k) => {
      const s = Math.sin(k * Math.PI) * (1 - k)
      b.scale.set(1 + 0.25 * s, 1 - 0.35 * s, 1 + 0.25 * s)
    }, { easing: ease.linear })
    b.scale.set(1, 1, 1)
  }

  // 跳到某處慶祝，再回家
  visit(pos, onArrive) {
    if (this.mode === 'focus') {
      onArrive?.()
      return
    }
    if (this.pending > 1) {
      onArrive?.()
      return this._enqueue(() => this._celebrate())
    }
    return this._enqueue(async () => {
      this.busy = true
      const here = this.root.position.clone()
      const dir = here.clone().sub(pos).setY(0)
      if (dir.lengthSq() < 0.01) dir.set(0, 0, 1)
      const near = pos.clone().setY(0).add(dir.normalize().multiplyScalar(1.05))
      await this._travel(near, 1.1)
      this.faceAngle = Math.atan2(pos.x - near.x, pos.z - near.z)
      onArrive?.()
      await this._celebrate()
      await new Promise((r) => setTimeout(r, 500))
      if (this.pending <= 1) await this._travel(HOME, 1.1)
      this.busy = false
      this.wanderT = 8
    })
  }

  celebrate() {
    return this._enqueue(async () => {
      this.busy = true
      await this._celebrate()
      this.busy = false
    })
  }

  pet() {
    const b = this.body
    tween(0.7, (k) => {
      const s = Math.sin(k * Math.PI * 3) * (1 - k)
      b.scale.set(1 + 0.22 * s, 1 - 0.3 * s, 1 + 0.22 * s)
    }, { easing: ease.linear })
    this._squint = 0.9
  }

  setFocus(on) {
    const mode = on ? 'focus' : 'idle'
    if (this.mode === mode) return
    this.mode = mode
    if (on) {
      this._enqueue(async () => {
        this.busy = true
        await this._travel(HOME, 1.1)
        this.busy = false
      })
      const el = document.createElement('div')
      el.className = 'focus-tag'
      el.textContent = 'しゅうちゅう'
      this.focusTag = this.labels.add(el, () => this.root.position.clone().add(new THREE.Vector3(0, 2.2, 0)))
    } else if (this.focusTag) {
      this.labels.remove(this.focusTag)
      this.focusTag = null
    }
  }

  update(dt, t) {
    const cam = this.world.camera.position
    if (this.sky) this.skin.emissiveIntensity = 0.08 + this.sky.night * 0.3
    const focus = this.mode === 'focus'

    // 呼吸
    if (!this.busy) {
      const s = Math.sin(t * (focus ? 1.2 : 2.4)) * (focus ? 0.02 : 0.03)
      this.body.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5)
      this.body.position.y += ((focus ? 0.18 + Math.sin(t * 1.2) * 0.06 : 0) - this.body.position.y) * 0.08
    }

    // 眨眼 / 專注閉眼 / 被摸時瞇眼
    this.blinkT -= dt
    let eyeY = 1.25
    if (focus) eyeY = 0.14
    else if (this._squint > 0) {
      this._squint -= dt
      eyeY = 0.18
    } else if (this.blinkT < 0) {
      eyeY = 0.12
      if (this.blinkT < -0.12) this.blinkT = 2.4 + this.rand() * 3.5
    }
    for (const e of this.eyes) e.scale.y += (eyeY - e.scale.y) * 0.45

    // 閒晃
    if (!focus && !this.busy && this.pending === 0) {
      this.wanderT -= dt
      if (this.wanderT < 0) {
        this.wanderT = 7 + this.rand() * 9
        const a = this.rand() * Math.PI * 2
        const d = 0.4 + this.rand() * 1.1
        const target = HOME.clone().add(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d * 0.6))
        this._enqueue(async () => {
          this.busy = true
          await this._travel(target, 0.6)
          this.busy = false
        })
      } else if (this.wanderT < 5) {
        // 停下來時面向鏡頭
        this.faceAngle = Math.atan2(cam.x - this.root.position.x, cam.z - this.root.position.z)
      }
    }
    if (focus && !this.busy) this.faceAngle = Math.atan2(cam.x - this.root.position.x, cam.z - this.root.position.z)

    // 平滑轉向（慶祝旋轉時跳過）
    if (!this.busy || this.root.position.y < 0.05) {
      let d = this.faceAngle - this.root.rotation.y
      d = Math.atan2(Math.sin(d), Math.cos(d))
      this.root.rotation.y += d * Math.min(1, dt * 6)
    }
  }
}
