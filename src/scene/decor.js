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

// 擴建共用的小零件與地面留白檢查
function piece(g, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material)
  m.position.set(x, y, z)
  g.add(m)
  return m
}

function limb(g, from, to, radius, material) {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const m = piece(g, new THREE.CylinderGeometry(radius * 0.65, radius, a.distanceTo(b), 6), material)
  m.position.copy(a).add(b).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize())
  return m
}

function openGround(x, z, pad = 0, avoidDecor = false) {
  const { radius, pond, bed, home, slots, decor } = LAYOUT
  if (Math.hypot(x, z) > radius - pad) return false
  if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 0.5 + pad) return false
  if (Math.hypot(x - bed.x, z - bed.z) < bed.r + 0.3 + pad) return false
  if (Math.hypot(x - home.x, z - home.z) < 1.2 + pad) return false
  if (Math.abs(x) < 0.9 + pad && z > 1.8 - pad) return false
  if (slots.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 1.35 + pad)) return false
  if (avoidDecor && decor.some(([dx, dz]) => Math.hypot(x - dx, z - dz) < 1.1 + pad)) return false
  return true
}

function sakuraGrow() {
  const g = new THREE.Group()
  const r = rng(1212)
  const canopyMats = SEASONS.spring.canopy.map((color) => new THREE.MeshStandardMaterial({
    color, roughness: 0.82, flatShading: true, emissive: SEASONS.spring.glow, emissiveIntensity: 0.12,
  }))
  const puffs = [
    [-0.2, 4.05, -0.15, 1.1], [-1.45, 3.45, -0.1, 1.08], [1.1, 3.5, -1.0, 0.78],
    [-0.7, 3.3, 1.3, 0.95], [0.1, 3.45, -0.65, 0.75], [-1.7, 2.95, 0.5, 0.7],
    [1.8, 3.0, -1.1, 0.7], [-0.65, 4.25, 0.55, 0.8], [0.7, 4.2, -0.55, 0.8],
  ]
  const blob = new THREE.IcosahedronGeometry(1, 1)
  puffs.forEach(([x, y, z, s], i) => {
    const m = piece(g, blob, canopyMats[i % canopyMats.length], x, y, z)
    m.scale.setScalar(s)
    m.rotation.set(r() * 3, r() * 3, r() * 3)
  })
  for (const end of [[-1.6, 3.5, 0.25], [1.5, 3.6, -0.2], [-0.3, 4.1, 0.9]]) {
    limb(g, [0, 1.95, 0], end, 0.12, mat('#9d7b70'))
  }
  const fallenMat = new THREE.MeshStandardMaterial({ color: SEASONS.spring.fallen, roughness: 0.82, side: THREE.DoubleSide })
  const spots = []
  for (let i = 0; i < 100; i++) {
    const a = r() * Math.PI * 2
    const d = 1.8 + r() * 0.65
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (openGround(-6 + x * 1.05, 1.9 + z * 1.05, 0.08)) spots.push([x, z])
  }
  const petals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.055, 5), fallenMat, spots.length)
  const o = new THREE.Object3D()
  spots.forEach(([x, z], i) => {
    o.position.set(x, 0.025, z)
    o.rotation.set(-Math.PI / 2, 0, r() * 6)
    o.updateMatrix()
    petals.setMatrixAt(i, o.matrix)
  })
  g.add(petals)
  g.scale.setScalar(1.05)
  g.userData.seasonal = { canopyMats, fallenMat }
  g.userData.ownedMaterials = [...canopyMats, fallenMat]
  return shadowed(at(g, -6, 1.9))
}

