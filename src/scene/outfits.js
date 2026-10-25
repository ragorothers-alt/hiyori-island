import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export const OUTFIT_META = {
  crown: { hideClip: false },
  straw: { hideClip: true },
  kitsune: { hideClip: true },
  hachimaki: { hideClip: false },
  kanzashi: { hideClip: false },
  wagasa: { hideClip: false },
}

const TAU = Math.PI * 2
const R = 0.6
const H = R * 0.82
const CY = 0.49
const Z = new THREE.Vector3(0, 0, 1)
const Y = new THREE.Vector3(0, 1, 0)
const v = (x, y, z) => new THREE.Vector3(x, y, z)

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.72, flatShading: true,
    emissive: color, emissiveIntensity: 0.09,
    ...options,
  })
}

function mesh(parent, name, geometry, mat, position) {
  const item = new THREE.Mesh(geometry, mat)
  item.name = name
  item.castShadow = true
  if (position) item.position.copy(position)
  parent.add(item)
  return item
}

// 徑向投影到麻糬扁球，再沿法線留出布料厚度。
function surface(point, offset = 0) {
  const d = point.clone().sub(v(0, CY, 0))
  const q = Math.sqrt((d.x * d.x + d.z * d.z) / (R * R) + d.y * d.y / (H * H))
  const p = d.divideScalar(q).add(v(0, CY, 0))
  return p.addScaledVector(normal(p), offset)
}

function normal(point) {
  return v(point.x / (R * R), (point.y - CY) / (H * H), point.z / (R * R)).normalize()
}

function radiusAt(y) {
  return R * Math.sqrt(Math.max(0, 1 - ((y - CY) / H) ** 2))
}

function facing(item, direction) {
  const n = direction.clone().normalize()
  const right = Y.clone().cross(n).normalize()
  const up = n.clone().cross(right)
  item.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n))
  return item
}

function tube(points, radius = 0.008, closed = false) {
  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points, closed, 'centripetal'),
    Math.max(12, points.length * 3), radius, 5, closed,
  )
}

function merged(parts) {
  const geometry = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  return geometry
}

function rod(parent, name, start, end, radius, mat) {
  const direction = end.clone().sub(start)
  const item = mesh(parent, name, new THREE.CylinderGeometry(radius, radius, direction.length(), 8), mat)
  item.position.copy(start).add(end).multiplyScalar(0.5)
  item.quaternion.setFromUnitVectors(Y, direction.normalize())
  return item
}

function outline(points) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  return shape
}

function relief(shape, depth = 0.012) {
  return new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, bevelEnabled: true,
    bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 3,
  })
}

function flowerShape(radius) {
  const shape = new THREE.Shape()
  for (let i = 0; i <= 60; i++) {
    const a = i / 60 * TAU
    const r = radius * (0.79 + 0.21 * Math.cos(a * 5))
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
}

function starShape(radius) {
  return outline(Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 2 + i / 10 * TAU
    const r = radius * (i % 2 ? 0.46 : 1)
    return [Math.cos(a) * r, Math.sin(a) * r]
  }))
}

function buildCrown(group) {
  const petals = ['#f7b8cb', '#fffaf1', '#ffe7a3'].map((color) => material(color))
  const pollen = material('#efc778')
  const green = material('#a7cdab')
  const ringPoint = (a, offset = 0.018) => surface(v(
    Math.cos(a) * 0.38, 0.883 - Math.sin(a) * 0.038, Math.sin(a) * 0.38,
  ), offset)
  mesh(group, 'crown.vine', tube(Array.from({ length: 36 }, (_, i) => ringPoint(i / 36 * TAU)), 0.012, true), green)
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TAU
    const p = ringPoint(a, 0.027)
    const bloom = facing(mesh(group, `crown.flower.${i}`, relief(flowerShape(0.065)), petals[i % 3], p), normal(p))
    bloom.rotateZ(a)
    const center = mesh(bloom, `crown.pollen.${i}`, new THREE.SphereGeometry(0.018, 8, 6), pollen, v(0, 0, 0.019))
    center.scale.z = 0.55
  }
  for (let i = 0; i < 6; i++) {
    const a = (i + 0.45) / 6 * TAU
    const p = ringPoint(a, 0.023)
    const leaf = facing(mesh(group, `crown.leaf.${i}`, new THREE.SphereGeometry(1, 8, 4), green, p), normal(p))
    leaf.rotateZ(a + 0.65)
    leaf.scale.set(0.048, 0.021, 0.009)
  }
}

