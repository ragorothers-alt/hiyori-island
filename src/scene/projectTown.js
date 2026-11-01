import * as THREE from 'three'
import { mat, tween, ease, glowTexture, rng } from './util.js'
import { PLAN, MAX_TOWN_LEVEL, GATE_HALF, lotsAt, propPrints } from '../data/projectTown.js'

// 專案町的街景：石板街道與町心廣場、街燈行道樹長椅花台等小物、已開放但還沒人用的空地（木樁圍起來）。
// 房子本身在 towers.js；這裡只管「鎮」的部分，依城鎮等級（1–6）一級一級鋪出來。
// 石板路面（可無縫平鋪；測試環境沒有圖片，只用底色）
const PAVING = new URL('../assets/terrain/paving.webp', import.meta.url).href
const STREET_Y = 0.03
const CURB = 0.07 // 街道兩側收邊比路面寬出的距離

const WOOD = '#b48a6a'
const DARK_WOOD = '#8f6c58'
const STONE = '#e6e0d9'

// 一段街道（ab 兩端加圓角）的三角形，依序推進 pos；uv 用世界座標，重疊的地方畫出來一模一樣，不會閃
function pushStreet(pos, points, w, y) {
  const h = w / 2
  const disc = (x, z) => {
    const n = 12
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = ((i + 1) / n) * Math.PI * 2
      pos.push(x, y, z, x + Math.cos(a1) * h, y, z + Math.sin(a1) * h, x + Math.cos(a0) * h, y, z + Math.sin(a0) * h)
    }
  }
  disc(...points[0])
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    const len = Math.hypot(bx - ax, bz - az)
    if (len > 1e-6) {
      const nx = (-(bz - az) / len) * h
      const nz = ((bx - ax) / len) * h
      // 從上面看要逆時針（法線朝上），不然會被背面剔除
      pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz)
      pos.push(ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz)
    }
    disc(bx, bz)
  }
}

function pushPlaza(pos, r, y) {
  const { x, z } = PLAN.plaza
  const n = 48
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    pos.push(x, y, z, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, x + Math.cos(a0) * r, y, z + Math.sin(a0) * r)
  }
}

function groundGeo(pos) {
  const geo = new THREE.BufferGeometry()
  const p = new Float32Array(pos)
  const uv = new Float32Array((p.length / 3) * 2)
  const n = new Float32Array(p.length)
  for (let i = 0, j = 0; i < p.length; i += 3, j += 2) {
    uv[j] = p[i] * 0.45
    uv[j + 1] = p[i + 2] * 0.45
    n[i + 1] = 1
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

// ── 小物（原點在地面、正面朝 +z） ──
function box(g, w, h, d, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  o.position.set(x, y, z)
  g.add(o)
  return o
}
function cyl(g, rt, rb, h, seg, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m)
  o.position.set(x, y, z)
  g.add(o)
  return o
}

function lamp(t) {
  const g = new THREE.Group()
  cyl(g, 0.1, 0.13, 0.08, 6, mat(STONE), 0, 0.04)
  box(g, 0.07, 0.78, 0.07, mat(DARK_WOOD), 0, 0.46)
  box(g, 0.2, 0.22, 0.2, t.glowMat, 0, 0.92)
  const roof = cyl(g, 0.02, 0.2, 0.12, 4, mat('#7c6f78'), 0, 1.09)
  roof.rotation.y = Math.PI / 4
  t.halo(g, 0.92, 0.9)
  return g
}

function tree(t, seed) {
  const g = new THREE.Group()
  const r = rng(seed)
  cyl(g, 0.05, 0.08, 0.55, 6, mat('#9b7b65'), 0, 0.27)
  const greens = ['#a9d39f', '#b6dca6', '#9fcc9a']
  const blobs = [[0, 0.78, 0, 0.34], [0.17, 0.66, 0.08, 0.24], [-0.14, 0.7, -0.07, 0.26], [0.02, 1.0, 0.03, 0.22]]
  for (const [x, y, z, s] of blobs) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat(greens[Math.floor(r() * greens.length)]))
    b.position.set(x, y, z)
    b.rotation.set(r() * 3, r() * 3, 0)
    g.add(b)
  }
  return g
}

