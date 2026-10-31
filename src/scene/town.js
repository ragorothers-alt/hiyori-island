import * as THREE from 'three'
import { mat, rng, wobble, tween, ease, wait, glowTexture } from './util.js'
import { LAYOUT } from './island.js'
import { buildIslandBase } from './islandBase.js'
import { BUILDINGS, RESIDENTS, MOVE_IN } from '../data/town.js'
import { buildBuilding, buildResident } from './models/town/index.js'

// ひより町：主島後方的街區浮島。每座一棟建築（依階段換模型）和一條越過時之環的拱橋，
// 2 階起店長住在這裡：在浮島上閒晃、站在店門口，偶爾走過橋到主島找もち和ふじ聊天。

// a：從主島正後方（-z）往右（+x）量的角度；r：到鎮中心的距離；y：浮島頂面高度
// 全部排在同一圈：外面是雲鯨的軌道（半徑 22）和畫面右上角的星之大樹；正後方留空，主島後排的塔會擋住那裡
export const DISTRICTS = {
  florist: { a: -20, r: 17, y: 0.3 },
  library: { a: 20, r: 17, y: 0.3 },
  cafe: { a: -45, r: 17, y: 0.9 },
  bathhouse: { a: 45, r: 17, y: 0.9 },
  clock: { a: -70, r: 17, y: 0.5 },
  post: { a: 70, r: 17, y: 0.5 },
}
const ISLET_R = 2.7
// 街區浮島開張時從雲海底下升起的距離
const RISE = 17
// 建築放在浮島中心稍微後面，前面留一塊小廣場
const BUILD_Z = -0.5
// 各階段建築的佔地半徑（居民閒晃要避開）
const FOOT = [0, 0.9, 1.1, 1.35, 1.55, 1.7]
const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)
const play = (dur, fn, opts = {}) => new Promise((res) => tween(dur, fn, { ...opts, onDone: res }))

// 每座街區的位置、朝向、橋頭
function layoutOf(key) {
  const d = DISTRICTS[key]
  const a = d.a * DEG
  const center = new THREE.Vector3(Math.sin(a) * d.r, d.y, -Math.cos(a) * d.r)
  const inward = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))
  // 建築朝鎮中心、再往鏡頭（+z）偏一點，遠看是 3/4 側面
  const face = inward.clone().lerp(new THREE.Vector3(0, 0, 1), 0.4).normalize()
  const rot = Math.atan2(face.x, face.z)
  const landing = center.clone().addScaledVector(inward, ISLET_R - 0.3)
  const shore = inward.clone().multiplyScalar(-(LAYOUT.radius - 0.45)).setY(0.02)
  return { center, inward, face, rot, landing, shore }
}

// ── 浮島：主島縮小版（草地共用主島材質，換季一起變色） ──
function buildIslet(island, seed) {
  const g = new THREE.Group()
  const R = ISLET_R
  const jitter = (geo, amp, s) => {
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const z = p.getZ(i)
      if (Math.hypot(x, z) < 0.01) continue
      const k = 1 + amp * wobble(Math.atan2(z, x), s)
      p.setX(i, x * k)
      p.setZ(i, z * k)
    }
    geo.computeVertexNormals()
    return geo
  }
  const grass = new THREE.Mesh(jitter(new THREE.CylinderGeometry(R, R * 0.97, 0.5, 40, 1), 0.05, seed), island.grassMat)
  grass.position.y = -0.25
  grass.receiveShadow = true
  const rim = new THREE.Mesh(jitter(new THREE.CylinderGeometry(R * 1.01, R * 0.98, 0.14, 40, 1, true), 0.05, seed), island.rimMat)
  rim.position.y = -0.45
  // 草地以下和主島同一套：層疊岩壁、垂根苔蘚、岩錐，朝鏡頭那一側一道細瀑布
  const base = buildIslandBase({ radius: R * 0.975, top: -0.48, cliff: 1.1, depth: 4.4, seed, wob: 0.05, segs: 40, roots: 0.8, falls: [Math.PI / 2 + ((seed * 7) % 3) * 0.5 - 0.5], fallTo: -15 })
  const r = rng(seed * 31 + 7)
  const c = new THREE.Color()
  g.add(grass, rim, base)

  // 野花小點（避開建築）
  const spots = []
  while (spots.length < 22) {
    const a = r() * Math.PI * 2
    const d = Math.sqrt(r()) * (R - 0.35)
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (Math.hypot(x, z - BUILD_Z) > 1.9) spots.push([x, z])
  }
  const dotMat = new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.08 })
  const dots = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.055, 0), dotMat, spots.length)
  const o = new THREE.Object3D()
  const palette = ['#ffffff', '#fde2ea', '#f9c9d6', '#fff2b8', '#dfe9ff']
  spots.forEach(([x, z], k) => {
    o.position.set(x, 0.07, z)
    o.scale.setScalar(0.8 + r() * 0.6)
    o.updateMatrix()
    dots.setMatrixAt(k, o.matrix)
    dots.setColorAt(k, c.set(palette[Math.floor(r() * palette.length)]))
  })
  g.add(dots)
  g.userData.ownedMaterials = [...base.userData.ownedMaterials, dotMat]
  return g
}

