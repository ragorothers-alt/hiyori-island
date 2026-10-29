import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const TAU = Math.PI * 2
const Y = new THREE.Vector3(0, 1, 0)
const v = (x, y, z) => new THREE.Vector3(x, y, z)
const PALETTES = {
  mochi: { flower: '#e9a0b7', light: '#fff0de', accent: '#cb778e', metal: '#d5af65', star: '#f2ce7e', leaf: '#91af88' },
  fuji: { flower: '#b4a2d6', light: '#efecfa', accent: '#8671ad', metal: '#b8b7d5', star: '#99b9e4', leaf: '#8baea1' }
}

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.82, flatShading: true,
    emissive: color, emissiveIntensity: 0.16,
    ...options
  })
}

function mesh(parent, name, geometry, mat) {
  const item = new THREE.Mesh(geometry, mat)
  item.name = name
  item.castShadow = true
  item.receiveShadow = false
  parent.add(item)
  return item
}

function group(name) {
  const item = new THREE.Group()
  item.name = name
  return item
}

function combine(parts) {
  const inputs = parts.map((part) => {
    const input = part.index ? part.toNonIndexed() : part
    for (const key of Object.keys(input.attributes)) if (key !== 'position' && key !== 'normal') input.deleteAttribute(key)
    return input
  })
  const result = mergeGeometries(inputs, false)
  for (const part of new Set([...parts, ...inputs])) part.dispose()
  return result
}

function geometry(positions, indices) {
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  result.setIndex(indices)
  result.computeVertexNormals()
  return result
}

function polygon(points, depth = 0.008) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 2 })
}

function rod(start, end, radius = 0.007, sides = 5) {
  const direction = end.clone().sub(start)
  return new THREE.CylinderGeometry(radius, radius, direction.length(), sides)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, direction.normalize()))
    .translate(...start.clone().add(end).multiplyScalar(0.5).toArray())
}

function tube(points, radius = 0.008, segments = 20, closed = false) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed, 'centripetal'), segments, radius, 5, closed)
}

function gem(radius, point) {
  return new THREE.IcosahedronGeometry(radius, 0).translate(...point.toArray())
}

function star(radius, depth = 0.012) {
  return polygon(Array.from({ length: 10 }, (_, i) => {
    const angle = Math.PI / 2 + i * Math.PI / 5
    const r = radius * (i % 2 ? 0.45 : 1)
    return [Math.cos(angle) * r, Math.sin(angle) * r]
  }), depth)
}

function crown(p) {
  const root = group('flower-crown')
  // 花環沿瀏海上緣，後方留空讓兩耳活動。
  const at = (a) => v(Math.sin(a) * 0.342, -0.112 + Math.cos(a) * 0.065, Math.cos(a) * 0.252)
  const angles = [-1.22, -0.61, 0, 0.61, 1.22]
  const stems = [tube(Array.from({ length: 13 }, (_, i) => at(-1.4 + i * 2.8 / 12)), 0.012, 24)]
  const petals = [[], []]
  const hearts = []
  for (const [i, a] of angles.entries()) {
    const center = at(a).add(v(0, 0.018, 0.009))
    const q = new THREE.Quaternion().setFromAxisAngle(Y, a * 0.72)
    const outline = []
    for (let j = 0; j < 5; j++) {
      const angle = j * TAU / 5
      for (const [turn, r] of [[-0.54, 0.029], [-0.32, 0.058], [0, 0.064], [0.32, 0.058], [0.54, 0.029]]) {
        outline.push([Math.sin(angle + turn) * r, Math.cos(angle + turn) * r])
      }
    }
    petals[i % 2].push(polygon(outline, 0.014).applyQuaternion(q).translate(...center.toArray()))
    hearts.push(gem(0.018, center.clone().add(v(Math.sin(a * 0.72) * 0.025, 0, 0.025))))
  }
  for (const a of [-1.38, -0.92, -0.32, 0.32, 0.92, 1.38]) {
    const point = at(a)
    stems.push(polygon([[0, 0], [0.024, 0.012], [0.054, 0.046], [0.018, 0.039]], 0.006)
      .rotateZ(a > 0 ? -0.65 : 1.1).rotateY(a * 0.72).translate(...point.toArray()))
  }
  mesh(root, 'woven-leaves', combine(stems), material(p.leaf))
  mesh(root, 'colored-blossoms', combine(petals[0]), material(p.flower, { side: THREE.DoubleSide }))
  mesh(root, 'pale-blossoms', combine(petals[1]), material(p.light, { side: THREE.DoubleSide }))
  mesh(root, 'flower-hearts', combine(hearts), material(p.metal))
  return { parts: [['headTop', root]], hideClip: true }
}