function bench() {
  const g = new THREE.Group()
  const wood = mat('#cfa781')
  box(g, 0.56, 0.05, 0.22, wood, 0, 0.25)
  box(g, 0.56, 0.15, 0.04, wood, 0, 0.41, -0.1)
  for (const x of [-0.23, 0.23]) {
    box(g, 0.05, 0.25, 0.18, mat(DARK_WOOD), x, 0.12)
    box(g, 0.04, 0.2, 0.04, mat(DARK_WOOD), x, 0.36, -0.1)
  }
  return g
}

function planter(seed) {
  const g = new THREE.Group()
  const r = rng(seed)
  box(g, 0.4, 0.2, 0.24, mat(WOOD), 0, 0.1)
  box(g, 0.35, 0.04, 0.19, mat('#a7b98c'), 0, 0.21)
  const petals = ['#f6b6c8', '#fbe39a', '#fff6ee', '#f3a7b9']
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 0), mat(petals[i % petals.length]))
    f.position.set(-0.13 + i * 0.065, 0.27 + r() * 0.04, (r() - 0.5) * 0.1)
    g.add(f)
  }
  return g
}

function sign(t) {
  const g = new THREE.Group()
  for (const x of [-0.15, 0.15]) box(g, 0.045, 0.86, 0.045, mat(DARK_WOOD), x, 0.43)
  box(g, 0.36, 0.3, 0.04, mat('#efe2cb'), 0, 0.6)
  // 貼在板上的兩張小紙
  box(g, 0.12, 0.1, 0.01, mat('#ffffff'), -0.07, 0.63, 0.025)
  box(g, 0.1, 0.08, 0.01, mat(t.accent), 0.08, 0.56, 0.025)
  const roof = box(g, 0.46, 0.04, 0.18, mat('#7c6f78'), 0, 0.82)
  roof.rotation.x = -0.12
  return g
}

function fountain(t) {
  const g = new THREE.Group()
  const stone = mat(STONE)
  cyl(g, 0.56, 0.6, 0.24, 18, stone, 0, 0.12)
  cyl(g, 0.47, 0.47, 0.02, 18, t.waterMat, 0, 0.21)
  cyl(g, 0.09, 0.12, 0.5, 8, stone, 0, 0.42)
  cyl(g, 0.24, 0.14, 0.09, 12, stone, 0, 0.68)
  const spout = cyl(g, 0.02, 0.07, 0.24, 8, t.sprayMat, 0, 0.84)
  spout.userData.noShadow = true
  t.spray.push(spout)
  return g
}

function gate(t) {
  const g = new THREE.Group()
  const post = mat(DARK_WOOD)
  for (const x of [-GATE_HALF, GATE_HALF]) {
    box(g, 0.1, 1.42, 0.1, post, x, 0.71)
    cyl(g, 0.09, 0.11, 0.08, 6, mat(STONE), x, 0.04)
  }
  box(g, GATE_HALF * 2 + 0.3, 0.1, 0.13, post, 0, 1.36)
  box(g, GATE_HALF * 2, 0.07, 0.08, post, 0, 1.14)
  const roof = box(g, GATE_HALF * 2 + 0.5, 0.07, 0.42, mat('#97a5c0'), 0, 1.46)
  roof.rotation.x = 0.04
  box(g, 0.4, 0.2, 0.03, mat('#f4ead8'), 0, 1.25, 0.06)
  // 門兩側掛的小燈籠
  for (const x of [-0.58, 0.58]) {
    box(g, 0.012, 0.12, 0.012, post, x, 1.04, 0.07)
    box(g, 0.12, 0.16, 0.12, t.glowMat, x, 0.92, 0.07)
    t.halo(g, 0.92, 0.6, x, 0.07)
  }
  return g
}

