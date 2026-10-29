import * as THREE from 'three'

const PALETTE = {
  skin: '#ffe3cf', hair: '#D6D1E4', stripe: '#B6A9CC', inner: '#f1b9c3',
  ivory: '#FFF8ED', violet: '#B7A4D9', red: '#CF6D76', flower: '#f4b1c1'
}

// 幾何在各自關節的局部座標建立，外層負責所有動作。
export function buildCatFuji() {
  const group = new THREE.Group()
  group.name = 'cat-fuji'
  const ownedMaterials = []
  const ownedTextures = []
  const material = (color, options = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...options })
    ownedMaterials.push(m)
    return m
  }
  const skin = material(PALETTE.skin, { roughness: 0.65 })
  const hair = material('#ffffff', { vertexColors: true, roughness: 0.7 })
  const cloth = material('#ffffff', { vertexColors: true, flatShading: true, roughness: 0.92 })
  const sleeveCloth = material('#ffffff', { vertexColors: true, roughness: 0.92 })
  const red = material(PALETTE.red, { roughness: 0.7 })
  const mesh = (parent, name, geometry, mat) => {
    const m = new THREE.Mesh(geometry, mat)
    m.name = name
    m.castShadow = true
    m.receiveShadow = true
    parent.add(m)
    return m
  }
  const pivot = (parent, name, x, y, z) => {
    const p = new THREE.Object3D()
    p.name = name
    p.position.set(x, y, z)
    parent.add(p)
    return p
  }
  const hips = pivot(group, 'hips', 0, 0.3, 0)
  const torso = pivot(hips, 'torso', 0, 0.18, 0)
  const head = pivot(torso, 'head', 0, 0.12, 0)
  mesh(torso, 'neck-volume', ellipsoid([0.067, 0.072, 0.064], [0, 0.12, 0], 12, 8), skin)
  const headMesh = mesh(head, 'head-volume', ellipsoid([0.328, 0.29, 0.263], [0, 0.33, 0.012], 28, 20), skin)
  headMesh.position.z = 0.035
  mesh(head, 'nose', ellipsoid([0.016, 0.016, 0.026], [0, 0.242, 0.301], 10, 6), skin)
  mesh(head, 'hair-cap', bobCap(), hair)
  const locks = []
  for (let i = 0; i < 7; i++) {
    const a = 1.65 + i * (Math.PI * 2 - 3.3) / 6
    const sx = Math.sin(a)
    const cz = Math.cos(a)
    locks.push(hairLock([
      [sx * 0.255, 0.565, cz * 0.205, 0.07, 0.046],
      [sx * 0.374, 0.37, cz * 0.29, 0.102, 0.048],
      [sx * 0.372, 0.145, cz * 0.286, 0.078, 0.037],
      [sx * 0.325, 0.044 + (i % 2) * 0.015, cz * 0.26, 0.002, 0.002]
    ], new THREE.Vector3(cz, 0, -sx)))
  }
  for (const s of [-1, 1]) {
    locks.push(hairLock([
      [s * 0.23, 0.565, 0.12, 0.066, 0.046], [s * 0.335, 0.40, 0.09, 0.081, 0.072],
      [s * 0.325, 0.20, 0.11, 0.074, 0.072], [s * 0.26, 0.11, 0.17, 0.002, 0.002]
    ], new THREE.Vector3(0, 0, -s), true))
  }
  mesh(head, 'bob-locks', merge(locks), hair)
  const bangs = [hairLock([
    [-0.043, 0.612, 0.07, 0.038, 0.035], [-0.018, 0.54, 0.245, 0.10, 0.046],
    [-0.012, 0.455, 0.300, 0.086, 0.037], [0.031, 0.385, 0.324, 0.002, 0.002]
  ])]
  for (const s of [-1, 1]) bangs.push(hairLock([
    [s * 0.035, 0.592, 0.13, 0.038, 0.032], [s * 0.143, 0.514, 0.258, 0.079, 0.043],
    [s * 0.184, 0.435, 0.280, 0.067, 0.035], [s * 0.253, 0.342, 0.238, 0.002, 0.002]
  ]))
  mesh(head, 'bangs', merge(bangs), hair)
  mesh(torso, 'kimono', loft([
    [0, 0.142, 0, 0.078, 0.073], [0, 0.055, 0, 0.267, 0.116],
    [0, -0.10, 0, 0.175, 0.123], [0, -0.12, 0, 0.18, 0.122]
  ], 16, () => PALETTE.ivory), cloth)
  // 深後襬包住跪坐的腿；裙片不掛在腿上。
  mesh(hips, 'hakama', hakama(), cloth)
  mesh(torso, 'collar', merge([
    collarRibbon([-0.052, 0.13], [0.004, 0.035], 0.018, PALETTE.violet, 0.004),
    collarRibbon([0.052, 0.13], [-0.102, -0.105], 0.020, PALETTE.violet, 0.007),
    collarRibbon([0.076, 0.115], [-0.065, -0.105], 0.031, PALETTE.ivory, 0.011)
  ]), cloth)
  const belt = colored(new THREE.CylinderGeometry(0.185, 0.19, 0.03, 24), () => PALETTE.red)
  belt.scale(1, 1, 0.76)
  belt.translate(0, 0.06, 0)
  const waistBow = bow(1, true).translate(0, 0.059, 0.151)
  mesh(hips, 'waist-knot', merge([belt, waistBow]), red)

  const joints = { hips, torso, head }
  const anchors = {
    headTop: pivot(head, 'anchor-headTop', 0, 0.65, 0),
    forehead: pivot(head, 'anchor-forehead', 0, 0.48, 0.322),
    face: pivot(head, 'anchor-face', 0, 0.285, 0.285),
    hairR: pivot(head, 'anchor-hairR', -0.35, 0.405, 0.13),
    neck: pivot(torso, 'anchor-neck', 0, 0.105, 0)
  }
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const ear = pivot(head, `ear${side}`, s * 0.265, 0.535, -0.005)
    joints[`ear${side}`] = ear
    mesh(ear, `ear-${side.toLowerCase()}`, earGeometry(s), hair)
    const arm = pivot(torso, `arm${side}`, s * 0.33, 0.04, 0.025)
    joints[`arm${side}`] = arm
    mesh(arm, `sleeve-${side.toLowerCase()}`, sleeve(s), sleeveCloth)
    mesh(arm, `hand-${side.toLowerCase()}`, ellipsoid([0.049, 0.043, 0.043], [s * 0.026, -0.229, 0.047], 12, 8), skin)
    anchors[`hand${side}`] = pivot(arm, `anchor-hand${side}`, s * 0.026, -0.245, 0.077)
    const leg = pivot(hips, `leg${side}`, s * 0.103, 0, 0)
    joints[`leg${side}`] = leg
    mesh(leg, `sock-${side.toLowerCase()}`, colored(ellipsoid([0.049, 0.117, 0.05], [0, -0.125, 0], 12, 8), () => PALETTE.ivory), cloth)
    const shoe = colored(ellipsoid([0.075, 0.05, 0.07], [0, -0.25, 0.05], 14, 8), p => p.y < -0.281 ? '#c9b9b3' : PALETTE.ivory)
    const strap = loft([[0, -0.213, 0.03, 0.062, 0.018], [0, -0.208, 0.008, 0.063, 0.017]], 12, () => PALETTE.violet)
    mesh(leg, `shoe-${side.toLowerCase()}`, merge([shoe, strap]), cloth)
  }
  const tailPoints = [[0, 0.035, -0.115], [0.15, 0.055, -0.27], [0.30, 0.17, -0.40], [0.37, 0.33, -0.45], [0.35, 0.47, -0.425]]
  const radii = [0.037, 0.063, 0.081, 0.078, 0.003]
  const tailCurve = new THREE.CatmullRomCurve3(tailPoints.map(p => new THREE.Vector3(...p)))
  joints.tail = []
  let tailParent = hips
  for (let i = 0; i < 4; i++) {
    const a = new THREE.Vector3(...tailPoints[i])
    const origin = i ? a.clone().sub(new THREE.Vector3(...tailPoints[i - 1])) : a
    const t = pivot(tailParent, `tail-${i}`, ...origin.toArray())
    joints.tail.push(t)
    tailParent = t
  }
  // 連續表面綁到既有樞紐，不新增或挪動關節，也不自行播放動作。
  const tailMesh = new THREE.SkinnedMesh(tailSurface(tailCurve, radii), hair)
  tailMesh.name = 'tail-surface'
  tailMesh.castShadow = true
  tailMesh.receiveShadow = true
  tailMesh.frustumCulled = false
  hips.add(tailMesh)
  group.updateMatrixWorld(true)
  const tailSkeleton = new THREE.Skeleton(joints.tail)
  tailMesh.bind(tailSkeleton, tailMesh.matrixWorld)
  tailSkeleton.computeBoneTexture()
  ownedTextures.push(tailSkeleton.boneTexture)
  tailSkeleton.update()
  mesh(joints.tail[2], 'tail-bow', bow(0.90).translate(0.025, 0.015, 0.083), red)
  const clip = pivot(head, 'seasonal-sakura', 0.307, 0.467, 0.22)
  const clipMat = material(PALETTE.flower, { flatShading: true, roughness: 0.7 })
  const flower = sakura()
  mesh(clip, 'sakura', flower.petals, clipMat)
  mesh(clip, 'sakura-stamens', flower.stamens, cloth)
  const scarf = pivot(torso, 'winter-scarf', 0, 0.115, 0)
  const scarfRing = new THREE.TorusGeometry(0.12, 0.023, 6, 20)
  scarfRing.rotateX(Math.PI / 2)
  scarfRing.scale(1.25, 0.8, 1)
  const scarfEnd = new THREE.BoxGeometry(0.049, 0.105, 0.024)
  scarfEnd.rotateZ(-0.2)
  scarfEnd.translate(-0.059, -0.056, 0.135)
  mesh(scarf, 'scarf', merge([scarfRing, scarfEnd]), red)
  scarf.visible = false

  const inkMaterial = map => {
    const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, alphaTest: 0.008, toneMapped: false })
    ownedMaterials.push(m)
    return m
  }
  const makeTexture = (width, height, draw) => {
    const tex = raster(width, height, draw)
    ownedTextures.push(tex)
    return tex
  }
  const faces = {}
  for (const name of ['open', 'happy', 'closed', 'half']) faces[name] = makeTexture(512, 256, pen => drawEyes(pen, name))
  const eyes = mesh(head, 'eyes', facePatch(-0.253, 0.253, 0.205, 0.405, 24, 12), inkMaterial(faces.open))
  eyes.castShadow = false
  const mouths = {
    cat: makeTexture(192, 128, pen => drawMouth(pen, false)),
    open: makeTexture(192, 128, pen => drawMouth(pen, true))
  }
  const mouth = mesh(head, 'mouth', facePatch(-0.063, 0.063, 0.175, 0.239, 10, 6), inkMaterial(mouths.cat))
  mouth.castShadow = false
  const blushTexture = makeTexture(192, 96, pen => {
    pen.ellipse(0.5, 0.5, 0.46, 0.46, '#f394a9', 0.9, true)
    for (let i = 0; i < 3; i++) pen.line([[0.27 + i * 0.20, 0.36], [0.35 + i * 0.20, 0.62]], 0.022, '#e8879c', 0.72)
  })
  const blush = mesh(head, 'blush', merge([
    facePatch(-0.255, -0.135, 0.195, 0.254, 8, 4), facePatch(0.135, 0.255, 0.195, 0.254, 8, 4)
  ]), inkMaterial(blushTexture))
  blush.castShadow = false
  let faceName = 'open'
  let blushLevel = 0.4
  const applyBlush = () => { blush.material.opacity = faceName === 'shy' ? Math.max(0.88, blushLevel) : blushLevel }

  group.userData = {
    joints, anchors, scarf, ownedMaterials, ownedTextures,
    setFace(name) {
      faceName = name === 'shy' || faces[name] ? name : 'open'
      eyes.material.map = faces[faceName === 'shy' ? 'closed' : faceName]
      applyBlush()
    },
    setBlush(k) {
      blushLevel = unit(k)
      applyBlush()
    },
    setMouth(name) { mouth.material.map = mouths[name] || mouths.cat },
    setClip(color) { clipMat.color.set(color) },
    setClipVisible(on) { clip.visible = !!on },
    setNight(n) {
      const k = unit(n)
      skin.emissive.set(PALETTE.skin)
      skin.emissiveIntensity = k * 0.035
      hair.emissive.set(PALETTE.hair)
      hair.emissiveIntensity = k * 0.025
    }
  }
  applyBlush()
  group.userData.setNight(0)
  headMesh.userData.componentId = 'head'
  const parts = {}
  group.traverse(node => { if (node.isMesh) parts[node.name] = node })
  group.userData.sculptRuntime = { parts, pivots: joints, sockets: anchors }
  return group
}