// 店門口到橋頭的踏腳石
function stepStones(from, to, seed) {
  const r = rng(seed)
  const n = Math.max(2, Math.round(from.distanceTo(to) / 0.42))
  const stones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.19, 0.06, 7), mat('#d9d4d0'), n)
  const o = new THREE.Object3D()
  for (let i = 0; i < n; i++) {
    o.position.lerpVectors(from, to, (i + 0.5) / n)
    o.position.x += (r() - 0.5) * 0.12
    o.position.z += (r() - 0.5) * 0.12
    o.position.y = 0.02
    o.rotation.y = r() * 3
    o.scale.setScalar(0.85 + r() * 0.3)
    o.updateMatrix()
    stones.setMatrixAt(i, o.matrix)
  }
  stones.receiveShadow = true
  return stones
}

// ── 拱橋：從主島邊緣拱過時之環到浮島 ──
function buildBridge(a, b) {
  const g = new THREE.Group()
  const dir = b.clone().sub(a).setY(0)
  const len = dir.length()
  dir.normalize()
  const lift = new THREE.Vector3(0, 1.25 + len * 0.04, 0)
  const curve = new THREE.CubicBezierCurve3(
    a.clone(),
    a.clone().addScaledVector(dir, len * 0.3).add(lift),
    b.clone().addScaledVector(dir, -len * 0.3).add(lift),
    b.clone(),
  )
  const total = curve.getLength()
  const side = new THREE.Vector3().crossVectors(UP, dir).normalize()
  const o = new THREE.Object3D()
  // 木板
  const n = Math.ceil(total / 0.26)
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.07, 0.2), mat('#dcb791'), n)
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    o.position.copy(curve.getPointAt(u))
    o.lookAt(o.position.clone().add(curve.getTangentAt(u)))
    o.updateMatrix()
    planks.setMatrixAt(i, o.matrix)
  }
  planks.castShadow = planks.receiveShadow = true
  // 欄杆柱
  const m = Math.max(2, Math.round(total / 1.1))
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 5), mat('#b58d6b'), m * 2)
  o.rotation.set(0, 0, 0)
  for (let i = 0; i < m; i++) {
    const p = curve.getPointAt(i / (m - 1))
    for (const s of [-1, 1]) {
      o.position.copy(p).addScaledVector(side, 0.4 * s).add(new THREE.Vector3(0, 0.22, 0))
      o.updateMatrix()
      posts.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), o.matrix)
    }
  }
  // 兩側繩欄
  const ropes = [-1, 1].map((s) => {
    const pts = curve.getSpacedPoints(40).map((p) => p.clone().addScaledVector(side, 0.4 * s).add(new THREE.Vector3(0, 0.44, 0)))
    return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.022, 5), mat('#c9a27a'))
  })
  // 包圍球要用全部的板子先算好：鋪橋時 count 從 0 開始，等到第一次畫才算會是空的，整座橋就一直被當成在畫面外
  planks.computeBoundingSphere()
  posts.computeBoundingSphere()
  g.add(planks, posts, ...ropes)
  g.userData = { curve, planks, posts, ropes, n, m }
  return g
}

// 橋從主島這端一路鋪過去（0..1）
function revealBridge(bridge, k) {
  const { planks, posts, ropes, n, m } = bridge.userData
  planks.count = Math.round(n * k)
  posts.count = Math.round(m * k) * 2
  for (const r of ropes) r.geometry.setDrawRange(0, Math.floor((r.geometry.index.count * k) / 3) * 3)
}