function waterfall() {
  const g = new THREE.Group()
  const creek = new THREE.Group()
  creek.name = '島上溪流'
  const water = new THREE.MeshStandardMaterial({
    color: '#bfe9f7', transparent: true, opacity: 0.57, roughness: 0.2, flatShading: true,
    emissive: '#a9e2f5', emissiveIntensity: 0.2, side: THREE.DoubleSide, depthWrite: false,
  })
  // 從繡球花北側繞往島緣，最後一段跨過草地與外緣
  const course = [[8.25, 0.42], [8.65, 0.55], [9.1, 0.72], [9.7, 0.94]]
  const vertices = []
  course.forEach(([x, z], i) => {
    const before = course[Math.max(0, i - 1)]
    const after = course[Math.min(course.length - 1, i + 1)]
    const dx = after[0] - before[0]
    const dz = after[1] - before[1]
    const d = Math.hypot(dx, dz)
    for (const side of [-1, 1]) vertices.push(x - 8.3 - side * dz / d * 0.17, 0.055 - i * 0.008, z - 1.2 + side * dx / d * 0.17)
  })
  const ribbon = new THREE.BufferGeometry()
  ribbon.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  ribbon.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6, 5, 7, 6])
  ribbon.computeVertexNormals()
  piece(creek, ribbon, water)
  g.add(creek)
  const owned = [water]
  const fallMats = []
  for (let i = 0; i < 7; i++) {
    const m = water.clone()
    m.opacity = 0.53 * (1 - i / 7) ** 1.1
    fallMats.push(m)
    owned.push(m)
    const sheet = piece(g, new THREE.PlaneGeometry(0.52 + i * 0.045, 1.02), m, 1.45 + i * 0.045, -0.48 - i * 0.95, -0.22)
    sheet.rotation.y = -0.65
  }
  const foam = new THREE.MeshBasicMaterial({ color: '#effaff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
  owned.push(foam)
  const ripples = []
  for (let i = 0; i < 3; i++) {
    const m = piece(creek, new THREE.PlaneGeometry(0.045, 0.22), foam)
    m.rotation.set(-Math.PI / 2, 0, -0.35)
    ripples.push(m)
  }
  const streaks = []
  for (let i = 0; i < 9; i++) {
    const m = foam.clone()
    owned.push(m)
    const streak = piece(g, new THREE.PlaneGeometry(0.035 + i % 3 * 0.012, 0.35 + i % 4 * 0.15), m)
    streak.rotation.y = -0.65
    streaks.push(streak)
  }
  const mistMat = new THREE.MeshStandardMaterial({ color: '#eaf7ff', transparent: true, opacity: 0.17, roughness: 1, flatShading: true, depthWrite: false })
  owned.push(mistMat)
  const mist = []
  const puff = new THREE.IcosahedronGeometry(1, 1)
  for (let i = 0; i < 7; i++) {
    const m = piece(g, puff, mistMat, 1.8 + Math.cos(i * 2.4) * 0.6, -6.6 + i % 3 * 0.14, -0.2 + Math.sin(i * 2.4) * 0.5)
    mist.push(m)
  }
  g.userData.ownedMaterials = owned
  g.userData.anim = (t) => {
    ripples.forEach((m, i) => {
      const u = (t * 0.35 + i / 3) % 1
      m.position.set(-0.05 + u * 1.45, 0.065 - u * 0.024, -0.78 + u * 0.52)
    })
    streaks.forEach((m, i) => {
      const u = (t * 0.43 + i / 9) % 1
      m.position.set(1.43 + u * 0.31 + Math.sin(i * 2.4) * 0.13, -0.1 - u * 6.4, -0.2 + Math.sin(i * 2.4) * 0.1)
      m.material.opacity = 0.48 * Math.sin(u * Math.PI) * (1 - u * 0.8)
    })
    mist.forEach((m, i) => {
      m.scale.set(0.55 + Math.sin(t * 0.7 + i) * 0.08, 0.25 + Math.sin(t * 0.6 + i) * 0.04, 0.45)
      m.position.y = -6.6 + i % 3 * 0.14 + Math.sin(t * 0.8 + i) * 0.1
    })
    fallMats.forEach((m, i) => { m.opacity = 0.53 * (1 - i / 7) ** 1.1 * (0.95 + Math.sin(t * 3 - i) * 0.05) })
  }
  at(g, 8.3, 1.2)
  g.userData.anim(0)
  return g
}

function bonbori() {
  const g = new THREE.Group()
  const paper = new THREE.MeshStandardMaterial({ color: '#fff7ed', emissive: '#ffd39a', emissiveIntensity: 0.25, roughness: 0.75, flatShading: true })
  const shade = new THREE.CylinderGeometry(0.23, 0.27, 0.4, 6)
  const cap = new THREE.ConeGeometry(0.34, 0.18, 6)
  for (const a of [1.85, 2.45, 3.05, 3.65, 5.15, 5.75]) {
    const x = -6 + Math.cos(a) * 2.2
    const z = 1.9 + Math.sin(a) * 2.2
    if (!openGround(x, z, 0.34, true)) continue
    const lan = new THREE.Group()
    piece(lan, new THREE.CylinderGeometry(0.2, 0.23, 0.08, 6), mat('#e4e0e6'), 0, 0.04)
    piece(lan, new THREE.CylinderGeometry(0.035, 0.045, 1.0, 6), mat(WOOD), 0, 0.54)
    piece(lan, shade, paper, 0, 1.22)
    piece(lan, cap, mat(VERMILION), 0, 1.51)
    piece(lan, new THREE.CylinderGeometry(0.28, 0.28, 0.055, 6), mat(WOOD), 0, 1.0)
    for (let j = 0; j < 6; j++) {
      const aa = j / 6 * Math.PI * 2
      piece(lan, new THREE.CylinderGeometry(0.012, 0.012, 0.4, 4), mat(WOOD), Math.sin(aa) * 0.25, 1.22, Math.cos(aa) * 0.25)
    }
    g.add(shadowed(at(lan, x, z)))
  }
  const light = new THREE.PointLight('#ffd5a4', 0, 7, 1.8)
  light.position.set(-6, 1.8, 1.9)
  g.add(light)
  g.userData.glow = { mats: [paper], lights: [light], base: 0.25 }
  g.userData.ownedMaterials = [paper]
  return g
}

function teahouse() {
  const g = new THREE.Group()
  const rock = piece(g, new THREE.ConeGeometry(2.3, 4.4, 9, 2), mat('#e1cddd'), 0, -2.35)
  rock.rotation.x = Math.PI
  piece(g, new THREE.CylinderGeometry(2.35, 2.3, 0.3, 12), mat('#c5e6b4'), 0, -0.15)
  piece(g, new THREE.BoxGeometry(1.7, 0.12, 1.4), mat('#d9bd9e'), -0.55, 0.06, -0.55)
  piece(g, new THREE.BoxGeometry(1.55, 1.25, 1.22), mat('#ead7c0'), -0.55, 0.72, -0.55)
  piece(g, new THREE.PlaneGeometry(0.95, 1.02), mat('#716971'), -0.55, 0.64, 0.067)
  for (const x of [-1.3, 0.2]) {
    for (const z of [-1.15, 0.09]) piece(g, new THREE.BoxGeometry(0.09, 1.45, 0.09), mat(WOOD), x, 0.77, z)
  }
  for (const side of [-1, 1]) {
    const roof = piece(g, new THREE.BoxGeometry(1.17, 0.13, 1.7), mat('#8d9caa'), -0.55 + side * 0.5, 1.64, -0.55)
    roof.rotation.z = -side * 0.4
  }
  piece(g, new THREE.BoxGeometry(1.15, 0.07, 0.07), mat(WOOD), -0.55, 1.31, 0.16)
  for (let i = 0; i < 3; i++) piece(g, new THREE.BoxGeometry(0.34, 0.45, 0.025), mat(i === 1 ? '#f5c1cf' : '#a5cfc5'), -0.92 + i * 0.37, 1.07, 0.17)
  // 野點傘與紅毛氈長椅
  piece(g, new THREE.CylinderGeometry(0.035, 0.045, 2.1, 6), mat(WOOD), 1.0, 1.05, 0.35)
  piece(g, new THREE.ConeGeometry(0.95, 0.38, 10), mat(VERMILION), 1.0, 2.12, 0.35)
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2
    limb(g, [1, 2.32, 0.35], [1 + Math.cos(a) * 0.94, 1.94, 0.35 + Math.sin(a) * 0.94], 0.012, mat('#f3d6ba'))
  }
  piece(g, new THREE.BoxGeometry(2.0, 0.12, 0.52), mat(VERMILION), 0, 0.43, 1.23)
  for (const x of [-0.76, 0.76]) for (const z of [1.05, 1.42]) piece(g, new THREE.BoxGeometry(0.08, 0.38, 0.08), mat(WOOD), x, 0.19, z)
  const glow = new THREE.MeshStandardMaterial({ color: '#fff0d6', emissive: '#ffd099', emissiveIntensity: 0.3, roughness: 0.7, flatShading: true })
  piece(g, new THREE.CylinderGeometry(0.04, 0.06, 1.1, 6), mat(WOOD), -1.65, 0.55, 0.65)
  piece(g, new THREE.CylinderGeometry(0.18, 0.2, 0.34, 6), glow, -1.65, 1.18, 0.65)
  piece(g, new THREE.ConeGeometry(0.28, 0.18, 6), mat(VERMILION), -1.65, 1.44, 0.65)
  g.position.set(-15, 3.2, -9)
  g.userData.glow = { mats: [glow], lights: [], base: 0.3 }
  g.userData.ownedMaterials = [glow]
  g.userData.anim = (t) => { g.position.y = 3.2 + Math.sin(t * 0.32) * 0.25 }
  return shadowed(g)
}