function unit(n) {
  return Number.isFinite(n) ? THREE.MathUtils.clamp(n, 0, 1) : 0
}

function ellipsoid(scale, position, width = 16, height = 12) {
  const g = new THREE.SphereGeometry(1, width, height)
  g.scale(...scale)
  g.translate(...position)
  return g
}

function colored(g, colorAt) {
  const p = g.attributes.position
  const colors = []
  const color = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    color.set(colorAt(new THREE.Vector3().fromBufferAttribute(p, i), i))
    colors.push(color.r, color.g, color.b)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return g
}

// 橢圓截面沿中心線封閉放樣，不使用外部幾何或貼圖。
function loft(stations, radial = 12, colorAt = () => PALETTE.hair, sideHint = new THREE.Vector3(1, 0, 0), tangentAt) {
  const positions = []
  const colors = []
  const indices = []
  const color = new THREE.Color()
  for (let i = 0; i < stations.length; i++) {
    const [x, y, z, rx, rz] = stations[i]
    const a = new THREE.Vector3(...stations[Math.max(0, i - 1)].slice(0, 3))
    const b = new THREE.Vector3(...stations[Math.min(stations.length - 1, i + 1)].slice(0, 3))
    const tangent = tangentAt ? tangentAt(i / (stations.length - 1)) : b.sub(a).normalize()
    const side = sideHint.clone().addScaledVector(tangent, -sideHint.dot(tangent)).normalize()
    if (side.lengthSq() < 0.1) side.set(0, 0, 1)
    const depth = tangent.clone().cross(side).normalize()
    for (let j = 0; j < radial; j++) {
      const angle = j / radial * Math.PI * 2
      const p = new THREE.Vector3(x, y, z).addScaledVector(side, Math.cos(angle) * rx).addScaledVector(depth, Math.sin(angle) * rz)
      positions.push(...p.toArray())
      color.set(colorAt(p, i / (stations.length - 1), angle))
      colors.push(color.r, color.g, color.b)
      if (i) {
        const n = i * radial + j
        const next = i * radial + (j + 1) % radial
        indices.push(n - radial, next - radial, n, next - radial, next, n)
      }
    }
  }
  const startCenter = positions.length / 3
  for (const i of [0, stations.length - 1]) {
    positions.push(...stations[i].slice(0, 3))
    color.set(colorAt(new THREE.Vector3(...stations[i].slice(0, 3)), i / (stations.length - 1), 0))
    colors.push(color.r, color.g, color.b)
  }
  for (let j = 0; j < radial; j++) {
    indices.push(startCenter, (j + 1) % radial, j)
    const end = (stations.length - 1) * radial
    indices.push(startCenter + 1, end + j, end + (j + 1) % radial)
  }
  return geometry(positions, indices, colors)
}

