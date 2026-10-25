import * as THREE from 'three'
import { mat, rng, shadowed, tween, ease } from './util.js'
import { LAYOUT } from './island.js'
import { UNLOCKS } from '../theme.js'
import { SEASONS } from './season.js'

// 依等級解鎖的島嶼裝飾
const VERMILION = '#ef8e83'
const DARK = '#5d5866'
const WOOD = '#a88676'

function sakuraTree(seed, scale = 1) {
  const r = rng(seed)
  const g = new THREE.Group()
  const trunkMat = mat('#9d7b70')
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.3, 2.3, 7), trunkMat)
  trunk.position.y = 1.15
  trunk.rotation.z = 0.06
  g.add(trunk)
  const branches = [
    [0.55, 1.9, 0.1, -0.8],
    [-0.5, 2.0, -0.2, 0.75],
    [0.05, 2.1, 0.5, 0.2],
  ]
  for (const [x, y, z, rz] of branches) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 1.1, 5), trunkMat)
    b.position.set(x * 0.6, y, z * 0.6)
    b.rotation.set(z * 0.8, 0, rz)
    g.add(b)
  }
  const pinks = SEASONS.spring.canopy
  const canopyMats = pinks.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, flatShading: true, emissive: '#ffd6e2', emissiveIntensity: 0.12 }))
  const blob = new THREE.IcosahedronGeometry(1, 1)
  const puffs = [
    [0, 2.9, 0, 1.25], [1.0, 2.6, 0.2, 0.95], [-1.0, 2.65, -0.1, 1.0], [0.3, 2.5, 0.9, 0.85],
    [-0.4, 2.55, -0.85, 0.9], [0.6, 3.35, -0.3, 0.8], [-0.55, 3.3, 0.35, 0.8], [1.35, 2.25, -0.6, 0.6], [-1.3, 2.2, 0.7, 0.62],
  ]
  for (const [x, y, z, s] of puffs) {
    const m = new THREE.Mesh(blob, canopyMats[Math.floor(r() * pinks.length)])
    m.position.set(x, y, z)
    m.scale.setScalar(s * (0.9 + r() * 0.2))
    m.rotation.set(r() * 3, r() * 3, r() * 3)
    g.add(m)
  }
  // 樹下落花
  const fallenMat = new THREE.MeshStandardMaterial({ color: '#f8c3d1', roughness: 0.82, side: THREE.DoubleSide })
  const petals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.06, 5), fallenMat, 40)
  const o = new THREE.Object3D()
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2
    const d = 0.4 + r() * 1.6
    o.position.set(Math.cos(a) * d, 0.02, Math.sin(a) * d)
    o.rotation.set(-Math.PI / 2, 0, r() * 3)
    o.updateMatrix()
    petals.setMatrixAt(i, o.matrix)
  }
  g.add(petals)
  g.scale.setScalar(scale)
  g.userData.seasonal = { canopyMats, fallenMat }
  g.userData.ownedMaterials = [...canopyMats, fallenMat]
  return shadowed(g)
}

function stoneLantern() {
  const g = new THREE.Group()
  const stone = mat('#e4e0e6')
  const add = (geo, y, m = stone) => {
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.y = y
    g.add(mesh)
    return mesh
  }
  add(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 6), 0.09)
  add(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 8), 0.58)
  add(new THREE.CylinderGeometry(0.36, 0.3, 0.14, 6), 1.04)
  const glow = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffcf8a', emissiveIntensity: 0.4, roughness: 0.6 })
  const box = add(new THREE.CylinderGeometry(0.24, 0.24, 0.34, 6), 1.28, glow)
  add(new THREE.ConeGeometry(0.55, 0.36, 6), 1.62)
  add(new THREE.SphereGeometry(0.08, 8, 6), 1.84)
  const light = new THREE.PointLight('#ffcf94', 0, 6, 1.6)
  light.position.y = 1.3
  g.add(light)
  g.userData.glow = { mats: [glow], lights: [light], base: 0.4 }
  g.userData.ownedMaterials = [glow]
  return shadowed(g)
}