function shrineUp() {
  const g = new THREE.Group()
  const stone = mat('#e4e0e6')
  const wood = mat(WOOD)
  // 沿原小祠的局部 +z 方向鋪設短參道
  for (let i = 0; i < 4; i++) piece(g, new THREE.BoxGeometry(0.64, 0.08, 0.28), stone, 0.18, 0.05 + (3 - i) * 0.055, 0.73 + i * 0.28)
  for (let i = 0; i < 3; i++) {
    const gate = torii()
    gate.scale.setScalar(0.4 - i * 0.065)
    gate.position.set(0.18, 0.12, 0.88 + i * 0.435)
    g.add(gate)
  }
  piece(g, new THREE.BoxGeometry(1.05, 1.4, 0.7), mat('#e9d6c2'), 0, 0.9, -0.48)
  const shape = new THREE.Shape()
  shape.moveTo(-0.82, 0)
  shape.lineTo(0, 0.6)
  shape.lineTo(0.82, 0)
  shape.closePath()
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: false })
  roofGeo.translate(0, 0, -0.55)
  piece(g, roofGeo, mat('#7f8fb0'), 0, 1.65, -0.4)
  piece(g, new THREE.BoxGeometry(0.12, 0.12, 1.2), mat('#aab7cf'), 0, 2.25, -0.4)
  for (const x of [-0.56, 0.56]) piece(g, new THREE.CylinderGeometry(0.045, 0.055, 1.15, 6), wood, x, 0.77, 0.57)
  const rope = piece(g, new THREE.TorusGeometry(0.49, 0.055, 6, 18, Math.PI), mat('#f3e3b5'), 0, 1.36, 0.6)
  rope.rotation.z = Math.PI
  for (const x of [-0.32, 0, 0.32]) {
    const paper = piece(g, new THREE.PlaneGeometry(0.1, 0.22), mat('#fff9ed', { side: THREE.DoubleSide }), x, 0.99, 0.63)
    paper.rotation.z = x > 0 ? -0.22 : 0.22
  }
  piece(g, new THREE.BoxGeometry(0.62, 0.32, 0.38), wood, 0.18, 0.41, 0.87)
  piece(g, new THREE.BoxGeometry(0.67, 0.06, 0.42), mat('#cba98c'), 0.18, 0.6, 0.87)
  for (let i = 0; i < 5; i++) piece(g, new THREE.BoxGeometry(0.54, 0.012, 0.018), mat(DARK), 0.18, 0.638, 0.72 + i * 0.075)
  g.rotation.y = 0.6
  return shadowed(at(g, -7, -4.2))
}