function geometry(positions, indices, colors) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

function bobCap() {
  const p = []
  const indices = []
  const radial = 24
  const rings = 10
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2
      const end = 1.12 + 1.53 * THREE.MathUtils.smoothstep(-Math.cos(a), 0, 0.7)
      const phi = 0.008 + i / rings * end
      p.push(0.412 * Math.sin(phi) * Math.sin(a), 0.335 + 0.307 * Math.cos(phi), -0.008 + 0.315 * Math.sin(phi) * Math.cos(a))
      if (i && j) {
        const n = i * (radial + 1) + j
        indices.push(n - radial - 2, n - 1, n, n - radial - 2, n, n - radial - 1)
      }
    }
  }
  const cap = colored(geometry(p, indices), () => PALETTE.hair)
  // 接縫共用法線，頭頂不出現縱向亮暗線。
  const normals = cap.attributes.normal
  for (let i = 0; i <= rings; i++) {
    const first = i * (radial + 1)
    const last = first + radial
    const normal = new THREE.Vector3().fromBufferAttribute(normals, first).add(new THREE.Vector3().fromBufferAttribute(normals, last)).normalize()
    normals.setXYZ(first, ...normal.toArray())
    normals.setXYZ(last, ...normal.toArray())
  }
  return cap
}

// 鐘形薄殼袖口，後緣略垂，內外層以窄邊相連。
function sleeve(s) {
  const p = []
  const colors = []
  const indices = []
  const radial = 16
  const rings = 8
  const color = new THREE.Color()
  for (let layer = 0; layer < 2; layer++) {
    color.set(layer ? '#eadfd6' : PALETTE.ivory)
    for (let i = 0; i < rings; i++) {
      const t = Math.max(0, (i - 2) / (rings - 3))
      const rx = (i < 2 ? [0.012, 0.055][i] : 0.085 + 0.023 * t * t) - layer * 0.006
      const rz = (i < 2 ? [0.010, 0.045][i] : 0.068 + 0.024 * t * t) - layer * 0.006
      const height = i < 2 ? [0.05, 0.039][i] : 0.012 - 0.208 * t
      for (let j = 0; j < radial; j++) {
        const a = j / radial * Math.PI * 2
        const drape = 0.019 * (1 - Math.sin(a)) * t ** 3
        p.push(s * (-0.012 + 0.037 * t) + Math.cos(a) * rx, height - drape, 0.04 * t + Math.sin(a) * rz)
        colors.push(color.r, color.g, color.b)
        if (i) {
          const n = layer * rings * radial + i * radial + j
          const next = layer * rings * radial + i * radial + (j + 1) % radial
          const faces = [n - radial, next - radial, n, next - radial, next, n]
          if (layer) for (let k = 0; k < faces.length; k += 3) [faces[k + 1], faces[k + 2]] = [faces[k + 2], faces[k + 1]]
          indices.push(...faces)
        }
      }
    }
  }
  for (const i of [0, rings - 1]) for (let j = 0; j < radial; j++) {
    const a = i * radial + j
    const b = i * radial + (j + 1) % radial
    const offset = rings * radial
    const faces = [a, a + offset, b, b, a + offset, b + offset]
    if (!i) for (let k = 0; k < faces.length; k += 3) [faces[k + 1], faces[k + 2]] = [faces[k + 2], faces[k + 1]]
    indices.push(...faces)
  }
  const center = p.length / 3
  p.push(-s * 0.012, 0.05, 0)
  color.set(PALETTE.ivory)
  colors.push(color.r, color.g, color.b)
  for (let j = 0; j < radial; j++) indices.push(center, (j + 1) % radial, j)
  return geometry(p, indices, colors)
}