function torii() {
  const g = new THREE.Group()
  const red = mat(VERMILION)
  for (const x of [-1.0, 1.0]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.3, 10), red)
    p.position.set(x, 1.15, 0)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 10), mat(DARK))
    foot.position.set(x, 0.07, 0)
    g.add(p, foot)
  }
  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, 0.3), mat(DARK))
  kasagi.position.y = 2.42
  const shimaki = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.26), red)
  shimaki.position.y = 2.28
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.11, 0.14), red)
  nuki.position.y = 1.78
  const gakuzuka = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.12), red)
  gakuzuka.position.y = 2.02
  // 翹起的兩端
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), mat(DARK))
    tip.position.set(s * 1.45, 2.47, 0)
    tip.rotation.z = s * 0.25
    g.add(tip)
  }
  g.add(kasagi, shimaki, nuki, gakuzuka)
  return shadowed(g)
}

function bridge() {
  const g = new THREE.Group()
  const { pond } = LAYOUT
  const len = pond.r * 2 + 1.2
  const n = 11
  const plank = new THREE.BoxGeometry(len / n + 0.02, 0.07, 0.8)
  const arch = (t) => Math.sin(t * Math.PI) * 0.62
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const m = new THREE.Mesh(plank, mat(i % 2 ? '#ead8c4' : '#e3cfba'))
    const x = -len / 2 + t * len
    m.position.set(x, 0.12 + arch(t), 0)
    m.rotation.z = -Math.cos(t * Math.PI) * 0.55
    g.add(m)
  }
  const red = mat(VERMILION)
  for (const z of [-0.38, 0.38]) {
    const pts = []
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      pts.push(new THREE.Vector3(-len / 2 + t * len * 1, 0.55 + arch(t), z))
    }
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.035, 6), red)
    g.add(rail)
    for (let i = 1; i < 6; i++) {
      const t = i / 6
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6), red)
      post.position.set(-len / 2 + t * len, 0.33 + arch(t), z)
      g.add(post)
      if (i === 1 || i === 5) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mat('#f3d27a'))
        cap.position.set(post.position.x, post.position.y + 0.26, z)
        g.add(cap)
      }
    }
  }
  g.position.set(pond.x, 0, pond.z)
  g.rotation.y = 0.35
  return shadowed(g)
}

function hydrangeas() {
  const g = new THREE.Group()
  const r = rng(77)
  const spots = [[-5.5, 5.6], [-1.3, 2.7], [1.5, 8.0], [-8.0, 0.2], [8.1, 1.4], [-4.6, -0.6], [5.4, 6.9]]
  const tones = ['#9bb8ec', '#b8a5e8', '#a7d1f2', '#f2b9d7', '#c8b4ef']
  const ball = new THREE.IcosahedronGeometry(0.26, 1)
  for (const [x, z] of spots) {
    const bush = new THREE.Group()
    const base = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), mat('#94cf95'))
    base.scale.set(1.2, 0.55, 1)
    base.position.y = 0.22
    bush.add(base)
    const tone = tones[Math.floor(r() * tones.length)]
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(ball, mat(i % 3 ? tone : '#e6ecfb', { emissive: tone, emissiveIntensity: 0.1 }))
      const a = (i / 6) * Math.PI * 2
      m.position.set(Math.cos(a) * 0.36, 0.42 + r() * 0.2, Math.sin(a) * 0.3)
      m.scale.setScalar(0.85 + r() * 0.4)
      bush.add(m)
    }
    bush.position.set(x, 0, z)
    bush.rotation.y = r() * 3
    g.add(bush)
  }
  return shadowed(g)
}