// 街區在太陽陰影的範圍外：建築和居民腳下各墊一片柔和的圓影（幾何與材質共用）
const BLOB_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
let blobMat = null
function blob(size) {
  blobMat ??= new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#5d5878', transparent: true, opacity: 0.4, depthWrite: false })
  const m = new THREE.Mesh(BLOB_GEO, blobMat)
  m.scale.set(size, 1, size)
  m.position.y = 0.012
  m.userData.shared = true
  return m
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.userData?.shared) return
    if (o.isInstancedMesh) o.dispose()
    o.geometry?.dispose()
    for (const m of o.userData?.ownedMaterials || []) m.dispose()
    for (const t of o.userData?.ownedTextures || []) t.dispose()
  })
}

// ── 主島上的步行路線 ──
// 0.45 格的 A*（八方向、斜走不切角），再把互相看得到的點拉直；blocked(x, z) 由 main 提供（池塘、花圃、小木屋、塔、擺設…）
const STEP = 0.45
export function islandPath(from, to, blocked) {
  const R = LAYOUT.radius - 0.3
  const N = Math.ceil(R / STEP)
  const W = N * 2 + 1
  const ok = (x, z) => Math.hypot(x, z) <= R && !blocked(x, z)
  const id = (i, j) => (j + N) * W + (i + N)
  const si = Math.round(from.x / STEP)
  const sj = Math.round(from.z / STEP)
  const gi = Math.round(to.x / STEP)
  const gj = Math.round(to.z / STEP)
  const start = id(si, sj)
  const goal = id(gi, gj)
  const cost = new Float32Array(W * W).fill(Infinity)
  const came = new Int32Array(W * W).fill(-1)
  const closed = new Uint8Array(W * W)
  const free = new Int8Array(W * W).fill(-1)
  const freeAt = (i, j) => {
    const c = id(i, j)
    if (free[c] < 0) free[c] = c === goal || c === start || ok(i * STEP, j * STEP) ? 1 : 0
    return free[c] === 1
  }
  const h = (i, j) => Math.hypot(i - gi, j - gj)
  cost[start] = 0
  // 格子不多，open 用陣列線性找最小值就夠快
  const open = [[h(si, sj), si, sj]]
  while (open.length) {
    let best = 0
    for (let k = 1; k < open.length; k++) if (open[k][0] < open[best][0]) best = k
    const [, i, j] = open[best]
    open[best] = open[open.length - 1]
    open.pop()
    const c = id(i, j)
    if (closed[c]) continue
    closed[c] = 1
    if (c === goal) break
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue
        const ni = i + di
        const nj = j + dj
        if (Math.abs(ni) > N || Math.abs(nj) > N || !freeAt(ni, nj)) continue
        if (di && dj && (!freeAt(i + di, j) || !freeAt(i, j + dj))) continue
        const n = id(ni, nj)
        const g = cost[c] + (di && dj ? Math.SQRT2 : 1)
        if (closed[n] || g >= cost[n]) continue
        cost[n] = g
        came[n] = c
        open.push([g + h(ni, nj), ni, nj])
      }
    }
  }
  if (goal !== start && came[goal] < 0) return null
  const pts = []
  for (let c = goal; c >= 0 && c !== start; c = came[c]) pts.push(new THREE.Vector3(((c % W) - N) * STEP, 0, (Math.floor(c / W) - N) * STEP))
  pts.reverse()
  pts.unshift(from.clone().setY(0))
  pts[pts.length - 1] = to.clone().setY(0)
  // 拉直：從目前的點一路往後找最遠一個走得到的點
  const clear = (a, b) => {
    const n = Math.ceil(a.distanceTo(b) / 0.15)
    for (let k = 1; k < n; k++) {
      const t = k / n
      if (!ok(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false
    }
    return true
  }
  const out = []
  for (let a = 0; a < pts.length - 1; ) {
    let b = pts.length - 1
    while (b > a + 1 && !clear(pts[a], pts[b])) b--
    out.push(pts[b])
    a = b
  }
  return out
}

// ── 居民 ──
class Resident {
  constructor(town, key) {
    this.town = town
    this.key = key
    this.info = RESIDENTS[key]
    this.model = buildResident(this.info.kind)
    this.root = new THREE.Group()
    this.shadow = blob(0.9)
    this.root.add(this.model, this.shadow)
    this.root.userData.pick = { type: 'resident', id: key }
    this.state = { walk: 0, wave: 0, talk: 0, night: 0 }
    this.goal = { walk: 0, wave: 0, talk: 0 }
    this.face = 0
    this.busy = false
    this.away = false
    this.wanderT = 2 + Math.random() * 5
    this.bubble = null
    town.group.add(this.root)
  }
  get position() {
    return this.root.position
  }
  get district() {
    return this.town.districts[this.info.home]
  }
  headAnchor() {
    this.root.updateMatrixWorld()
    return this.model.localToWorld(this.model.userData.headTop.clone()).add(new THREE.Vector3(0, 0.15, 0))
  }

  say(text, ms = 3400) {
    if (!text) return
    this.hush()
    const el = document.createElement('div')
    el.className = 'bubble res'
    el.style.setProperty('--rc', this.info.color)
    const who = document.createElement('small')
    who.textContent = this.info.name
    el.append(who, text)
    const item = (this.bubble = this.town.labels.add(el, () => this.headAnchor()))
    this.goal.talk = 1
    clearTimeout(this._sayTimer)
    this._sayTimer = setTimeout(() => {
      this.goal.talk = 0
      el.classList.add('out')
      setTimeout(() => {
        this.town.labels.remove(item)
        if (this.bubble === item) this.bubble = null
      }, 300)
    }, ms)
  }
  hush() {
    const old = this.bubble
    if (!old) return
    this.bubble = null
    this.goal.talk = 0
    old.el.classList.add('out')
    setTimeout(() => this.town.labels.remove(old), 300)
  }
  async wave(secs = 1.4) {
    this.goal.wave = 1
    await wait(secs)
    this.goal.wave = 0
  }
  faceTo(p) {
    this.face = Math.atan2(p.x - this.position.x, p.z - this.position.z)
  }
  faceCamera() {
    this.faceTo(this.town.world.camera.position)
  }

  async _travel(to, speed) {
    const from = this.position.clone()
    const dist = from.distanceTo(to)
    if (dist < 0.02) return
    this.faceTo(to)
    this.goal.walk = 1
    await play(dist / speed, (k) => this.position.lerpVectors(from, to, k), { easing: ease.linear })
  }
  async walk(points, speed = 0.9) {
    for (const p of points) await this._travel(p, speed)
    this.goal.walk = 0
  }

  // 自己浮島上一個空著的地方（避開建築）
  _spot() {
    const d = this.district
    if (!d) return null
    const foot = FOOT[d.stage] + 0.3
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * (ISLET_R - 0.5)
      const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)
      if (Math.hypot(p.x, p.z - BUILD_Z) < foot) continue
      return d.root.localToWorld(p)
    }
    return null
  }
  // 店門口
  doorstep() {
    const d = this.district
    // 小鎮剛被重蓋（匯入存檔）時，舊的居民原地停下
    if (!d) return this.position.clone()
    d.root.updateMatrixWorld(true)
    return d.building.localToWorld(d.model.userData.front.clone().setY(0))
  }

  update(dt, t, night) {
    const s = this.state
    const k = Math.min(1, dt * 7)
    for (const key of ['walk', 'wave', 'talk']) s[key] += (this.goal[key] - s[key]) * k
    s.night = night
    let d = this.face - this.root.rotation.y
    d = Math.atan2(Math.sin(d), Math.cos(d))
    this.root.rotation.y += d * Math.min(1, dt * 6)
    this.model.userData.anim?.(t, dt, s)
    // 走到主島上就有真的影子
    this.shadow.visible = Math.hypot(this.position.x, this.position.z) > LAYOUT.radius + 0.5
    if (this.busy || this.away) return
    this.wanderT -= dt
    if (this.wanderT > 0) {
      // 停下來的時候面向鏡頭
      if (this.wanderT < 4) this.faceCamera()
      return
    }
    // 晚上多半待在店門口
    this.wanderT = 6 + Math.random() * 9
    const spot = Math.random() < (night > 0.5 ? 0.7 : 0.3) ? this.doorstep() : this._spot()
    if (!spot) return
    this.busy = true
    this.walk([spot], 0.7).then(() => (this.busy = false))
  }

  dispose() {
    this.hush()
    clearTimeout(this._sayTimer)
    this.root.removeFromParent()
    disposeTree(this.model)
  }
}