function tailSurface(curve, radii) {
  const bands = [[0.20, 0.31], [0.46, 0.57], [0.72, 0.83]]
  const samples = [...new Set([...Array.from({ length: 65 }, (_, i) => i / 64), ...bands.flat()])].sort((a, b) => a - b)
  const stations = samples.map(u => {
    const v = u * 4
    const k = Math.min(2, Math.floor(v))
    const r = v > 3 ? radii[3] * Math.sqrt(Math.max(0.001, 1 - (v - 3) ** 2))
      : THREE.MathUtils.lerp(radii[k], radii[k + 1], THREE.MathUtils.smoothstep(v - k, 0, 1))
    return [...curve.getPoint(u).toArray(), r, r]
  })
  const g = loft(stations, 12, () => PALETTE.hair, new THREE.Vector3(1, 0, 0), t => {
    const i = Math.min(samples.length - 1, Math.round(t * (samples.length - 1)))
    return curve.getTangent(samples[i])
  })
  const skinIndices = []
  const skinWeights = []
  const parameters = [...samples.flatMap(u => Array(12).fill(u)), 0, 1]
  for (const u of parameters) {
    const v = Math.min(3, u * 4)
    const a = Math.min(2, Math.floor(v))
    const weight = THREE.MathUtils.smoothstep(v - a, 0, 1)
    skinIndices.push(a, a + 1, 0, 0)
    skinWeights.push(1 - weight, weight, 0, 0)
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))
  const painted = g.toNonIndexed()
  const color = new THREE.Color()
  for (let i = 0; i < g.index.count; i += 3) {
    const u = (parameters[g.index.getX(i)] + parameters[g.index.getX(i + 1)] + parameters[g.index.getX(i + 2)]) / 3
    color.set(bands.some(([a, b]) => u > a && u < b) ? PALETTE.stripe : PALETTE.hair)
    for (let j = 0; j < 3; j++) painted.attributes.color.setXYZ(i + j, color.r, color.g, color.b)
  }
  g.dispose()
  return painted
}