function cranes() {
  const g = new THREE.Group()
  const birds = []
  const wingGeo = new THREE.BufferGeometry()
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.14, 0.48, 0.18, 0.02, 1.03, 0.02, 0.32, 0.3, -0.04, 0.24,
  ], 3))
  wingGeo.setIndex([0, 1, 2, 0, 2, 3])
  wingGeo.computeVertexNormals()
  const colors = ['#fffaf3', '#f5c6d7', '#bedff3', '#f8e6ac']
  for (let i = 0; i < 7; i++) {
    const bird = new THREE.Group()
    const paper = mat(colors[i % colors.length], { side: THREE.DoubleSide })
    const body = piece(bird, new THREE.OctahedronGeometry(0.25), paper)
    body.scale.set(0.7, 0.55, 1.4)
    limb(bird, [0, 0, 0.2], [0, 0.42, 0.45], 0.065, paper)
    const beak = piece(bird, new THREE.ConeGeometry(0.065, 0.25, 3), paper, 0, 0.38, 0.55)
    beak.rotation.x = Math.PI * 0.7
    const tail = piece(bird, new THREE.ConeGeometry(0.09, 0.48, 3), paper, 0, 0.13, -0.42)
    tail.rotation.x = -0.95
    const wings = []
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group()
      const wing = piece(pivot, wingGeo, paper)
      wing.scale.x = side
      pivot.position.x = side * 0.06
      bird.add(pivot)
      wings.push(pivot)
    }
    bird.scale.setScalar(0.65 + i % 3 * 0.08)
    birds.push({ bird, wings, phase: i / 7 * Math.PI * 2, radius: 10.4 + i % 4 * 0.7 })
    g.add(bird)
  }
  g.userData.anim = (t) => {
    birds.forEach(({ bird, wings, phase, radius }, i) => {
      const a = t * 0.1 + phase
      bird.position.set(Math.cos(a) * radius, 10 + Math.sin(t * 0.65 + phase) * 0.7, Math.sin(a) * radius)
      bird.rotation.set(0.04 * Math.sin(t + phase), -a, 0.08 * Math.sin(t * 0.7 + phase))
      wings.forEach((wing, j) => { wing.rotation.z = (j ? 1 : -1) * (0.15 + Math.sin(t * 2.7 + i) * 0.32) })
    })
  }
  g.userData.anim(0)
  return g
}