function buildStraw(group) {
  const straw = material('#ead59c')
  const weave = material('#cdb681')
  const red = material('#e98a91')
  const hat = new THREE.Group()
  hat.position.y = 0.94
  hat.rotation.x = -0.055
  group.add(hat)
  const profile = [
    [0.26, -0.025], [0.43, -0.072], [0.59, -0.135],
    [0.59, -0.121], [0.43, -0.058], [0.277, 0.008],
    [0.267, 0.046], [0.238, 0.105], [0.17, 0.127], [0, 0.133],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  mesh(hat, 'straw.hat', new THREE.LatheGeometry(profile, 32), straw)
  mesh(hat, 'straw.ribbon', new THREE.LatheGeometry([
    new THREE.Vector2(0.279, 0.012), new THREE.Vector2(0.27, 0.048), new THREE.Vector2(0.257, 0.078),
  ], 32), red)
  const circles = [0.36, 0.46, 0.56].map((r) => tube(Array.from({ length: 40 }, (_, i) => {
    const a = i / 40 * TAU
    return v(r * Math.cos(a), 0.056 - r * 0.3, r * Math.sin(a))
  }), 0.003, true))
  mesh(hat, 'straw.woven.rings', merged(circles), weave)
  const stitches = Array.from({ length: 24 }, (_, i) => {
    const a = i / 24 * TAU
    return tube([0.3, 0.43, 0.58].map((r) => v(r * Math.cos(a), 0.063 - r * 0.307, r * Math.sin(a))), 0.002)
  })
  mesh(hat, 'straw.woven.stitches', merged(stitches), weave)
  const bow = new THREE.Group()
  bow.position.set(0.276, 0.04, -0.035)
  facing(bow, v(1, 0.25, 0))
  hat.add(bow)
  for (const side of [-1, 1]) {
    const loop = mesh(bow, `straw.bow.${side}`, new THREE.SphereGeometry(1, 8, 6), red, v(side * 0.035, 0.007, 0.005))
    loop.scale.set(0.04, 0.026, 0.015)
    loop.rotation.z = side * 0.25
    mesh(bow, `straw.tail.${side}`, relief(outline([
      [side * 0.008, -0.008], [side * 0.032, -0.015],
      [side * 0.049, -0.081], [side * 0.026, -0.069], [side * 0.013, -0.083],
    ]), 0.006), red)
  }
  mesh(bow, 'straw.bow.knot', new THREE.SphereGeometry(0.018, 8, 6), red, v(0, 0, 0.012))
}

function buildKitsune(group) {
  const white = material('#fff7ed')
  const red = material('#df7c87')
  const ink = material('#81535e')
  const gold = material('#edcf8e')
  const mask = new THREE.Group()
  const p = surface(v(0.36, 0.82, 0.32), 0.019)
  mask.position.copy(p)
  facing(mask, normal(p))
  mask.rotateZ(-0.24)
  group.add(mask)
  mesh(mask, 'kitsune.mask', relief(outline([
    [-0.122, 0.045], [-0.145, 0.205], [-0.061, 0.148], [0, 0.139],
    [0.061, 0.148], [0.145, 0.205], [0.122, 0.045], [0.1, -0.065],
    [0, -0.158], [-0.1, -0.065],
  ]), 0.027), white)
  for (const side of [-1, 1]) {
    mesh(mask, `kitsune.ear.${side}`, new THREE.ShapeGeometry(outline([
      [side * 0.112, 0.086], [side * 0.125, 0.169], [side * 0.076, 0.135],
    ])), red, v(0, 0, 0.03))
    mesh(mask, `kitsune.eye.${side}`, tube([
      v(side * 0.027, 0.006, 0.034), v(side * 0.057, 0.02, 0.038), v(side * 0.089, 0.037, 0.034),
    ], 0.006), ink)
    mesh(mask, `kitsune.brow.${side}`, new THREE.ShapeGeometry(outline([
      [side * 0.024, 0.058], [side * 0.087, 0.079], [side * 0.061, 0.048],
    ])), red, v(0, 0, 0.032))
    mesh(mask, `kitsune.cheek.${side}`, tube([
      v(side * 0.096, -0.016, 0.032), v(side * 0.07, -0.038, 0.034), v(side * 0.082, -0.063, 0.032),
    ], 0.008), red)
  }
  mesh(mask, 'kitsune.forehead', new THREE.ShapeGeometry(outline([
    [0, 0.111], [0.015, 0.087], [0, 0.064], [-0.015, 0.087],
  ])), gold, v(0, 0, 0.033))
  const nose = mesh(mask, 'kitsune.nose', new THREE.SphereGeometry(0.018, 8, 6), ink, v(0, -0.07, 0.039))
  nose.scale.set(1, 0.65, 0.7)
  mesh(mask, 'kitsune.mouth', tube([v(-0.022, -0.105, 0.033), v(0, -0.115, 0.035), v(0.022, -0.105, 0.033)], 0.004), red)
}

function buildHachimaki(group) {
  // 白色麻糬上看不出白頭帶：改用藍染布條，前額縫一塊白布再點上紅日
  const white = material('#7088c6', { side: THREE.DoubleSide })
  const patch = material('#f8f4ef')
  const red = material('#df737e')
  const hem = material('#5d72b0')
  // 布條上下緣分別取扁球截面，避免用圓柱切進額頭。
  const ys = [0.721, 0.74, 0.76, 0.78, 0.8]
  const profile = [
    ...ys.map((y) => new THREE.Vector2(radiusAt(y) + 0.014, y)),
    ...ys.toReversed().map((y) => new THREE.Vector2(radiusAt(y) + 0.004, y)),
    new THREE.Vector2(radiusAt(ys[0]) + 0.014, ys[0]),
  ]
  mesh(group, 'hachimaki.band', new THREE.LatheGeometry(profile, 64), white)
  for (const [i, y] of [0.724, 0.797].entries()) {
    const r = radiusAt(y) + 0.015
    mesh(group, `hachimaki.hem.${i}`, tube(Array.from({ length: 48 }, (_, j) => {
      const a = j / 48 * TAU
      return v(Math.cos(a) * r, y, Math.sin(a) * r)
    }), 0.002, true), hem)
  }
  const back = surface(v(0, 0.76, radiusAt(0.76)), 0.018)
  facing(mesh(group, 'hachimaki.patch', new THREE.CircleGeometry(0.046, 24), patch, back), normal(back))
  const dot = surface(v(0, 0.76, radiusAt(0.76)), 0.021)
  facing(mesh(group, 'hachimaki.hinomaru', new THREE.CircleGeometry(0.03, 24), red, dot), normal(dot))
  const knot = surface(v(0, 0.755, -radiusAt(0.755)), 0.022)
  const tied = mesh(group, 'hachimaki.knot', new THREE.SphereGeometry(0.035, 10, 6), white, knot)
  tied.scale.set(1.25, 0.8, 0.65)
  const tailEdges = []
  for (const side of [-1, 1]) {
    const positions = []
    const indices = []
    for (let i = 0; i <= 12; i++) {
      const t = i / 12
      const y = 0.746 - t * (side === 1 ? 0.25 : 0.21)
      const x = side * (0.019 + 0.075 * t + 0.012 * Math.sin(t * Math.PI))
      for (const edge of [-1, 1]) {
        const px = x + edge * (0.022 - t * 0.004)
        const py = y + (i === 12 && edge === side ? 0.014 : 0)
        const z = -Math.sqrt(Math.max(0, radiusAt(py) ** 2 - px ** 2)) - 0.018
        positions.push(px, py, z)
      }
      if (i < 12) {
        const a = i * 2
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    mesh(group, `hachimaki.tail.${side}`, geometry, white)
    for (let edge = 0; edge < 2; edge++) {
      tailEdges.push(tube(Array.from({ length: 13 }, (_, i) => {
        const at = i * 6 + edge * 3
        return v(positions[at], positions[at + 1], positions[at + 2] - 0.001)
      }), 0.0015))
    }
  }
  mesh(group, 'hachimaki.tail.hems', merged(tailEdges), hem)
}

function buildKanzashi(group) {
  const gold = material('#efce85', { metalness: 0.25, roughness: 0.4 })
  const pale = material('#ffe9ae', { metalness: 0.15 })
  const pink = material('#edb4c5')
  const top = v(-0.3, 0.985, 0.17)
  const base = surface(v(-0.19, 0.94, 0.1), -0.015)
  rod(group, 'kanzashi.pin', base, top, 0.009, gold)
  const star = mesh(group, 'kanzashi.star', relief(starShape(0.056), 0.014), gold, top)
  star.rotation.set(-0.18, -0.18, 0.13)
  mesh(group, 'kanzashi.mount', new THREE.SphereGeometry(0.018, 8, 6), pink, top.clone().add(v(0.012, -0.038, 0)))
  const ends = [0.81, 0.774, 0.842]
  for (let i = 0; i < 3; i++) {
    const x = -0.355 + i * 0.065
    const points = Array.from({ length: 12 }, (_, j) => {
      const t = j / 11
      const px = THREE.MathUtils.lerp(-0.3 + (i - 1) * 0.025, x, t)
      const y = THREE.MathUtils.lerp(0.966, ends[i], t)
      const z = Math.max(0.18, Math.sqrt(Math.max(0, radiusAt(y) ** 2 - px ** 2))) + 0.025
      return v(px, y, z)
    })
    points[0] = v((i - 1) * 0.022, -0.02, 0.018).applyQuaternion(star.quaternion).add(top)
    mesh(group, `kanzashi.chain.${i}`, tube(points, 0.0035), gold)
    for (const [j, t] of [0.54, 1].entries()) {
      const point = points[Math.round(t * 11)]
      const charm = facing(mesh(group, `kanzashi.charm.${i}.${j}`, relief(starShape(j ? 0.026 : 0.019), 0.006), pale, point), normal(point))
      charm.rotateZ((i - 1) * 0.2)
    }
  }
}

function buildWagasa(group) {
  const red = material('#df8996', { side: THREE.DoubleSide })
  const lightRed = new THREE.Color('#efa8ae')
  const darkRed = new THREE.Color('#df8996')
  const wood = material('#bb9276')
  const cream = material('#ffe6c6')
  const pink = material('#ffe0df')
  const hub = v(0.3, 1.55, 0.05)
  const lowerShaft = v(0.61, 0.6, 0.12)
  const canopy = new THREE.Group()
  canopy.position.copy(hub)
  canopy.quaternion.setFromUnitVectors(Y, hub.clone().sub(lowerShaft).normalize())
  group.add(canopy)
  const dome = (r, a, lift = 0) => v(r * Math.cos(a), -0.2 * (r / 0.7) ** 1.35 + lift, r * Math.sin(a))
  const positions = []
  const colors = []
  const addTriangle = (a, b, c, color) => {
    for (const p of [a, b, c]) {
      positions.push(p.x, p.y, p.z)
      colors.push(color.r, color.g, color.b)
    }
  }
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU
    const b = (i + 1) / 16 * TAU
    const color = i % 2 ? lightRed : darkRed
    for (let j = 0; j < 4; j++) {
      const r0 = j / 4 * 0.7
      const r1 = (j + 1) / 4 * 0.7
      if (j === 0) addTriangle(dome(0, a), dome(r1, b), dome(r1, a), color)
      else {
        addTriangle(dome(r0, a), dome(r0, b), dome(r1, a), color)
        addTriangle(dome(r0, b), dome(r1, b), dome(r1, a), color)
      }
    }
  }
  const paper = new THREE.BufferGeometry()
  paper.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  paper.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  paper.computeVertexNormals()
  red.color.set('#ffffff')
  red.vertexColors = true
  mesh(canopy, 'wagasa.canopy.paper', paper, red)
  const ribs = Array.from({ length: 16 }, (_, i) => tube(
    Array.from({ length: 5 }, (_, j) => dome(j / 4 * 0.7, i / 16 * TAU, -0.009)), 0.005,
  ))
  mesh(canopy, 'wagasa.canopy.ribs', merged(ribs), wood)
  mesh(canopy, 'wagasa.canopy.rim', tube(Array.from({ length: 64 }, (_, i) => dome(0.7, i / 64 * TAU)), 0.009, true), cream)
  for (const [i, r] of [0.52, 0.56].entries()) {
    mesh(canopy, `wagasa.canopy.pattern.${i}`, tube(Array.from({ length: 64 }, (_, j) => dome(r, j / 64 * TAU, 0.008)), 0.004, true), pink)
  }
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.4) / 4 * TAU
    const p = dome(0.37, a, 0.009)
    const n = v(Math.cos(a) * 0.31, 1, Math.sin(a) * 0.31).normalize()
    const bloom = facing(mesh(canopy, `wagasa.canopy.flower.${i}`, relief(flowerShape(0.042), 0.003), pink, p), n)
    mesh(bloom, `wagasa.canopy.pollen.${i}`, new THREE.SphereGeometry(0.009, 6, 4), cream, v(0, 0, 0.008))
  }
  rod(canopy, 'wagasa.canopy.hub', v(0, -0.07, 0), v(0, 0.04, 0), 0.024, wood)
  // 握柄先繞過側腹，再接斜向傘軸，避免直線穿過身體。
  mesh(group, 'wagasa.shaft', tube([
    v(0.56, 0.235, 0.12), v(0.614, 0.4, 0.122), lowerShaft, v(0.45, 1.09, 0.084), hub,
  ], 0.011), wood)
  mesh(group, 'wagasa.grip', tube([
    v(0.546, 0.212, 0.12), v(0.56, 0.241, 0.12), v(0.581, 0.293, 0.12),
  ], 0.019), cream)
}

export function buildOutfit(key) {
  const builders = {
    crown: buildCrown, straw: buildStraw, kitsune: buildKitsune,
    hachimaki: buildHachimaki, kanzashi: buildKanzashi, wagasa: buildWagasa,
  }
  if (!Object.hasOwn(builders, key)) return null
  const group = new THREE.Group()
  group.name = `outfit.${key}`
  builders[key](group)
  return group
}

export function disposeOutfit(group) {
  if (!group) return
  const geometries = new Set()
  const materials = new Set()
  group.traverse((item) => {
    if (item.geometry) geometries.add(item.geometry)
    const list = Array.isArray(item.material) ? item.material : [item.material]
    for (const mat of list) if (mat) materials.add(mat)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const mat of materials) mat.dispose()
}