function hakama() {
  const stations = [[0, 0.067, 0, 0.181, 0.131], [0, 0.015, -0.085, 0.28, 0.32], [0, -0.14, -0.065, 0.292, 0.31]]
  const g = loft(stations, 48, (p, u, a) => Math.cos(a * 12) > 0 ? PALETTE.violet : '#a491c7', new THREE.Vector3(1, 0, 0), () => new THREE.Vector3(0, -1, 0))
  const p = g.attributes.position
  for (let i = 0; i < stations.length * 48; i++) {
    const j = i % 48
    const factor = j % 4 === 2 ? 0.89 : 1
    p.setX(i, p.getX(i) * factor)
    p.setZ(i, p.getZ(i) * factor)
  }
  g.computeVertexNormals()
  return g
}

function earGeometry(s) {
  const points = [[-0.13, -0.025, 0.052], [0.07, 0.215, 0.003], [0.145, -0.036, 0.035], [0, 0.05, -0.07]]
  const pos = points.flatMap(([x, y, z]) => [s * x, y, z])
  const idx = [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]
  if (s < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]
  const outer = colored(geometry(pos, idx), () => PALETTE.hair)
  const inner = polygon([[-0.09, 0.002], [0.068, 0.174], [0.106, -0.005]], 0.002, PALETTE.inner)
  const p = inner.attributes.position
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, p.getZ(i) + 0.0405 - p.getX(i) * 0.0677 - p.getY(i) * 0.1477)
  }
  const tuft = polygon([[-0.045, 0.007], [-0.053, 0.042], [-0.023, 0.052], [-0.033, 0.075], [0.004, 0.067], [0.038, 0.04], [0.02, 0.007]], 0.002, PALETTE.ivory)
  const tp = tuft.attributes.position
  for (let i = 0; i < tp.count; i++) tp.setZ(i, tp.getZ(i) + 0.044 - tp.getX(i) * 0.0677 - tp.getY(i) * 0.1477)
  const bands = []
  // 藤紫條紋沿外耳折成 V，正面內耳覆在條紋上方。
  for (const y of [0.083, 0.145]) for (const pair of [[0, 1, 3], [1, 2, 3], [0, 2, 1]]) for (const half of [-1, 1]) {
    let vertices = pair.map(i => new THREE.Vector3(...points[i]))
    const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize()
    const fields = [v => half * (v.x - 0.02), ...[-1, 1].map(sign => v => sign * (v.y - 0.50 * Math.abs(v.x - 0.02) - y) - 0.012)]
    for (const field of fields) {
      const input = vertices
      vertices = []
      for (let i = 0; i < input.length; i++) {
        const a = input[i]
        const b = input[(i + 1) % input.length]
        const da = field(a)
        const db = field(b)
        if (da <= 0) vertices.push(a)
        if ((da <= 0) !== (db <= 0)) vertices.push(a.clone().lerp(b, da / (da - db)))
      }
    }
    const faces = []
    for (let i = 1; i < vertices.length - 1; i++) faces.push(0, i, i + 1)
    bands.push(colored(geometry(vertices.flatMap(v => v.addScaledVector(normal, 0.0015).toArray()), faces), () => PALETTE.stripe))
  }
  if (s < 0) {
    for (const g of [inner, tuft, ...bands]) {
      g.scale(-1, 1, 1)
      if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i))
      const index = g.index
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i + 1)
        index.setX(i + 1, index.getX(i + 2))
        index.setX(i + 2, a)
      }
      g.computeVertexNormals()
    }
  }
  return merge([outer, inner, tuft, ...bands])
}