function rainbow() {
  const g = new THREE.Group()
  const colors = ['#f4b6c4', '#f5c9a5', '#f5e6ac', '#c5e6b8', '#b4dfec', '#b4c5ec', '#d2bdec']
  const bands = colors.map((color, i) => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })
    const radius = 14.4 - i * 0.2
    piece(g, new THREE.RingGeometry(radius - 0.15, radius, 96, 1, 0, Math.PI), m)
    return m
  })
  const cloud = new THREE.MeshBasicMaterial({ color: '#f7f4ff', transparent: true, opacity: 0.38, depthWrite: false })
  const puff = new THREE.IcosahedronGeometry(1, 1)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const m = piece(g, puff, cloud, side * (13.3 + i * 0.7), 0.04 - i * 0.18, 0.1 + i * 0.2)
      m.scale.set(1.4, 0.45 + i * 0.1, 0.75)
    }
  }
  g.position.set(0, -4, -18)
  g.userData.ownedMaterials = [...bands, cloud]
  g.userData.anim = (t, dt, night) => {
    for (const m of bands) m.opacity = 0.42 * (1 - night) ** 1.6
    cloud.opacity = 0.16 + (1 - night) * 0.22
  }
  return g
}

function tsukimidai() {
  const g = new THREE.Group()
  const wood = mat('#c6a286')
  // 後排立柱落在島緣內，前半平台向外懸挑
  for (let i = 0; i < 9; i++) piece(g, new THREE.BoxGeometry(0.18, 0.12, 1.5), i % 2 ? wood : mat('#dbbba0'), -0.76 + i * 0.19, 0.16)
  for (const x of [-0.62, 0.1]) {
    piece(g, new THREE.CylinderGeometry(0.065, 0.075, 0.9, 6), mat(WOOD), x, -0.3, -0.65)
    limb(g, [x, -0.65, -0.65], [x, 0.08, 0.58], 0.05, mat(WOOD))
  }
  for (const x of [-0.8, 0.8]) {
    piece(g, new THREE.BoxGeometry(0.055, 0.055, 1.53), wood, x, 0.62)
    for (const z of [-0.7, 0.7]) piece(g, new THREE.BoxGeometry(0.055, 0.43, 0.055), wood, x, 0.41, z)
  }
  for (const x of [-0.4, 0.4]) {
    const cushion = piece(g, new THREE.BoxGeometry(0.53, 0.12, 0.47), mat(x < 0 ? '#b7b2dd' : '#e8b2c5'), x, 0.29, 0.34)
    cushion.rotation.y = x < 0 ? 0.12 : -0.1
  }
  piece(g, new THREE.CylinderGeometry(0.32, 0.28, 0.055, 12), mat('#efddbd'), 0, 0.28, -0.24)
  piece(g, new THREE.BoxGeometry(0.26, 0.09, 0.24), wood, 0, 0.235, -0.24)
  const dango = new THREE.SphereGeometry(0.095, 8, 6)
  for (let layer = 0; layer < 3; layer++) {
    const rows = 3 - layer
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col <= row; col++) piece(g, dango, mat('#fff9e9'), (col - row / 2) * 0.18, 0.4 + layer * 0.155, -0.24 + (row - (rows - 1) * 0.65) * 0.15)
    }
  }
  piece(g, new THREE.SphereGeometry(0.14, 8, 6), mat('#c0d3df'), -0.56, 0.36, -0.46).scale.set(0.9, 1.25, 0.9)
  piece(g, new THREE.CylinderGeometry(0.065, 0.075, 0.17, 8), mat('#c0d3df'), -0.56, 0.55, -0.46)
  for (let i = 0; i < 6; i++) {
    const x = -0.56 + (i - 2.5) * 0.085
    const top = 1.25 + Math.sin(i * 1.8) * 0.16
    limb(g, [-0.56, 0.55, -0.46], [x, top, -0.46 + Math.cos(i) * 0.07], 0.009, mat('#b8ba89'))
    const plume = piece(g, new THREE.ConeGeometry(0.055, 0.33, 5), mat('#f1e2b7'), x, top + 0.11, -0.46 + Math.cos(i) * 0.07)
    plume.rotation.z = -(i - 2.5) * 0.09
  }
  const glow = new THREE.MeshStandardMaterial({ color: '#fff1d5', emissive: '#ffcf93', emissiveIntensity: 0.2, roughness: 0.7, flatShading: true })
  piece(g, new THREE.BoxGeometry(0.23, 0.33, 0.23), glow, 0.56, 0.43, -0.46)
  for (const y of [0.25, 0.62]) piece(g, new THREE.BoxGeometry(0.29, 0.045, 0.29), mat(WOOD), 0.56, y, -0.46)
  const light = new THREE.PointLight('#ffd39b', 0, 5, 1.8)
  light.position.set(0.5, 1.0, -0.4)
  g.add(light)
  g.userData.glow = { mats: [glow], lights: [light], base: 0.2 }
  g.userData.ownedMaterials = [glow]
  return shadowed(at(g, 7.05, 6.65))
}