function shrine() {
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 1.1), mat('#e4e0e6'))
  base.position.y = 0.1
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.72, 0.66), mat('#e9d6c2'))
  body.position.y = 0.56
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.48), mat(WOOD))
  door.position.set(0, 0.52, 0.335)
  // 山形屋頂
  const shape = new THREE.Shape()
  shape.moveTo(-0.72, 0)
  shape.lineTo(0, 0.52)
  shape.lineTo(0.72, 0)
  shape.lineTo(-0.72, 0)
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false })
  roofGeo.translate(0, 0, -0.5)
  const roof = new THREE.Mesh(roofGeo, mat('#7f8fb0'))
  roof.position.y = 0.92
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 6, 16, Math.PI), mat('#f3e3b5'))
  rope.position.set(0, 0.86, 0.36)
  rope.rotation.z = Math.PI
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat('#f3d27a', { metalness: 0.4, roughness: 0.4 }))
  bell.position.set(0, 0.72, 0.4)
  g.add(base, body, door, roof, rope, bell)
  // 兩隻小狐（白）
  for (const s of [-1, 1]) {
    const fox = new THREE.Group()
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), mat('#ffffff'))
    b.position.y = 0.15
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat('#ffffff'))
    head.position.y = 0.34
    const ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), mat('#f6b4c4'))
    ear1.position.set(0.045, 0.43, 0)
    const ear2 = ear1.clone()
    ear2.position.x = -0.045
    fox.add(b, head, ear1, ear2)
    fox.position.set(s * 0.82, 0.2, 0.55)
    g.add(fox)
  }
  g.rotation.y = 0.6
  return shadowed(g)
}

function chochin() {
  const g = new THREE.Group()
  const r = rng(31)
  const mats = []
  const items = []
  for (let i = 0; i < 8; i++) {
    const m = new THREE.MeshStandardMaterial({ color: '#fff1dc', emissive: i % 3 ? '#ffc98c' : '#ffb3c4', emissiveIntensity: 0.4, roughness: 0.7 })
    mats.push(m)
    const lan = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), m)
    body.scale.set(1, 1.3, 1)
    const capT = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.06, 10), mat(DARK))
    capT.position.y = 0.29
    const capB = capT.clone()
    capB.position.y = -0.29
    lan.add(body, capT, capB)
    const a = (i / 8) * Math.PI * 2 + r() * 0.4
    const d = 3 + r() * 5
    lan.position.set(Math.cos(a) * d, 3.6 + r() * 2.4, Math.sin(a) * d)
    lan.userData = { y: lan.position.y, ph: r() * 6 }
    items.push(lan)
    g.add(lan)
  }
  g.userData.glow = { mats, lights: [], base: 0.4 }
  g.userData.ownedMaterials = mats
  g.userData.float = items
  return g
}

function lilies() {
  const g = new THREE.Group()
  const { pond } = LAYOUT
  const r = rng(55)
  const pad = new THREE.CircleGeometry(0.26, 14, 0.3, Math.PI * 2 - 0.6)
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2
    const d = 0.5 + r() * (pond.r - 0.8)
    const m = new THREE.Mesh(pad, mat('#8fcf8c', { side: THREE.DoubleSide }))
    m.rotation.set(-Math.PI / 2, 0, r() * 6)
    m.position.set(pond.x + Math.cos(a) * d, 0.1, pond.z + Math.sin(a) * d)
    m.scale.setScalar(0.8 + r() * 0.5)
    g.add(m)
    if (i % 2 === 0) {
      const lotus = new THREE.Group()
      for (let k = 0; k < 6; k++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), mat('#fbd0dd', { emissive: '#ffd6e2', emissiveIntensity: 0.2 }))
        p.scale.set(0.6, 1.4, 0.6)
        const aa = (k / 6) * Math.PI * 2
        p.position.set(Math.cos(aa) * 0.06, 0.08, Math.sin(aa) * 0.06)
        p.rotation.set(Math.sin(aa) * 0.5, 0, -Math.cos(aa) * 0.5)
        lotus.add(p)
      }
      lotus.position.copy(m.position)
      g.add(lotus)
    }
  }
  return g
}

function islet() {
  const g = new THREE.Group()
  const rock = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3, 8, 2), mat('#e3cbd6'))
  rock.rotation.x = Math.PI
  rock.position.y = -1.6
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.5, 0.3, 10), mat('#c5e6b4'))
  top.position.y = -0.15
  g.add(rock, top)
  const tree = sakuraTree(99, 0.45)
  tree.position.set(-0.4, 0, -0.2)
  g.add(tree)
  g.userData.seasonal = tree.userData.seasonal
  const t = torii()
  t.scale.setScalar(0.32)
  t.position.set(0.6, 0, 0.6)
  t.rotation.y = -0.6
  g.add(t)
  // 小瀑布
  const fall = new THREE.Mesh(
    new THREE.PlaneGeometry(0.35, 3.2),
    new THREE.MeshStandardMaterial({ color: '#d9f2fb', transparent: true, opacity: 0.6, emissive: '#bfe9f7', emissiveIntensity: 0.3, side: THREE.DoubleSide }),
  )
  fall.position.set(0, -1.75, 1.42)
  g.add(fall)
  g.position.set(13.5, 4.5, -10)
  g.userData.orbit = true
  g.userData.ownedMaterials = [fall.material, ...tree.userData.ownedMaterials]
  return shadowed(g)
}