function stakes(lot) {
  const g = new THREE.Group()
  const h = (lot.size - 0.4) / 2
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(h * 2, h * 2), mat('#e4d4bd', { roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }))
  soil.rotation.x = -Math.PI / 2
  soil.position.y = 0.012
  soil.receiveShadow = true
  g.add(soil)
  const post = mat('#c59f7c')
  const rope = mat('#f3e7d3')
  for (const [x, z] of [[-h, -h], [h, -h], [h, h], [-h, h]]) box(g, 0.06, 0.32, 0.06, post, x, 0.16, z)
  for (const s of [-1, 1]) {
    box(g, h * 2, 0.018, 0.018, rope, 0, 0.24, s * h)
    box(g, 0.018, 0.018, h * 2, rope, s * h, 0.24, 0)
  }
  // 地前方插一支小牌子
  box(g, 0.03, 0.3, 0.03, post, h * 0.55, 0.15, h + 0.02)
  box(g, 0.22, 0.13, 0.02, mat('#fff8ee'), h * 0.55, 0.31, h + 0.04)
  g.rotation.y = lot.rot
  g.position.set(lot.x, 0, lot.z)
  for (const o of g.children) o.castShadow = o !== soil
  return g
}

export class ProjectTown {
  constructor(world, sky) {
    this.world = world
    this.sky = sky
    this.group = new THREE.Group()
    world.scene.add(this.group)
    this.level = 0
    this.accent = '#f2a3b8'
    this.glowMat = new THREE.MeshStandardMaterial({ color: '#fff3d8', emissive: '#ffcf8f', emissiveIntensity: 0.3, roughness: 0.6, flatShading: true })
    this.waterMat = new THREE.MeshStandardMaterial({ color: '#a8d6ec', emissive: '#7fc4e6', emissiveIntensity: 0.15, roughness: 0.25, metalness: 0.1 })
    this.sprayMat = new THREE.MeshStandardMaterial({ color: '#e9f7ff', transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false })
    this.halos = []
    this.spray = []
    this.paveMat = new THREE.MeshStandardMaterial({ color: '#efe8de', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    this.curbMat = new THREE.MeshStandardMaterial({ color: '#d9cfc3', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    this.streets = [] // 每一級：{ pave, curb }
    this.props = [] // { level, obj, prints: [[x, z, r], ...] }
    this.lotMarks = new Map() // lot index → 木樁
    this._buildStreets()
    this._buildProps()
    this._loadPaving()
    world.add((dt, t) => this.update(dt, t))
  }

  _loadPaving() {
    if (typeof document === 'undefined') return
    new THREE.TextureLoader().load(PAVING, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.anisotropy = 4
      // 貼圖是偏冷的淺灰石板，乘上暖色和島上的粉彩調和
      this.paveMat.map = tex
      this.paveMat.color.set('#ffffff')
      this.paveMat.needsUpdate = true
    })
  }

  _buildStreets() {
    for (let lv = 1; lv <= MAX_TOWN_LEVEL; lv++) {
      const pave = []
      const curb = []
      if (lv === PLAN.plaza.level) {
        pushPlaza(pave, PLAN.plaza.r, STREET_Y)
        pushPlaza(curb, PLAN.plaza.r + CURB, STREET_Y - 0.004)
      }
      for (const s of PLAN.streets) {
        if (s.level !== lv) continue
        pushStreet(pave, s.points, s.width, STREET_Y)
        pushStreet(curb, s.points, s.width + CURB * 2, STREET_Y - 0.004)
      }
      const make = (pos, m) => {
        const o = new THREE.Mesh(groundGeo(pos), m)
        o.receiveShadow = true
        o.visible = false
        this.group.add(o)
        return o
      }
      this.streets.push({ pave: make(pave, this.paveMat), curb: make(curb, this.curbMat) })
    }
  }

  _buildProps() {
    PLAN.props.forEach((p, i) => {
      const build = { lamp: () => lamp(this), tree: () => tree(this, 31 + i), bench, planter: () => planter(17 + i), sign: () => sign(this), fountain: () => fountain(this), gate: () => gate(this) }[p.type]
      if (!build) return
      const obj = build()
      obj.position.set(p.x, 0, p.z)
      obj.rotation.y = p.rot
      obj.visible = false
      obj.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = !o.userData.noShadow
          o.receiveShadow = true
        }
      })
      this.group.add(obj)
      this.props.push({ level: p.level, obj, prints: propPrints(p) })
    })
  }