function straw(p) {
  const root = group('ear-friendly-boater')
  root.position.set(0, 0.005, -0.11)
  root.rotation.set(-0.12, 0, 0.07)
  // 小帽落在兩耳之間偏後，不以帽身包住耳朵。
  mesh(root, 'straw-brim', new THREE.CylinderGeometry(0.248, 0.248, 0.018, 16).scale(1, 1, 0.79), material('#e8c991'))
  mesh(root, 'straw-crown', new THREE.CylinderGeometry(0.133, 0.153, 0.112, 12).scale(1, 1, 0.88).translate(0, 0.063, 0), material('#dab575'))
  mesh(root, 'hat-ribbon', new THREE.CylinderGeometry(0.148, 0.153, 0.033, 12, 1, true)
    .scale(1, 1, 0.88).translate(0, 0.029, 0), material(p.accent, { side: THREE.DoubleSide }))
  const bow = []
  for (const s of [-1, 1]) bow.push(polygon([[0, 0], [s * 0.065, 0.03], [s * 0.059, -0.027]], 0.012).translate(0.085, 0.044, 0.12))
  bow.push(gem(0.018, v(0.085, 0.044, 0.135)))
  mesh(root, 'hat-bow', combine(bow), material(p.light))
  const weave = []
  for (const r of [0.185, 0.222]) {
    weave.push(new THREE.TorusGeometry(r, 0.003, 3, 16).rotateX(Math.PI / 2).scale(1, 1, 0.79).translate(0, 0.012, 0))
  }
  mesh(root, 'straw-weave', combine(weave), material('#cba768'))
  return { parts: [['headTop', root]], hideClip: false }
}

function kitsune(p, who) {
  const root = group('festival-fox-mask')
  // 換算到兩人的右側髮掛點，面具留在眼睛外側。
  root.position.set(...(who === 'fuji' ? [-0.055, 0.095, 0.08] : [-0.04, 0.2, 0.135]))
  root.rotation.set(0, -0.6, 0.23)
  const outline = [[0, -0.125], [-0.072, -0.068], [-0.099, 0.035], [-0.091, 0.155], [-0.025, 0.098], [0, 0.105], [0.025, 0.098], [0.091, 0.155], [0.099, 0.035], [0.072, -0.068]]
  const positions = [0, 0, 0.057, ...outline.flatMap(([x, y]) => [x, y, 0.018]), ...outline.flatMap(([x, y]) => [x, y, 0])]
  const indices = []
  for (let i = 0; i < outline.length; i++) {
    const a = 1 + i
    const b = 1 + (i + 1) % outline.length
    indices.push(0, b, a, a, b, b + 10, a, b + 10, a + 10)
  }
  indices.push(...THREE.ShapeUtils.triangulateShape(outline.map(([x, y]) => new THREE.Vector2(x, y)), []).flatMap(t => t.map(i => i + 11)))
  mesh(root, 'faceted-fox', geometry(positions, indices), material(p.light))
  const red = []
  const eyes = []
  for (const s of [-1, 1]) {
    red.push(polygon([[s * 0.046, 0.098], [s * 0.080, 0.132], [s * 0.083, 0.066]], 0.004).translate(0, 0, 0.026))
    red.push(polygon([[s * 0.068, -0.026], [s * 0.045, -0.045], [s * 0.064, -0.073], [s * 0.080, -0.040]], 0.003).translate(0, 0, 0.044))
    eyes.push(polygon([[s * 0.018, 0.016], [s * 0.075, 0.038], [s * 0.057, 0.003]], 0.004).translate(0, 0, 0.051))
  }
  mesh(root, 'vermilion-markings', combine(red), material('#cb6972'))
  eyes.push(polygon([[-0.013, -0.050], [0.013, -0.050], [0, -0.063]], 0.004).translate(0, 0, 0.058))
  mesh(root, 'fox-eyes-and-nose', combine(eyes), material('#6c5867'))
  const ties = [tube([v(-0.076, 0, 0), v(-0.124, -0.03, 0), v(-0.115, -0.13, 0.01)], 0.005, 10)]
  for (const x of [-0.127, -0.115, -0.103]) ties.push(rod(v(-0.115, -0.13, 0.01), v(x, -0.186, 0.013), 0.004))
  mesh(root, 'mask-tassel', combine(ties), material(p.accent))
  return { parts: [['hairR', root]], hideClip: false }
}