export class Town {
  constructor(world, labels, island, sky) {
    this.world = world
    this.labels = labels
    this.island = island
    this.sky = sky
    this.group = new THREE.Group()
    world.scene.add(this.group)
    world.addPickable(this.group)
    // key → { key, stage, layout, root, islet, building, model, bridge, stones }
    this.districts = {}
    this.residents = {}
    // 新居民走到店門口時通知 main（說搬家台詞）
    this.onArrived = null
    this._clearFloaters()
    world.add((dt, t) => this.update(dt, t))
  }

  // 主島周圍漂浮的小石塊：擋到街區浮島或拱橋的，沿著圓周挪到旁邊的空位
  _clearFloaters() {
    const all = Object.keys(DISTRICTS).map(layoutOf)
    const hits = (x, z) =>
      all.some((L) => {
        if (Math.hypot(x - L.center.x, z - L.center.z) < ISLET_R + 1.8) return true
        // 到橋（主島中心沿 -inward 的射線）的距離
        const along = -(x * L.inward.x + z * L.inward.z)
        const across = Math.abs(x * L.inward.z - z * L.inward.x)
        return along > 0 && along < L.center.length() && across < 1.8
      })
    for (const f of this.island.floaters || []) {
      const p = f.position
      const d = Math.min(14, Math.hypot(p.x, p.z))
      const a0 = Math.atan2(p.z, p.x)
      for (let i = 0; i < 72; i++) {
        const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 5 * DEG
        const x = Math.cos(a) * d
        const z = Math.sin(a) * d
        if (hits(x, z)) continue
        p.x = x
        p.z = z
        break
      }
    }
  }