function merge(geometries) {
  const values = { position: [], normal: [], color: [], uv: [] }
  const sizes = { position: 3, normal: 3, color: 3, uv: 2 }
  for (const source of geometries) {
    const g = source.index ? source.toNonIndexed() : source
    const count = g.attributes.position.count
    for (const name of Object.keys(values)) {
      const attribute = g.attributes[name]
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < sizes[name]; j++) values[name].push(attribute ? attribute.array[i * sizes[name] + j] : name === 'color' ? 1 : 0)
      }
    }
    if (g !== source) g.dispose()
    source.dispose()
  }
  const merged = new THREE.BufferGeometry()
  for (const name of Object.keys(values)) merged.setAttribute(name, new THREE.Float32BufferAttribute(values[name], sizes[name]))
  return merged
}

function polygon(points, depth, color) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 3 })
  return colored(g, () => color)
}

function hairLock(controls, side = new THREE.Vector3(1, 0, 0), tabby = false) {
  const curve = new THREE.CatmullRomCurve3(controls.map(p => new THREE.Vector3(...p.slice(0, 3))))
  const stations = []
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    const v = t * (controls.length - 1)
    const k = Math.min(controls.length - 2, Math.floor(v))
    const f = v - k
    stations.push([...curve.getPoint(t).toArray(), THREE.MathUtils.lerp(controls[k][3], controls[k + 1][3], f), THREE.MathUtils.lerp(controls[k][4], controls[k + 1][4], f)])
  }
  const lock = loft(stations, 8, () => PALETTE.hair, side)
  if (!tabby) return lock
  const marks = []
  for (const center of [0.27, 0.36, 0.45]) {
    const vertices = []
    const indices = []
    for (let j = 0; j <= 8; j++) {
      const a = -Math.PI / 2 + j / 8 * Math.PI
      for (const edge of [-1, 1]) {
        const y = center + Math.abs(Math.sin(a)) * 0.047 + edge * 0.013
        let lo = 0
        let hi = 1
        for (let k = 0; k < 16; k++) {
          const mid = (lo + hi) / 2
          if (curve.getPoint(mid).y > y) lo = mid
          else hi = mid
        }
        const t = (lo + hi) / 2
        const v = curve.getPoint(t)
        const tangent = curve.getTangent(t)
        const across = side.clone().addScaledVector(tangent, -side.dot(tangent)).normalize()
        const outward = tangent.clone().cross(across).normalize()
        const u = t * (controls.length - 1)
        const k = Math.min(controls.length - 2, Math.floor(u))
        const width = THREE.MathUtils.lerp(controls[k][3], controls[k + 1][3], u - k)
        const depth = THREE.MathUtils.lerp(controls[k][4], controls[k + 1][4], u - k)
        v.addScaledVector(across, Math.sin(a) * (width + 0.0015)).addScaledVector(outward, Math.cos(a) * (depth + 0.0015))
        vertices.push(...v.toArray())
      }
      if (j) {
        const n = j * 2
        indices.push(n - 2, n, n + 1, n - 2, n + 1, n - 1)
      }
    }
    const mark = colored(geometry(vertices, indices), () => PALETTE.stripe)
    marks.push(mark)
  }
  return merge([lock, ...marks])
}