  // 夜晚的光暈（測試環境沒有 canvas，就不加）
  halo(g, y, s, x = 0, z = 0) {
    if (typeof document === 'undefined') return
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd59a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
    sp.position.set(x, y, z)
    sp.scale.setScalar(s)
    g.add(sp)
    this.halos.push(sp)
  }

  // 鋪到 level 級；animate：新開的街一段段鋪出來、小物一個個冒出來（回傳全部演完的秒數）
  setLevel(level, animate = false) {
    level = Math.min(Math.max(level, 1), MAX_TOWN_LEVEL)
    const from = this.level
    this.level = level
    for (let lv = 1; lv <= MAX_TOWN_LEVEL; lv++) {
      const { pave, curb } = this.streets[lv - 1]
      const show = lv <= level
      pave.visible = curb.visible = show
      const total = pave.geometry.attributes.position.count
      const totalC = curb.geometry.attributes.position.count
      pave.geometry.setDrawRange(0, Infinity)
      curb.geometry.setDrawRange(0, Infinity)
      if (show && animate && lv > from) {
        const tri = (n, k) => Math.floor((n / 3) * k) * 3
        tween(1.8, (k) => {
          pave.geometry.setDrawRange(0, tri(total, k))
          curb.geometry.setDrawRange(0, tri(totalC, k))
        }, { easing: ease.inOutCubic, delay: (lv - from - 1) * 1.8 })
        pave.geometry.setDrawRange(0, 0)
        curb.geometry.setDrawRange(0, 0)
      }
    }
    let t = 0
    for (const p of this.props) {
      const show = p.level <= level
      p.obj.visible = show
      p.obj.scale.setScalar(1)
      if (show && animate && p.level > from) {
        const delay = 1.2 + t * 0.35 + (p.level - from - 1) * 1.8
        t++
        p.obj.scale.setScalar(0.001)
        tween(0.6, (k) => p.obj.scale.setScalar(Math.max(0.001, k)), { easing: ease.outBack, delay })
      }
    }
    return animate && level > from ? 1.2 + t * 0.35 + 0.6 : 0
  }

  // used：有房子的地；已開放但空著的地插木樁
  setLots(used, level = this.level) {
    const open = lotsAt(level)
    PLAN.lots.forEach((lot, i) => {
      const want = i < open && !used.has(i)
      const cur = this.lotMarks.get(i)
      if (want && !cur) {
        const g = stakes(lot)
        this.group.add(g)
        this.lotMarks.set(i, g)
      } else if (!want && cur) {
        this.group.remove(cur)
        cur.traverse((o) => o.geometry?.dispose())
        this.lotMarks.delete(i)
      }
    })
  }

  // from 級之後到 level 級新開的地（from 0：到 level 級為止全部的地），鏡頭要框住的範圍
  view(level, from = level - 1) {
    const lots = PLAN.lots.slice(from > 0 ? lotsAt(from) : 0, lotsAt(level))
    const c = new THREE.Vector3()
    for (const l of lots) c.add(new THREE.Vector3(l.x, 0, l.z))
    c.divideScalar(lots.length || 1)
    let r = 2
    for (const l of lots) r = Math.max(r, Math.hypot(l.x - c.x, l.z - c.z) + l.size * 0.7)
    return { target: c, radius: r }
  }

  // 小物的佔地 [x, z, r]（只算已經冒出來的）
  footprints() {
    return this.props.filter((p) => p.level <= this.level).flatMap((p) => p.prints)
  }

  blocked(x, z, pad = 0) {
    return this.props.some((p) => p.level <= this.level && p.prints.some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r + pad))
  }

  update(dt, t) {
    const night = this.sky.night
    this.glowMat.emissiveIntensity = 0.3 + night * 2.4 + Math.sin(t * 2.1) * 0.05 * night
    for (const h of this.halos) h.material.opacity = night * 0.55
    for (const s of this.spray) {
      s.scale.y = 1 + Math.sin(t * 6) * 0.08
      s.material.opacity = 0.45 + Math.sin(t * 4.3) * 0.08
    }
  }
}