  get count() {
    return Object.keys(this.districts).length
  }
  get stages() {
    return Object.fromEntries(Object.values(this.districts).map((d) => [d.key, d.stage]))
  }

  // 依各建築階段（{ key: stage }）長出或更新街區
  sync(stages, animate = false) {
    for (const b of BUILDINGS) this.set(b.key, stages[b.key] || 0, animate)
  }

  // 把一座街區長到 stage 階；animate 時浮島從雲海升起、橋一路鋪過去、建築彈出來
  // 回傳 { found, at }（at 是建築頂端，放粒子用）；沒變化回傳 null
  set(key, stage, animate = false) {
    let d = this.districts[key]
    if (!stage || d?.stage === stage) return null
    const found = !d
    if (found) d = this._found(key, animate)
    this._setBuilding(d, stage, animate, found)
    const b = BUILDINGS.find((x) => x.key === key)
    if (stage >= MOVE_IN && !this.residents[b.resident]) this._addResident(b.resident, animate, found)
    const L = d.layout
    const top = d.model.userData.top.clone().add(d.building.position).applyAxisAngle(UP, L.rot).add(L.center)
    return { found, at: top }
  }

  // 匯入舊檔時整個重來
  reset() {
    for (const r of Object.values(this.residents)) r.dispose()
    for (const d of Object.values(this.districts)) {
      d.root.removeFromParent()
      d.bridge.removeFromParent()
      disposeTree(d.root)
      disposeTree(d.bridge)
    }
    this.residents = {}
    this.districts = {}
  }

  _found(key, animate) {
    const L = layoutOf(key)
    const root = new THREE.Group()
    root.position.copy(L.center)
    root.rotation.y = L.rot
    const islet = buildIslet(this.island, BUILDINGS.findIndex((b) => b.key === key) + 1.3)
    root.add(islet)
    const building = new THREE.Group()
    building.position.set(0, 0, BUILD_Z)
    building.add(blob(0.001))
    root.add(building)
    root.userData.pick = { type: 'town', id: key }
    this.group.add(root)
    root.updateMatrixWorld(true)
    const bridge = buildBridge(L.shore, L.landing)
    this.group.add(bridge)
    const d = { key, stage: 0, layout: L, root, islet, building, bridge, model: null, stones: null }
    this.districts[key] = d
    if (animate) {
      // 浮島從雲海底下升起，橋從主島這端鋪過去
      // 起點整座沉在雲海頂面（y = -13）底下，高度霧會把它藏起來，升上來時才從雲裡冒出
      const y0 = L.center.y
      root.position.y = y0 - RISE
      root.scale.setScalar(0.6)
      revealBridge(bridge, 0)
      tween(2.6, (k) => {
        root.position.y = y0 - RISE * (1 - k)
        root.scale.setScalar(0.6 + 0.4 * k)
      }, { easing: ease.outBack, onDone: () => root.position.setY(y0) })
      tween(1.6, (k) => revealBridge(bridge, k), { delay: 1.6, easing: ease.inOutSine })
    }
    return d
  }