function hachimaki(p, who) {
  const root = group('festival-headband')
  const forehead = who === 'fuji' ? v(0, 0.48, 0.322) : v(0, 0.46, 0.29)
  const at = (a, offset = 0) => v(Math.sin(a) * 0.426, 0.455 + Math.cos(a) * 0.025 + offset, -0.025 + Math.cos(a) * 0.375).sub(forehead)
  const positions = []
  const indices = []
  for (let i = 0; i <= 32; i++) {
    const a = i * TAU / 32
    positions.push(...at(a, -0.035).toArray(), ...at(a, 0.035).toArray())
    if (i) {
      const n = i * 2
      indices.push(n - 2, n, n + 1, n - 2, n + 1, n - 1)
    }
  }
  const cloth = [geometry(positions, indices)]
  const knot = at(-1.85)
  for (const [dx, dy] of [[-0.06, -0.20], [0.035, -0.15]]) {
    cloth.push(polygon([[-0.02, 0], [0.02, 0], [dx + 0.018, dy], [dx, dy + 0.015], [dx - 0.018, dy]], 0.007).rotateY(-1.3).translate(...knot.toArray()))
  }
  mesh(root, 'cotton-wrap-and-ties', combine(cloth), material(p.light, { side: THREE.DoubleSide }))
  const mark = new THREE.CircleGeometry(0.031, 12).translate(0, 0.48 - forehead.y, 0.358 - forehead.z)
  mesh(root, 'headband-sun', mark, material(p.accent))
  const patterns = [gem(0.021, knot.clone().add(v(-0.005, 0, 0)))]
  // 細滾邊讓白頭帶在淺髮與遊戲遠景仍能辨識。
  for (const offset of [-0.031, 0.031]) {
    patterns.push(tube(Array.from({ length: 32 }, (_, i) => at(i * TAU / 32, offset)), 0.007, 32, true))
  }
  for (const x of [-0.15, -0.10, 0.10, 0.15]) {
    const z = -0.025 + Math.sqrt(1 - (x / 0.426) ** 2) * 0.375 + 0.008
    patterns.push(polygon([[0, 0.015], [0.011, 0], [0, -0.015], [-0.011, 0]], 0.003).translate(x, 0.48 - forehead.y, z - forehead.z))
  }
  mesh(root, 'headband-trim-and-diamonds', combine(patterns), material(p.accent))
  return { parts: [['forehead', root]], hideClip: true }
}