function bow(scale, drape = false) {
  const pieces = []
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape()
    shape.moveTo(s * 0.005, 0)
    shape.bezierCurveTo(s * 0.04, 0.034, s * 0.09, 0.043, s * 0.081, 0.003)
    shape.bezierCurveTo(s * 0.083, -0.03, s * 0.04, -0.025, s * 0.005, 0)
    const hole = new THREE.Path()
    hole.moveTo(s * 0.027, 0)
    hole.quadraticCurveTo(s * 0.069, -0.016, s * 0.068, 0.011)
    hole.quadraticCurveTo(s * 0.06, 0.025, s * 0.027, 0)
    shape.holes.push(hole)
    pieces.push(colored(new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.003, bevelThickness: 0.003, curveSegments: 4 }), () => PALETTE.red))
    if (drape) {
      const levels = [-0.008, -0.03, -0.044, -0.065, -0.087]
      for (let i = 0; i < levels.length - 1; i++) {
        const a = levels[i]
        const b = levels[i + 1]
        const center = y => s * (0.014 + (-y - 0.008) * 0.25)
        const g = polygon([[center(a) - 0.01, a], [center(a) + 0.01, a], [center(b) + 0.01, b], [center(b) - 0.01, b]], 0.013, PALETTE.red)
        pieces.push(g)
      }
    } else pieces.push(polygon([[s * 0.006, -0.007], [s * 0.024, -0.009], [s * 0.046, -0.087], [s * 0.023, -0.082]], 0.013, PALETTE.red))
  }
  pieces.push(colored(ellipsoid([0.019, 0.02, 0.016], [0, 0, 0.013], 8, 6), () => PALETTE.red))
  const g = merge(pieces)
  if (drape) {
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.059
      const front = y > 0.015 ? THREE.MathUtils.lerp(0.131, 0.235, (0.067 - y) / 0.052) : THREE.MathUtils.lerp(0.235, 0.245, (0.015 - y) / 0.155)
      p.setZ(i, p.getZ(i) + Math.max(0, front - 0.151 + 0.015))
    }
    g.computeVertexNormals()
  }
  g.scale(scale, scale, scale)
  return g
}

function sakura() {
  const pieces = []
  const stamens = []
  for (let i = 0; i < 5; i++) {
    const g = polygon([[-0.012, 0], [-0.031, 0.032], [-0.027, 0.058], [-0.01, 0.068], [0, 0.058], [0.012, 0.069], [0.03, 0.055], [0.03, 0.028], [0.01, 0]], 0.016, '#ffffff')
    g.rotateZ(i * Math.PI * 2 / 5)
    pieces.push(g)
    const a = i * Math.PI * 2 / 5
    stamens.push(colored(ellipsoid([0.007, 0.007, 0.007], [-Math.sin(a) * 0.018, Math.cos(a) * 0.018, 0.026], 6, 4), () => PALETTE.ivory))
  }
  return { petals: merge(pieces), stamens: merge(stamens) }
}

function collarRibbon(start, end, width, color, offset) {
  const p = []
  const idx = []
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  for (let i = 0; i <= 12; i++) {
    for (const s of [-1, 1]) {
      const x = THREE.MathUtils.lerp(start[0], end[0], i / 12) - s * dy / length * width / 2
      const y = THREE.MathUtils.lerp(start[1], end[1], i / 12) + s * dx / length * width / 2
      const upper = y > 0.055
      const t = upper ? THREE.MathUtils.clamp((0.142 - y) / 0.087, 0, 1) : THREE.MathUtils.clamp((0.055 - y) / 0.155, 0, 1)
      const rx = upper ? THREE.MathUtils.lerp(0.078, 0.267, t) : THREE.MathUtils.lerp(0.267, 0.175, t)
      const rz = upper ? THREE.MathUtils.lerp(0.073, 0.116, t) : THREE.MathUtils.lerp(0.116, 0.123, t)
      const z = rz * Math.sqrt(Math.max(0.005, 1 - (x / rx) ** 2)) + offset
      p.push(x, y, z)
    }
    if (i) {
      const n = i * 2
      idx.push(n - 2, n + 1, n - 1, n - 2, n, n + 1)
    }
  }
  return colored(geometry(p, idx), () => color)
}

function facePatch(x0, x1, y0, y1, columns, rows) {
  const p = []
  const uv = []
  const idx = []
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const px = THREE.MathUtils.lerp(x0, x1, x / columns)
    const py = THREE.MathUtils.lerp(y0, y1, y / rows)
    const z = 0.047 + 0.263 * Math.sqrt(Math.max(0.001, 1 - (px / 0.328) ** 2 - ((py - 0.33) / 0.29) ** 2)) + 0.003
    p.push(px, py, z)
    uv.push(x / columns, y / rows)
    if (x && y) {
      const n = y * (columns + 1) + x
      idx.push(n - columns - 2, n - columns - 1, n, n - columns - 2, n, n - 1)
    }
  }
  const g = geometry(p, idx)
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return g
}