  _setBuilding(d, stage, animate, found) {
    const old = d.model
    const model = buildBuilding(d.key, stage)
    model.userData.pick = { type: 'town', id: d.key }
    d.model = model
    d.stage = stage
    d.building.add(model)
    // 腳下的圓影跟著建築一起長
    const shade = d.building.children[0]
    const s0 = shade.scale.x
    const s1 = FOOT[stage] * 2.7
    const grow = (k) => shade.scale.set(s0 + (s1 - s0) * k || 0.001, 1, s0 + (s1 - s0) * k || 0.001)
    grow(animate ? 0 : 1)
    // 店門口到橋頭的踏腳石跟著建築大小重鋪（在浮島自己的座標裡算，浮島還在升起也沒關係）
    if (d.stones) {
      d.stones.removeFromParent()
      d.stones.dispose()
      d.stones.geometry.dispose()
    }
    const front = model.userData.front.clone().setY(0).add(d.building.position)
    const L = d.layout
    const landing = L.inward.clone().multiplyScalar(ISLET_R - 0.3).applyAxisAngle(UP, -L.rot)
    d.stones = stepStones(front, landing, stage * 7 + 1)
    d.islet.add(d.stones)
    if (old) {
      if (animate) tween(0.35, (k) => old.scale.setScalar(Math.max(0.001, 1 - k)), { onDone: () => (old.removeFromParent(), disposeTree(old)) })
      else {
        old.removeFromParent()
        disposeTree(old)
      }
    }
    if (animate) {
      model.scale.setScalar(0.001)
      tween(1.0, (k) => {
        model.scale.setScalar(Math.max(0.001, k))
        grow(Math.min(1, k))
      }, { easing: ease.outBack, delay: found ? 2.6 : 0.35 })
    }
  }

  _addResident(key, animate, found) {
    const r = (this.residents[key] = new Resident(this, key))
    const d = r.district
    if (!animate) {
      r.position.copy(r.doorstep())
      r.face = r.root.rotation.y = d.layout.rot
      return
    }
    // 搬家：從主島那端走過橋，到店門口揮手
    r.position.copy(d.layout.shore)
    r.root.visible = false
    r.busy = true
    setTimeout(async () => {
      r.root.visible = true
      await r.walk(this._bridgePoints(d, false), 1.1)
      await r.walk([r.doorstep()], 0.9)
      r.faceCamera()
      this.onArrived?.(key)
      await r.wave(1.6)
      r.busy = false
      r.wanderT = 5
    }, found ? 3600 : 1400)
  }

  // 沿著橋走的點：toShore = true 是從浮島走向主島
  _bridgePoints(d, toShore) {
    const pts = d.bridge.userData.curve.getSpacedPoints(24)
    return toShore ? pts.reverse() : pts
  }

  // 去主島找もち和ふじ：meet() 回傳要走到的地方（過橋後才算，兩人可能在走動），
  // path(from, to) 給主島上繞開障礙物的路線，onArrive(resident) 是聊天（回傳 promise），聊完自己走回家
  async visit(key, { meet, path, onArrive }) {
    const r = this.residents[key]
    if (!r || r.busy || r.away) return false
    const d = r.district
    r.away = true
    r.busy = true
    try {
      await r.walk([d.layout.landing], 0.9)
      await r.walk(this._bridgePoints(d, true), 1.1)
      const target = meet(r)
      const route = target && path(d.layout.shore, target)
      if (route) {
        await r.walk(route, 1.0)
        await onArrive(r)
        await r.walk([...route].reverse().slice(1).concat([d.layout.shore]), 1.0)
      }
      await r.walk(this._bridgePoints(d, false), 1.1)
      await r.walk([r.doorstep()], 0.9)
    } finally {
      r.away = false
      r.busy = false
      r.wanderT = 4
    }
    return true
  }

  // 有居民正在主島上（拜訪中）
  get visiting() {
    return Object.values(this.residents).some((r) => r.away)
  }

  // 鏡頭飛過去要看的地方：大致從玩家平常的方向（+z）、偏向建築正面，由上往下看整座浮島和拱橋
  view(key) {
    const L = this.districts[key]?.layout || layoutOf(key)
    const dir = L.face.clone().add(new THREE.Vector3(0, 0, 1.5)).normalize()
    const target = L.center.clone().lerp(L.landing, 0.35).add(new THREE.Vector3(0, 1.1, 0))
    return { target, dir, radius: ISLET_R + 1.6 }
  }

  update(dt, t) {
    const night = this.sky.night
    const hour = this.sky.hour()
    for (const d of Object.values(this.districts)) d.model?.userData.anim?.(t, dt, { night, hour })
    for (const r of Object.values(this.residents)) r.update(dt, t, night)
  }
}