function kanzashi(p, who) {
  const root = group('starlight-hairpin')
  root.position.set(...(who === 'fuji' ? [-0.04, 0.075, 0.06] : [-0.025, 0.18, 0.115]))
  root.rotation.set(0, -0.45, 0.08)
  const metal = [rod(v(0.03, -0.055, -0.016), v(-0.015, 0.16, -0.016), 0.008)]
  for (const [x, length] of [[-0.048, 0.16], [0.016, 0.12]]) {
    metal.push(rod(v(x, 0.068, 0.02), v(x, 0.068 - length, 0.029), 0.004, 4))
  }
  mesh(root, 'silver-or-gold-pin', combine(metal), material(p.metal))
  mesh(root, 'large-star', star(0.087, 0.018).translate(0, 0.086, 0.012), material(p.star))
  mesh(root, 'falling-star', star(0.036).translate(-0.048, -0.115, 0.025), material(p.light))
  mesh(root, 'hairpin-beads', combine([gem(0.022, v(0.016, -0.072, 0.03)), gem(0.013, v(-0.048, -0.06, 0.03))]), material(p.flower))
  return { parts: [['hairR', root]], hideClip: false }
}

function wagasa(p) {
  const root = group('red-paper-parasol')
  const canopy = group('shoulder-canopy')
  // 掛在脖子上：傘柄在右手邊，傘軸靠著右肩往後上方斜，傘面撐在頭後。
  // 不跟著手臂轉，走路擺手、舉手歡呼時傘都穩穩的
  const length = 1.15
  root.position.set(-0.34, -0.32, 0.06)
  canopy.quaternion.setFromUnitVectors(Y, v(-0.35, 1, -0.55).normalize())
  root.add(canopy)
  const panels = [[], []]
  const ribs = []
  const rim = []
  const point = (a, r, y) => v(Math.sin(a) * r, y, Math.cos(a) * r)
  for (let i = 0; i < 16; i++) {
    const a = i * TAU / 16
    const b = (i + 1) * TAU / 16
    const tip = v(0, length + 0.14, 0)
    const innerA = point(a, 0.29, length + 0.09)
    const innerB = point(b, 0.29, length + 0.09)
    const edgeA = point(a, 0.565, length - 0.025)
    const edgeB = point(b, 0.565, length - 0.025)
    panels[i % 2].push(geometry([...tip.toArray(), ...innerA.toArray(), ...innerB.toArray(), ...edgeA.toArray(), ...edgeB.toArray()], [0, 1, 2, 1, 3, 4, 1, 4, 2]))
    ribs.push(rod(tip, innerA, 0.005, 4), rod(innerA, edgeA, 0.005, 4))
    rim.push(rod(edgeA, edgeB, 0.006, 4))
  }
  mesh(canopy, 'red-paper-panels', combine(panels[0]), material('#cc626b', { side: THREE.DoubleSide }))
  mesh(canopy, 'coral-paper-panels', combine(panels[1]), material('#dc7d82', { side: THREE.DoubleSide }))
  mesh(canopy, 'bamboo-ribs', combine(ribs), material('#d9bc94'))
  mesh(canopy, 'ivory-parasol-rim', combine(rim), material(p.light))
  mesh(canopy, 'bamboo-shaft', rod(v(0, 0.04, 0), v(0, length + 0.19, 0), 0.012, 8), material('#aa8767'))
  mesh(canopy, 'wrapped-parasol-grip', combine([rod(v(0, -0.07, 0), v(0, 0.08, 0), 0.018, 8), gem(0.024, v(0, -0.08, 0))]), material(p.accent))
  return { parts: [['neck', root]], hideClip: false }
}

const BUILDERS = { crown, straw, kitsune, hachimaki, kanzashi, wagasa }

export function buildOutfit(key, who) {
  if (!Object.hasOwn(BUILDERS, key)) return null
  const person = who === 'fuji' ? 'fuji' : 'mochi'
  return BUILDERS[key](PALETTES[person], person)
}

export function disposeOutfit(outfit) {
  if (!outfit?.parts) return
  const geometries = new Set()
  const materials = new Set()
  const textures = new Set()
  for (const [, root] of outfit.parts) {
    root.traverse((item) => {
      if (item.geometry) geometries.add(item.geometry)
      for (const mat of Array.isArray(item.material) ? item.material : item.material ? [item.material] : []) {
        materials.add(mat)
        for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value)
      }
    })
  }
  for (const texture of textures) texture.dispose()
  for (const mat of materials) mat.dispose()
  for (const geo of geometries) geo.dispose()
}