// 可在 Node 與瀏覽器共用的臉部點陣，避免 DOM 或外部貼圖依賴。
function raster(width, height, draw) {
  const data = new Uint8Array(width * height * 4)
  const rgb = color => Array.isArray(color) ? color : [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
  const blend = (x, y, color, alpha) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const k = (y * width + x) * 4
    const old = data[k + 3] / 255
    const a = Math.min(1, Math.max(0, alpha))
    const total = a + old * (1 - a)
    if (!total) return
    const c = rgb(color)
    for (let j = 0; j < 3; j++) data[k + j] = (c[j] * a + data[k + j] * old * (1 - a)) / total
    data[k + 3] = total * 255
  }
  const ellipse = (cx, cy, rx, ry, color, opacity = 1, soft = false, clipTop = 1) => {
    const edge = 1 / Math.min(rx * width, ry * height)
    for (let y = Math.max(0, Math.floor((cy - ry) * height) - 1); y < Math.min(height, Math.ceil((cy + ry) * height) + 1, clipTop * height); y++) {
      for (let x = Math.max(0, Math.floor((cx - rx) * width) - 1); x < Math.min(width, Math.ceil((cx + rx) * width) + 1); x++) {
        const d = Math.hypot(((x + 0.5) / width - cx) / rx, ((y + 0.5) / height - cy) / ry)
        const a = soft ? Math.max(0, 1 - d * d) : THREE.MathUtils.clamp((1 - d) / edge + 0.5, 0, 1)
        if (a) blend(x, y, typeof color === 'function' ? color((y + 0.5) / height) : color, a * opacity)
      }
    }
  }
  const line = (points, thickness, color, opacity = 1) => {
    const radius = thickness * height / 2
    for (let i = 1; i < points.length; i++) {
      const ax = points[i - 1][0] * width
      const ay = points[i - 1][1] * height
      const bx = points[i][0] * width
      const by = points[i][1] * height
      const dx = bx - ax
      const dy = by - ay
      for (let y = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1)); y < Math.min(height, Math.ceil(Math.max(ay, by) + radius + 1)); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1)); x < Math.min(width, Math.ceil(Math.max(ax, bx) + radius + 1)); x++) {
          const t = THREE.MathUtils.clamp(((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1)
          const d = Math.hypot(x + 0.5 - ax - t * dx, y + 0.5 - ay - t * dy)
          const a = THREE.MathUtils.clamp(radius + 0.5 - d, 0, 1)
          if (a) blend(x, y, color, a * opacity)
        }
      }
    }
  }
  draw({ ellipse, line })
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

function arc(cx, cy, rx, ry, start, end, steps = 20) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = start + (end - start) * i / steps
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]
  })
}

function drawEyes(pen, name) {
  for (const cx of [0.24, 0.76]) {
    const ink = '#685057'
    pen.line(arc(cx, 0.88, 0.105, 0.045, 0.3, Math.PI - 0.3), 0.018, '#b7a0ad')
    if (name === 'happy') {
      pen.line([[cx - 0.115, 0.43], [cx - 0.071, 0.62], [cx, 0.71], [cx + 0.07, 0.62], [cx + 0.113, 0.43]], 0.044, ink)
      continue
    }
    if (name === 'closed') {
      pen.line(arc(cx, 0.58, 0.12, 0.10, Math.PI * 1.1, Math.PI * 1.9), 0.036, ink)
      continue
    }
    const half = name === 'half'
    const top = half ? 0.54 : 1
    pen.ellipse(cx, 0.51, 0.145, 0.362, ink, 1, false, top)
    pen.ellipse(cx, 0.493, 0.13, 0.33, '#fff9ef', 1, false, top - (half ? 0.018 : 0))
    const irisY = half ? 0.374 : 0.47
    pen.ellipse(cx, irisY, 0.095, half ? 0.247 : 0.30, y => {
      const f = THREE.MathUtils.clamp((y - 0.17) / 0.60, 0, 1)
      return [190 - f * 90, 154 - f * 78, 220 - f * 88]
    }, 1, false, top - (half ? 0.022 : 0))
    pen.ellipse(cx, irisY + 0.025, 0.035, half ? 0.115 : 0.139, '#70568c', 1, false, top - 0.026)
    pen.ellipse(cx + 0.013, irisY - 0.19, 0.040, 0.062, '#d1a8e2', 0.8)
    pen.ellipse(cx - 0.026, half ? 0.47 : 0.652, 0.021, 0.043, '#ffffff')
    pen.ellipse(cx + 0.046, half ? 0.296 : 0.34, 0.01, 0.019, '#fff8fb', 0.85)
    if (half) pen.line([[cx - 0.143, 0.55], [cx + 0.142, 0.53]], 0.045, ink)
    else pen.line(arc(cx, 0.51, 0.143, 0.35, 0.15, Math.PI - 0.15), 0.038, ink)
  }
}

function drawMouth(pen, open) {
  pen.line([[0.474, 0.91], [0.5, 0.88], [0.527, 0.91]], 0.024, '#eab1ad')
  if (open) {
    pen.ellipse(0.5, 0.40, 0.242, 0.32, '#ae716d')
    pen.ellipse(0.5, 0.40, 0.21, 0.27, '#e98d93')
    pen.ellipse(0.5, 0.25, 0.155, 0.106, '#ffb8bd')
  } else {
    pen.line([[0.17, 0.55], ...arc(0.34, 0.55, 0.17, 0.19, Math.PI, Math.PI * 2), ...arc(0.67, 0.55, 0.17, 0.19, Math.PI, Math.PI * 2)], 0.044, '#a66f69')
  }
}