function whale() {
  const g = new THREE.Group()
  const white = mat('#f5f4fc', { roughness: 0.95 })
  const puff = new THREE.IcosahedronGeometry(1, 2)
  for (const [x, y, z, sx, sy, sz] of [
    [0, 0, 0, 2.35, 1.18, 1.2], [1.35, 0.08, 0, 1.3, 1.1, 1.16],
    [-1.45, 0.1, 0, 1.25, 0.92, 0.96], [0.3, 0.6, 0.15, 1.5, 0.78, 1.08],
    [0.8, -0.5, 0, 1.5, 0.68, 0.92],
  ]) piece(g, puff, white, x, y, z).scale.set(sx, sy, sz)
  for (const side of [-1, 1]) {
    const fin = piece(g, puff, white, 0.15, -0.66, side * 1.17)
    fin.scale.set(0.67, 0.15, 0.48)
    fin.rotation.x = side * 0.3
    piece(g, new THREE.SphereGeometry(0.075, 8, 6), mat('#646174'), 1.85, 0.16, side * 1.13)
    piece(g, new THREE.SphereGeometry(0.025, 6, 4), mat('#ffffff'), 1.87, 0.18, side * 1.19)
    piece(g, puff, mat('#f3d4e2'), 1.54, -0.14, side * 1.18).scale.set(0.23, 0.1, 0.045)
    const tail = piece(g, puff, white, -3.2, 0.9, side * 0.48)
    tail.scale.set(0.65, 0.18, 0.72)
    tail.rotation.set(side * 0.3, side * 0.35, -0.28)
  }
  limb(g, [-1.9, 0.1, 0], [-3, 0.85, 0], 0.4, white)
  const spout = new THREE.Group()
  const mistMat = new THREE.MeshStandardMaterial({ color: '#e3f5ff', transparent: true, opacity: 0.45, roughness: 1, flatShading: true, depthWrite: false })
  const mist = []
  for (let i = 0; i < 6; i++) mist.push(piece(spout, puff, mistMat))
  spout.position.set(1.15, 1.05, 0)
  g.add(spout)
  g.userData.ownedMaterials = [mistMat]
  g.userData.anim = (t) => {
    const a = t * Math.PI * 2 / 240 + 3.8
    g.position.set(Math.cos(a) * 22, 7 + Math.sin(t * 0.045) * 0.8, Math.sin(a) * 22)
    g.rotation.set(0, -a - Math.PI / 2, Math.sin(t * 0.3) * 0.035)
    const cycle = t % 24
    const u = Math.min(cycle / 3.6, 1)
    spout.visible = cycle < 3.6
    mistMat.opacity = 0.45 * Math.max(0, 1 - u)
    mist.forEach((m, i) => {
      const a = i * 2.4
      const spread = u * 0.5
      m.position.set(Math.cos(a) * spread, 0.2 + u * 1.8 + i * 0.15, Math.sin(a) * spread)
      m.scale.setScalar(0.12 + Math.min(u, 1) * 0.24 + i * 0.022)
    })
  }
  g.userData.anim(0)
  return g
}