const at = (obj, x, z) => {
  obj.position.set(x, 0, z)
  return obj
}
const BUILDERS = {
  sakura: () => at(sakuraTree(1, 1.05), -6.0, 1.9),
  lantern: () => at(stoneLantern(), -1.5, 5.6),
  torii: () => at(torii(), 0, 7.4),
  bridge,
  hydrangea: hydrangeas,
  sakura2: () => at(sakuraTree(2, 0.85), 6.9, 4.6),
  shrine: () => at(shrine(), -7.0, -4.2),
  chochin,
  lilies,
  islet,
}
// 這些是「一群」散在島上的物件，彈出動畫要逐一套用在子物件上
const COLLECTIONS = new Set(['hydrangea', 'chochin', 'lilies'])

export class Decor {
  constructor(world, sky) {
    this.world = world
    this.sky = sky
    this.group = new THREE.Group()
    world.scene.add(this.group)
    this.items = {}
    world.add((dt, t) => this.update(dt, t))
  }

  setSeason(key) {
    this.season = key
    for (const o of Object.values(this.items)) this._applySeason(o)
  }
  _applySeason(o) {
    const sea = o.userData.seasonal
    if (!sea || !this.season) return
    const s = SEASONS[this.season]
    sea.canopyMats.forEach((m, i) => {
      m.color.set(s.canopy[i % s.canopy.length])
      m.emissive.set(s.glow)
    })
    sea.fallenMat.color.set(s.fallen)
  }

  // 依等級同步；animate=true 時新物件以彈出動畫出現
  sync(level, animate = false) {
    const spawned = []
    for (const u of UNLOCKS) {
      const want = level >= u.level
      const have = this.items[u.key]
      if (want && !have) {
        const obj = BUILDERS[u.key]()
        this.group.add(obj)
        this.items[u.key] = obj
        this._applySeason(obj)
        if (animate) {
          const targets = COLLECTIONS.has(u.key) ? obj.children : [obj]
          targets.forEach((o, i) => {
            const s0 = o.scale.clone()
            o.scale.setScalar(0.001)
            tween(1.1, (k) => o.scale.copy(s0).multiplyScalar(Math.max(0.001, k)), { easing: ease.outBack, delay: 0.3 + i * 0.08 })
          })
          spawned.push(obj)
        }
      } else if (!want && have) {
        const geometries = new Set()
        have.traverse((o) => {
          if (o.geometry) geometries.add(o.geometry)
          if (o.isInstancedMesh) o.dispose()
        })
        for (const g of geometries) g.dispose()
        for (const m of have.userData.ownedMaterials ?? []) m.dispose()
        this.group.remove(have)
        delete this.items[u.key]
      }
    }
    return spawned
  }

  anchor(key) {
    const o = this.items[key]
    return o ? o.getWorldPosition(new THREE.Vector3()) : null
  }

  update(dt, t) {
    const night = this.sky.night
    for (const o of Object.values(this.items)) {
      const glow = o.userData.glow
      if (glow) {
        for (const m of glow.mats) m.emissiveIntensity = glow.base + night * 2.6 + Math.sin(t * 2.3) * 0.05 * night
        for (const l of glow.lights) l.intensity = night * 4
      }
      if (o.userData.float) {
        for (const lan of o.userData.float) {
          lan.position.y = lan.userData.y + Math.sin(t * 0.7 + lan.userData.ph) * 0.25
          lan.rotation.y += dt * 0.2
        }
      }
      if (o.userData.orbit) {
        const a = t * 0.025 + 0.6
        o.position.set(Math.cos(a) * 16, 4.5 + Math.sin(t * 0.4) * 0.4, Math.sin(a) * -16)
      }
    }
  }
}
