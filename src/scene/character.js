import * as THREE from 'three'
import { tween, ease, rng } from './util.js'
import { SEASONS } from './season.js'
import { buildOutfit, disposeOutfit } from './outfits.js'

const play = (dur, fn, opts = {}) => new Promise((res) => tween(dur, fn, { ...opts, onDone: res }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const POSES = ['walk', 'sit', 'study', 'cheer', 'lean', 'reach', 'duck', 'shy', 'stretch']

// 島上的貓娘主角（もち、ふじ）。模型（models/cat*.js）只提供關節、表情與配件掛點，
// 走路、慶祝、害羞、澆水、跪坐讀書等動作都在這裡疊加在關節的原始姿勢上。
// study：專注時在屋裡做什麼（'read' 讀書、'write' 寫筆記）
export class Character {
  constructor(world, labels, sky, { id, name, build, home, seat, study }) {
    this.world = world
    this.labels = labels
    this.sky = sky
    this.id = id
    this.name = name
    this.home = home.clone()
    this.seatIndex = seat
    this.study = study
    this.rand = rng((Date.now() + seat * 7919) % 100000)
    const root = (this.root = new THREE.Group())
    root.position.copy(home)
    root.userData.pick = { type: 'char', id }
    world.scene.add(root)
    world.addPickable(root)

    const model = (this.model = build())
    root.add(model)
    this.ui = model.userData
    this.joints = this.ui.joints
    // 每個關節的原始姿勢，動作都是在這上面加減
    this.rest = new Map()
    const keep = (j) => j && this.rest.set(j, { p: j.position.clone(), r: j.rotation.clone(), s: j.scale.clone() })
    for (const [k, j] of Object.entries(this.joints)) {
      if (k === 'tail') j.forEach(keep)
      else keep(j)
    }
    // 卡通式的自發光：背光時臉也不會暗下來（皮膚多一些），夜裡再亮一點點。
    // 角色很小，自己的瀏海陰影落在臉上只會髒髒的，所以不接收陰影
    this.glow = new Map()
    this.nightNow = -1
    this._glow(model, model.getObjectByName('head-volume')?.material)
    // 舉手時往外的方向（左右手相反）
    this.armOut = { L: Math.sign(this.joints.armL.position.x) || 1, R: Math.sign(this.joints.armR.position.x) || -1 }

    this.pose = Object.fromEntries(POSES.map((k) => [k, 0]))
    this.stride = 0
    this.tilt = 0
    this.flick = { L: 0, R: 0, t: 2 }
    this.faceNow = ''
    this.mouthNow = ''
    this.blushNow = -1
    this.temp = null // 暫時的表情 { face, mouth, until }
    this.blinkT = 2
    this.outfit = null
    this.outfitKey = 'none'
    // 好感度解鎖的動作（由 main 依好感度設定）；onWater 由 main 提供澆水目標與效果
    this.abilities = { water: false, sit: false }
    this.onWater = null
    this._lastWater = 0
    // cabin、room、others 由 Duo 接上
    this.cabin = null
    this.room = null
    this.others = []
    this.inside = false
    this.busy = false
    this.mode = 'idle'
    this.chain = Promise.resolve()
    this.pending = 0
    this.wanderT = 4 + this.rand() * 4
    this.target = null
    this.faceAngle = 0
    this.bubble = null
    world.add((dt, t) => this.update(dt, t))
  }

  get position() {
    return this.root.position
  }

  _glow(root, skin) {
    root.traverse((o) => {
      if (!o.isMesh) return
      o.receiveShadow = false
      const m = o.material
      if (!m.emissive || m.map || this.glow.has(m)) return
      m.emissive.copy(m.color)
      this.glow.set(m, m === skin ? 0.4 : 0.16)
      m.emissiveIntensity = this.glow.get(m) + Math.max(0, this.nightNow) * 0.05
    })
  }

  setSeason(key) {
    const s = SEASONS[key]
    this.ui.setClip?.(s.clip)
    if (this.ui.scarf) this.ui.scarf.visible = !!s.scarf
  }

  // 衣裝分成幾個零件，各自掛到模型的配件掛點上
  setOutfit(key = 'none') {
    if (key === this.outfitKey) return
    this.outfitKey = key
    if (this.outfit) {
      for (const [, obj] of this.outfit.parts) {
        obj.removeFromParent()
        obj.traverse((o) => o.isMesh && this.glow.delete(o.material))
      }
      disposeOutfit(this.outfit)
      this.outfit = null
    }
    const built = key !== 'none' ? buildOutfit(key, this.id) : null
    if (built?.parts) {
      for (const [anchor, obj] of built.parts) {
        const parent = this.ui.anchors[anchor] ?? this.joints.head
        parent.add(obj)
        this._glow(obj)
      }
      this.outfit = built
    }
    this.ui.setClipVisible?.(!built?.hideClip)
  }

  headAnchor() {
    if (this.inside && !this.room?.active) return this.cabin.point('roofTop')
    return this.ui.anchors.headTop.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.38, 0))
  }

  // ── 對話泡泡 ──
  say(text, ms = 3400) {
    if (!text) return
    this.hush()
    // 兩人靠得近時泡泡會疊在一起，只留最新說話的那位
    const at = this.headAnchor()
    for (const o of this.others) if (o.bubble && o.headAnchor().distanceTo(at) < 3) o.hush()
    const el = document.createElement('div')
    el.className = `bubble ${this.id}`
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

  hush() {
    const old = this.bubble
    if (!old) return
    this.bubble = null
    old.el.classList.add('out')
    setTimeout(() => this.labels.remove(old), 300)
  }

  // 暫時換個表情（秒數到了回到平常的樣子）
  express(face, secs = 1.2, mouth = 'cat') {
    this.temp = { face, mouth, until: performance.now() + secs * 1000 }
  }

  // ── 動作佇列 ──
  _enqueue(fn) {
    this.pending++
    this.chain = this.chain.then(fn).catch((e) => console.warn('[hiyori]', this.id, e)).finally(() => this.pending--)
    return this.chain
  }
  // 等手上的動作都做完
  settle() {
    return this._enqueue(async () => {})
  }

  // 小碎步走過去（帶一點蹦跳）
  async _travel(target, speed = 1.7) {
    const start = this.root.position.clone().setY(0)
    const end = target.clone().setY(0)
    const delta = end.clone().sub(start)
    const dist = delta.length()
    if (dist < 0.05) return
    this.faceAngle = Math.atan2(delta.x, delta.z)
    const steps = Math.max(2, Math.round(dist / 0.3))
    await play(dist / speed + 0.15, (k) => {
      this.root.position.lerpVectors(start, end, k)
      this.stride = k * steps * Math.PI
      this.pose.walk = Math.min(1, Math.min(k, 1 - k) * 10)
      this.root.position.y = Math.abs(Math.sin(this.stride)) * 0.05 * this.pose.walk
    }, { easing: ease.linear })
    this.root.position.y = 0
    this.pose.walk = 0
  }
  walkTo(pos) {
    return this._travel(pos)
  }

  // 蹲一下、跳起來轉一圈、雙手舉高
  async _celebrate() {
    const P = this.pose
    const r0 = this.root.rotation.y
    this.express('happy', 1.8, 'open')
    await play(0.14, (k) => (P.duck = k), { easing: ease.outCubic })
    await play(0.62, (k) => {
      this.root.position.y = Math.sin(k * Math.PI) * 0.55
      this.root.rotation.y = r0 + k * Math.PI * 2
      P.duck = Math.max(0, 1 - k * 4)
      P.cheer = Math.min(1, k * 3)
    }, { easing: ease.inOutSine })
    this.root.position.y = 0
    await play(0.4, (k) => {
      P.duck = Math.sin(k * Math.PI) * 0.6 * (1 - k)
      P.cheer = 1 - k
    }, { easing: ease.linear })
    P.duck = P.cheer = 0
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
      const dir = this.root.position.clone().sub(pos).setY(0)
      if (dir.lengthSq() < 0.01) dir.set(0, 0, 1)
      const near = pos.clone().setY(0).add(dir.normalize().multiplyScalar(0.95))
      await this._travel(near, 2.2)
      this.faceAngle = Math.atan2(pos.x - near.x, pos.z - near.z)
      onArrive?.()
      await this._celebrate()
      await wait(500)
      if (this.pending <= 1 && this.mode !== 'focus') await this._travel(this.home)
      this.busy = false
      this.wanderT = 8
    })
  }

  celebrate() {
    return this._enqueue(async () => {
      if (this.inside || this.mode === 'focus') return
      this.busy = true
      await this._celebrate()
      this.busy = false
    })
  }

  // 原地替對方加油：轉過去、雙手舉高揮兩下（不走動，不打斷手上的事）
  cheer(at) {
    if (this.inside || this.mode === 'focus' || this.busy || this.pending > 0) return
    if (at) this.faceAngle = Math.atan2(at.x - this.position.x, at.z - this.position.z)
    // 先別急著閒晃或轉回鏡頭
    this.wanderT = Math.max(this.wanderT, 6.5)
    this.express('happy', 1.4, 'open')
    tween(1.3, (k) => {
      this.pose.cheer = Math.min(1, k * 5, (1 - k) * 4) * (0.75 + Math.sin(k * Math.PI * 6) * 0.25)
    }, { easing: ease.linear, onDone: () => (this.pose.cheer = 0) })
  }

  // 被摸頭：害羞閉眼、耳朵往後壓、歪歪頭、尾巴搖快一點
  pet() {
    this.express('shy', 1.5)
    tween(1.5, (k) => {
      this.pose.shy = Math.min(1, k * 5, (1 - k) * 4)
      this.tilt = Math.sin(k * Math.PI * 3) * 0.16 * (1 - k)
    }, { easing: ease.linear })
  }

  // 替花澆水：走到花旁、彎腰伸手、灑水，再回家
  async _water(target) {
    this.busy = true
    const P = this.pose
    const dir = this.root.position.clone().sub(target.pos).setY(0)
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1)
    const near = target.pos.clone().setY(0).add(dir.normalize().multiplyScalar(0.85))
    await this._travel(near)
    this.faceAngle = Math.atan2(target.pos.x - near.x, target.pos.z - near.z)
    await play(0.35, (k) => {
      P.lean = k * 0.8
      P.reach = k
    }, { easing: ease.inOutSine })
    this.onWater?.sprinkle(target)
    this.express('happy', 1.4)
    await wait(1300)
    await play(0.35, (k) => {
      P.lean = (1 - k) * 0.8
      P.reach = 1 - k
    }, { easing: ease.inOutSine })
    await wait(400)
    if (this.mode !== 'focus') await this._travel(this.home)
    this.busy = false
    this.wanderT = 10
  }

  // ── 小木屋 ──
  // 彎腰鑽進門，坐到屋裡的坐墊上
  async slipIn(inside) {
    const door = this.root.position.clone()
    this.faceAngle = Math.atan2(inside.x - door.x, inside.z - door.z)
    await play(0.55, (k) => {
      this.root.position.lerpVectors(door, inside, ease.inOutSine(k))
      this.pose.duck = Math.min(1, k * 3)
      this.stride = k * 4 * Math.PI
      this.pose.walk = 0.6
    }, { easing: ease.linear })
    this.pose.walk = 0
    this.toRoom()
  }
  // 從門裡鑽出來，站到門口
  async slipOut(inside, door) {
    this.toIsland(inside)
    this.root.rotation.y = this.faceAngle = Math.atan2(door.x - inside.x, door.z - inside.z)
    await play(0.5, (k) => {
      this.root.position.lerpVectors(inside, door, ease.inOutSine(k))
      this.pose.duck = Math.max(0, 1 - k * 1.6)
      this.stride = k * 4 * Math.PI
      this.pose.walk = 0.6
    }, { easing: ease.linear })
    this.pose.walk = this.pose.duck = 0
  }
  // 專注結束，在屋裡伸個懶腰
  async stretch() {
    this.express('closed', 1, 'open')
    await play(0.9, (k) => {
      const s = Math.sin(k * Math.PI)
      this.pose.stretch = s
      this.pose.study = 1 - Math.min(1, k * 2)
    }, { easing: ease.inOutSine })
    this.pose.stretch = 0
  }

  // 坐到室內的坐墊上（身體換到室內場景，小島上就看不到了）
  toRoom() {
    const s = this.room.seat(this.seatIndex)
    this.room.scene.add(this.root)
    this.root.position.copy(s.position)
    this.root.rotation.y = this.faceAngle = s.facing
    Object.assign(this.pose, { walk: 0, duck: 0, sit: 1, study: 1 })
    this.inside = true
  }
  toIsland(at) {
    this.world.scene.add(this.root)
    this.root.position.copy(at)
    Object.assign(this.pose, { sit: 0, study: 0 })
    this.inside = false
  }

  // ── 每幀 ──
  update(dt, t) {
    const n = Math.round(this.sky.night * 50) / 50
    if (n !== this.nightNow) {
      this.nightNow = n
      for (const [m, base] of this.glow) m.emissiveIntensity = base + n * 0.05
    }
    this._pose(dt, t)
    this._face(dt)
    if (this.inside) return

    // 閒晃：在自己家附近走走，不要撞到另一位
    if (this.mode !== 'focus' && !this.busy && this.pending === 0) {
      this.wanderT -= dt
      if (this.wanderT < 0) {
        this.wanderT = 7 + this.rand() * 9
        // 好感度夠的話，偶爾去花圃替花澆水（至少隔 2.5 分鐘）
        const now = performance.now()
        if (this.abilities.water && this.onWater && now - this._lastWater > 150000 && this.rand() < 0.35) {
          const target = this.onWater.target()
          if (target) {
            this._lastWater = now
            this._enqueue(() => this._water(target))
            return
          }
        }
        const spot = this._wanderSpot()
        if (spot) {
          this.target = spot
          this._enqueue(async () => {
            this.busy = true
            await this._travel(spot, 1.2)
            this.busy = false
            this.target = null
          })
        }
      } else if (this.wanderT < 5) {
        // 停下來時面向鏡頭
        const cam = this.world.camera.position
        this.faceAngle = Math.atan2(cam.x - this.root.position.x, cam.z - this.root.position.z)
      }
    }

    // 平滑轉向（跳起來轉圈時跳過）
    if (!this.busy || this.root.position.y < 0.05) {
      let d = this.faceAngle - this.root.rotation.y
      d = Math.atan2(Math.sin(d), Math.cos(d))
      this.root.rotation.y += d * Math.min(1, dt * 6)
    }
  }

  _wanderSpot() {
    for (let i = 0; i < 6; i++) {
      const a = this.rand() * Math.PI * 2
      const d = 0.4 + this.rand() * 1.0
      const p = this.home.clone().add(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d * 0.6))
      const clear = this.others.every((o) => o.inside || (p.distanceTo(o.position) > 1.1 && (!o.target || p.distanceTo(o.target) > 1.1)))
      if (clear) return p
    }
    return null
  }

  // 依各種姿勢的權重，算出每個關節這一幀的角度
  _pose(dt, t) {
    const J = this.joints
    const P = this.pose
    const R = (j) => this.rest.get(j)
    const sw = Math.sin(this.stride)
    const breath = Math.sin(t * (this.inside ? 1.3 : 2.2))

    // 屋裡讀書偶爾看得太入迷，往前點一下頭；寫字時手輕輕動
    const nod = this.inside ? Math.max(0, Math.sin(t * 0.23 + this.seatIndex * 2)) ** 16 * 0.16 : 0
    const scribble = this.study === 'write' ? Math.sin(t * 9) * 0.07 * P.study : 0
    const page = this.study === 'read' ? Math.max(0, Math.sin(t * 0.31 + 1)) ** 30 * 0.5 * P.study : 0

    const hips = R(J.hips)
    J.hips.position.y = hips.p.y * (1 - P.sit * 0.55) - P.duck * 0.06
    J.hips.rotation.x = hips.r.x + P.lean * 0.35 + P.duck * 0.12 + P.study * 0.06
    J.hips.rotation.z = hips.r.z + sw * 0.05 * P.walk

    const torso = R(J.torso)
    J.torso.scale.y = torso.s.y * (1 + breath * 0.012)
    J.torso.rotation.x = torso.r.x - P.stretch * 0.15

    const head = R(J.head)
    J.head.rotation.x = head.r.x + P.study * 0.3 + nod + P.duck * 0.28 + P.lean * 0.15 - P.cheer * 0.15 - P.stretch * 0.3
    J.head.rotation.z = head.r.z + this.tilt + (this.inside ? 0 : Math.sin(t * 0.37 + this.seatIndex) * 0.03)

    for (const side of ['L', 'R']) {
      const arm = J['arm' + side]
      const r = R(arm)
      const swing = (side === 'L' ? sw : -sw) * 0.6 * P.walk
      const right = side === 'R'
      const study = P.study * (this.study === 'write' && right ? 1.05 : 0.9) + (right ? scribble + page : 0)
      arm.rotation.x = r.r.x + swing - study - (right ? P.reach * 1.2 : 0) - P.shy * 0.5
      arm.rotation.z = r.r.z + this.armOut[side] * (P.cheer * 2.3 + P.stretch * 2.6 + P.walk * 0.1)
    }

    for (const side of ['L', 'R']) {
      const leg = J['leg' + side]
      const r = R(leg)
      leg.rotation.x = r.r.x + (side === 'L' ? -sw : sw) * 0.6 * P.walk + P.sit * 1.5
    }

    // 耳朵偶爾抖一下；害羞時往後壓
    const f = this.flick
    f.t -= dt
    if (f.t < 0) {
      f.t = 2 + this.rand() * 5
      f[this.rand() < 0.5 ? 'L' : 'R'] = 1
    }
    for (const side of ['L', 'R']) {
      const ear = J['ear' + side]
      const r = R(ear)
      f[side] = Math.max(0, f[side] - dt * 5)
      ear.rotation.x = r.r.x - P.shy * 0.55 + P.cheer * 0.1
      ear.rotation.z = r.r.z + Math.sin(f[side] * Math.PI * 2) * 0.25 * this.armOut[side]
    }

    // 尾巴左右擺；高興或害羞時擺快一點
    const wag = 1 + P.cheer * 1.5 + P.shy * 2
    J.tail.forEach((seg, i) => {
      const r = R(seg)
      seg.rotation.y = r.r.y + Math.sin(t * 1.6 * wag - i * 0.7) * (0.14 + 0.06 * i) * (0.6 + 0.4 * wag)
      seg.rotation.x = r.r.x + Math.sin(t * 0.9 - i * 0.5) * 0.04
    })
  }

  // 表情：暫時的表情優先；平常睜眼、讀書時半垂眼，偶爾眨眼
  _face(dt) {
    let face = this.inside && this.pose.study > 0.5 ? 'half' : 'open'
    let mouth = 'cat'
    if (this.temp && performance.now() < this.temp.until) ({ face, mouth } = this.temp)
    else {
      this.temp = null
      this.blinkT -= dt
      if (this.blinkT < 0) {
        face = 'closed'
        if (this.blinkT < -0.13) this.blinkT = 2.2 + this.rand() * 3.5
      }
    }
    if (face !== this.faceNow) this.ui.setFace((this.faceNow = face))
    if (mouth !== this.mouthNow) this.ui.setMouth((this.mouthNow = mouth))
    const blush = face === 'shy' ? 1 : 0.4
    if (blush !== this.blushNow) this.ui.setBlush((this.blushNow = blush))
  }
}