function skytree() {
  const g = new THREE.Group()
  const rock = piece(g, new THREE.ConeGeometry(3.1, 5.2, 10, 2), mat('#c8c5e6'), 0, -2.8)
  rock.rotation.x = Math.PI
  piece(g, new THREE.CylinderGeometry(3.2, 3.1, 0.4, 12), mat('#d9e5e7'), 0, -0.2)
  const wood = mat('#b5a4bd')
  limb(g, [0, 0, 0], [0.12, 4.8, 0], 0.46, wood)
  for (const end of [[-2, 5.3, 0.2], [2, 5.5, -0.3], [-0.5, 5.8, -1.4], [0.4, 5.7, 1.6]]) limb(g, [0, 2.7, 0], end, 0.23, wood)
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2
    limb(g, [Math.cos(a) * 1.0, 0.06, Math.sin(a) * 0.9], [0, 0.65, 0], 0.18, wood)
  }
  const crystals = ['#c4e7fa', '#d7cdf5', '#cbdafa', '#e5dafa'].map((color) => new THREE.MeshStandardMaterial({
    color, transparent: true, opacity: 0.7, roughness: 0.28, metalness: 0.06, flatShading: true,
    emissive: color, emissiveIntensity: 0.16, depthWrite: false,
  }))
  const puff = new THREE.IcosahedronGeometry(1, 1)
  const crowns = [
    [0, 6.0, 0, 2], [-2, 5.2, 0.1, 1.55], [2, 5.25, -0.2, 1.5],
    [-0.9, 6.5, -1.1, 1.35], [1, 6.65, 0.8, 1.45], [-0.9, 5.4, 1.65, 1.3],
    [1.3, 5.35, -1.5, 1.25], [-1.5, 6.5, 0.75, 1.1], [0, 7.25, -0.15, 1.05],
  ]
  crowns.forEach(([x, y, z, s], i) => {
    const m = piece(g, puff, crystals[i % crystals.length], x, y, z)
    m.scale.set(s, s * (i % 2 ? 1.12 : 0.85), s)
    m.rotation.set(i * 0.7, i * 1.1, i * 0.3)
  })
  const r = rng(3030)
  const seeds = Array.from({ length: 64 }, () => [r() * Math.PI * 2, 0.6 + r() * 2.6, r() * 5.8])
  const positions = new Float32Array(seeds.length * 3)
  const colors = new Float32Array(seeds.length * 3)
  const c = new THREE.Color()
  seeds.forEach((seed, i) => {
    c.set(i % 2 ? '#e7d4ff' : '#c8f3ff').toArray(colors, i * 3)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const sparkle = new THREE.PointsMaterial({ size: 0.075, transparent: true, opacity: 0.3, vertexColors: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const points = new THREE.Points(geo, sparkle)
  // 光點一直在此範圍內上升，不必每幀重算包圍球
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 5.5)
  g.add(points)
  g.position.set(0, 12, -16)
  g.userData.glow = { mats: crystals, lights: [], base: 0.16 }
  g.userData.ownedMaterials = [...crystals, sparkle]
  g.userData.anim = (t, dt, night) => {
    g.position.y = 12 + Math.sin(t * 0.24) * 0.22
    seeds.forEach(([a, radius, phase], i) => {
      positions[i * 3] = Math.cos(a + t * 0.035) * radius
      positions[i * 3 + 1] = 2.1 + (phase + t * 0.22) % 5.8
      positions[i * 3 + 2] = Math.sin(a + t * 0.035) * radius * 0.8
    })
    geo.attributes.position.needsUpdate = true
    sparkle.opacity = 0.2 + night * 0.7
  }
  g.userData.anim(0, 0, 0)
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
  sakuraGrow,
  waterfall,
  bonbori,
  teahouse,
  shrineUp,
  cranes,
  rainbow,
  tsukimidai,
  whale,
  skytree,
}
// 升級景觀在島上佔的地面（商店裝飾不能擺在這裡）
const FOOTPRINTS = {
  waterfall: [[8.6, 1.1, 0.9]],
  shrineUp: [[-6.85, -4.0, 1.55]],
  tsukimidai: [[7.05, 6.65, 1.0]],
}

// 這些是「一群」散在島上的物件，彈出動畫要逐一套用在子物件上
const COLLECTIONS = new Set(['hydrangea', 'chochin', 'lilies', 'bonbori'])

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

  // 物件的包圍盒中心與大小（天空中的景觀原點不在模型上，升級時鏡頭要對準實際的位置）
  bounds(key) {
    const o = this.items[key]
    if (!o) return null
    const box = new THREE.Box3().setFromObject(o)
    return { center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()).length() }
  }

  anchor(key) {
    return this.bounds(key)?.center || null
  }

  // 擺放商店裝飾時要避開的地面範圍：[x, z, 半徑]
  footprints() {
    const out = []
    for (const [key, list] of Object.entries(FOOTPRINTS)) if (this.items[key]) out.push(...list)
    for (const key of ['hydrangea', 'bonbori']) {
      const o = this.items[key]
      if (!o) continue
      for (const c of o.children) if (!c.isLight) out.push([o.position.x + c.position.x, o.position.z + c.position.z, 0.45])
    }
    return out
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
      if (typeof o.userData.anim === 'function') o.userData.anim(t, dt, night)
    }
  }
}
