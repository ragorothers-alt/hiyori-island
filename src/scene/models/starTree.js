import * as THREE from 'three'

const TAU = Math.PI * 2

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

// 沿曲線逐節收束，讓根部與分枝保有連續輪廓
function sweep(points, radii, segments = 24, sides = 8, flute = 0) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
  const frames = curve.computeFrenetFrames(segments, false)
  const positions = []
  const indices = []
  for (let i = 0; i <= segments; i++) {
    const u = i / segments
    const f = u * (radii.length - 1)
    const j = Math.min(Math.floor(f), radii.length - 2)
    const radius = THREE.MathUtils.lerp(radii[j], radii[j + 1], f - j)
    const center = curve.getPointAt(u)
    for (let k = 0; k < sides; k++) {
      const a = k / sides * TAU + u * 1.25
      const r = radius * (1 + Math.cos(k / sides * TAU * 5 + u * 5) * flute)
      const p = center.clone()
        .addScaledVector(frames.normals[i], Math.cos(a) * r)
        .addScaledVector(frames.binormals[i], Math.sin(a) * r)
      positions.push(p.x, p.y, p.z)
      if (i < segments) {
        const n = i * sides + k
        const next = i * sides + (k + 1) % sides
        indices.push(n, next, n + sides, next, next + sides, n + sides)
      }
    }
  }
  for (const end of [0, segments]) {
    const c = curve.getPointAt(end / segments)
    const index = positions.length / 3
    positions.push(c.x, c.y, c.z)
    for (let k = 0; k < sides; k++) {
      const a = end * sides + k
      const b = end * sides + (k + 1) % sides
      indices.push(index, ...(end ? [a, b] : [b, a]))
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// 共用封閉葉片，中央稜線在側光下仍能辨認
function crystalLeaf() {
  const outline = [[0, 0, 0], [-0.18, 0.25, 0], [-0.22, 0.52, 0], [-0.12, 0.78, 0], [0, 1, 0], [0.12, 0.78, 0], [0.22, 0.52, 0], [0.18, 0.25, 0]]
  const positions = []
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % outline.length]
    positions.push(...b, ...a, 0, 0.47, 0.12, ...a, ...b, 0, 0.47, -0.08)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  const colors = []
  const base = new THREE.Color('#eee4ff')
  const tip = new THREE.Color('#fff5ff')
  for (let i = 0; i < positions.length; i += 3) {
    const height = positions[i + 1]
    const highlight = THREE.MathUtils.smoothstep(height, 0.18, 1)
    const color = base.clone().lerp(tip, highlight * 0.88)
    color.toArray(colors, i)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geo
}

function islandRock() {
  const sides = 17
  const rings = [[-0.24, 3.15], [-0.85, 2.93], [-1.85, 2.4], [-3.1, 1.6], [-4.18, 0.85], [-4.95, 0.05]]
  const vertices = rings.map(([y, r]) => Array.from({ length: sides }, (_, i) => {
    const a = i / sides * TAU
    const radius = r * (1 + Math.cos(a * 3 + 0.4) * 0.025 + Math.sin(a * 5) * 0.012)
    return [Math.cos(a) * radius, y, Math.sin(a) * radius * 0.93]
  }))
  const positions = []
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const n = (i + 1) % sides
      positions.push(...vertices[j][i], ...vertices[j + 1][i], ...vertices[j][n])
      positions.push(...vertices[j][n], ...vertices[j + 1][i], ...vertices[j + 1][n])
    }
  }
  for (let i = 0; i < positions.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + 3 + k]
      positions[i + 3 + k] = positions[i + 6 + k]
      positions[i + 6 + k] = v
    }
  }
  for (let i = 0; i < sides; i++) {
    const n = (i + 1) % sides
    positions.push(0, -0.24, 0, ...vertices[0][n], ...vertices[0][i])
    positions.push(0, -5, 0, ...vertices[5][i], ...vertices[5][n])
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

function grassCap(random) {
  const positions = []
  const n = 32
  const edge = Array.from({ length: n }, (_, i) => {
    const a = i / n * TAU
    const r = 3.12 + random() * 0.08
    return [Math.cos(a) * r, -0.04 - random() * 0.035, Math.sin(a) * r * 0.96]
  })
  for (let i = 0; i < n; i++) {
    const a = edge[i]
    const b = edge[(i + 1) % n]
    positions.push(0, 0, 0, ...b, ...a)
    const lowA = [a[0] * 0.99, -0.3, a[2] * 0.99]
    const lowB = [b[0] * 0.99, -0.3, b[2] * 0.99]
    positions.push(...a, ...b, ...lowA, ...b, ...lowB, ...lowA)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

function starGeometry() {
  const outline = []
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i / 10 * TAU
    const r = i % 2 ? 0.43 : 1
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    outline.push([x, y, 0])
  }
  const positions = []
  for (let i = 0; i < 10; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % 10]
    positions.push(0, 0, 0.21, ...a, ...b, 0, 0, -0.13, ...b, ...a)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

export function buildStarTree() {
  const group = new THREE.Group()
  group.name = 'star-tree'
  const random = seeded(303013)
  const ownedMaterials = []
  const glowBase = 0.14
  const standard = (color, extra = {}) => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra })
    ownedMaterials.push(mat)
    return mat
  }
  const wood = standard('#edcee4', { roughness: 0.82, emissive: '#3f2f43', emissiveIntensity: glowBase })
  const fluteMat = standard('#ffe4f0', { roughness: 0.75, emissive: '#493749', emissiveIntensity: glowBase })
  const rockMat = standard('#ffffff', { flatShading: true, vertexColors: true, emissive: '#806b9c', emissiveIntensity: 0.18 })
  const turfMat = standard('#ffffff', { flatShading: true, vertexColors: true })
  // 封閉不透明葉片保留稜面，也避免冠層透明排序破圖
  const leafMat = standard('#ffffff', {
    roughness: 0.72, metalness: 0, flatShading: true, vertexColors: true,
    emissive: '#647caa', emissiveIntensity: glowBase,
  })
  const heartMat = standard('#c5dfff', { roughness: 0.82, flatShading: true, emissive: '#364a70', emissiveIntensity: glowBase })
  const gemMat = standard('#d6d1f6', { roughness: 0.25, flatShading: true, emissive: '#56508c', emissiveIntensity: glowBase })
  const leafMats = [leafMat, ...['#80609b', '#986b86'].map(emissive => standard('#ffffff', {
    roughness: 0.72, metalness: 0, flatShading: true, vertexColors: true,
    emissive, emissiveIntensity: glowBase,
  }))]
  for (const mat of leafMats) {
    mat.color.multiplyScalar(1.5)
    // 自發光也保留葉片與葉尖色差，夜間不糊成整塊白光
    mat.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb * 0.45;\n#endif')
    }
  }
  const heartMats = [heartMat,
    standard('#dfc7fb', { roughness: 0.82, flatShading: true, emissive: '#594069', emissiveIntensity: glowBase }),
    standard('#ffe0f2', { roughness: 0.82, flatShading: true, emissive: '#684c5f', emissiveIntensity: glowBase }),
  ]
  const paintFacets = (geometry, palette) => {
    const colors = []
    const color = new THREE.Color()
    const count = geometry.attributes.position.count
    for (let i = 0; i < count; i += 3) {
      color.set(palette[Math.floor(random() * palette.length)])
      for (let j = 0; j < 3; j++) color.toArray(colors, (i + j) * 3)
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return geometry
  }
  const add = (parent, name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const instance = (parent, name, geometry, material, count) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const island = new THREE.Group()
  island.name = 'island'
  group.add(island)
  add(island, 'island-rock', paintFacets(islandRock(), ['#d8c5ee', '#e6d1f5', '#f2e1fc', '#d4c7f0', '#eeddff']), rockMat)
  add(island, 'grass', paintFacets(grassCap(random), ['#c4dda9', '#bfd5a5', '#d1dfb1', '#b5d3ae']), turfMat)

  const tree = new THREE.Group()
  tree.name = 'wood'
  group.add(tree)
  const trunkPath = [[0, -0.1, 0], [0.42, 1.1, 0.08], [-0.22, 2.6, 0], [0.2, 4.2, -0.06], [-0.18, 5.6, -0.12], [0, 6.67, 0]]
  add(tree, 'trunk', sweep(trunkPath, [0.72, 0.55, 0.46, 0.33, 0.21, 0.04], 42, 12, 0.08), wood)
  const roots = new THREE.Group()
  roots.name = 'roots'
  tree.add(roots)
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU + 0.18
    const d = 1.6 + random() * 0.65
    const path = [[0.22, 0.95, 0], [Math.cos(a) * 0.65, 0.25, Math.sin(a) * 0.65], [Math.cos(a + 0.14) * 1.2, 0.09, Math.sin(a + 0.14) * 1.2], [Math.cos(a + 0.28) * d, 0.015, Math.sin(a + 0.28) * d]]
    add(roots, 'root-' + i, sweep(path, [0.32, 0.24, 0.13, 0.012], 16, 7), wood)
  }
  const flutes = new THREE.Group()
  flutes.name = 'bark-ridges'
  tree.add(flutes)
  const trunkCurve = new THREE.CatmullRomCurve3(trunkPath.map(p => new THREE.Vector3(...p)))
  for (let i = 0; i < 6; i++) {
    const path = []
    for (let j = 0; j <= 16; j++) {
      const u = j / 16
      const p = trunkCurve.getPointAt(u)
      const a = i / 6 * TAU + u * 4.8
      const radii = [0.72, 0.55, 0.46, 0.33, 0.21, 0.04]
      const f = Math.min(u * 5, 4.999)
      const index = Math.floor(f)
      const radius = THREE.MathUtils.lerp(radii[index], radii[index + 1], f - index) * 0.97
      p.x += Math.cos(a) * radius
      p.z += Math.sin(a) * radius
      path.push(p.toArray())
    }
    const flute = add(flutes, 'bark-flute-' + i, sweep(path, [0.13, 0.085, 0.045, 0.008], 32, 6), fluteMat)
    flute.userData.explodeWithParent = true
  }
  const crowns = [
    [0, 6.95, -0.1, 1.48],
    [-1.25, 6.62, -0.55, 1.25], [1.3, 6.75, -0.5, 1.22],
    [-2.45, 5.38, 0.1, 1.14], [2.42, 5.6, 0, 1.17],
    [-1.4, 5.95, 1.15, 1.1], [1.45, 6.14, 1.12, 1.1],
    [-1.8, 5.75, -1.1, 1.1], [1.85, 5.95, -1.05, 1.05],
    [-2.2, 4.42, -0.65, 0.92], [2.2, 4.62, -0.7, 0.92],
    [-0.65, 6.65, 1.05, 1.2], [0.8, 6.83, 0.95, 1.18],
  ]
  const branches = [
    [[-0.16, 2.65, 0], [-0.74, 3.5, 0.1], [-1.8, 4.35, 0.14], [-2.65, 4.9, 0.1], [-3.05, 5.04, 0.08]],
    [[-0.05, 2.95, -0.04], [0.8, 3.78, -0.08], [1.9, 4.55, -0.12], [2.7, 5.13, -0.12], [3.08, 5.27, -0.14]],
    [[0.1, 4.45, -0.06], [-0.38, 5.28, -0.46], [-1.02, 5.96, -0.82], [-1.75, 6.37, -0.98]],
    [[0.08, 4.7, -0.06], [0.56, 5.4, -0.38], [1.26, 6.05, -0.77], [1.9, 6.39, -0.92]],
    [[-1.35, 4.02, 0.13], [-1.43, 4.68, 0.6], [-1.25, 5.28, 1.08], [-1.68, 5.77, 1.35]],
    [[1.5, 4.27, -0.1], [1.5, 4.92, 0.45], [1.25, 5.58, 1.02], [1.75, 6.05, 1.3]],
    [[-0.76, 3.52, 0.1], [-1.45, 3.83, -0.34], [-2.13, 4.12, -0.72], [-2.67, 4.24, -0.82]],
    [[0.83, 3.81, -0.08], [1.55, 4.03, -0.44], [2.18, 4.33, -0.79], [2.7, 4.44, -0.88]],
  ]
  branches.forEach((path, i) => {
    const radii = i < 2 ? [0.34, 0.235, 0.135, 0.06, 0.012] : i < 4 ? [0.2, 0.13, 0.065, 0.012] : [0.14, 0.09, 0.045, 0.009]
    add(tree, 'branch-' + i, sweep(path, radii, 22, 8, 0.06), wood)
    const socket = new THREE.Object3D()
    socket.name = 'fork-' + i
    socket.position.set(...path[0])
    tree.add(socket)
  })
  // 細枝從外伸主枝分叉，末端藏進側冠
  const twigs = [
    [[-2.1, 4.56, 0.13], [-2.2, 4.96, 0.48], [-2.72, 5.35, 0.72]],
    [[2.2, 4.8, -0.12], [2.28, 5.22, 0.33], [2.77, 5.52, 0.62]],
    [[-0.56, 5.51, -0.57], [-0.6, 6.03, -0.1], [-0.9, 6.67, 0.3]],
    [[0.73, 5.58, -0.48], [0.65, 6.14, 0.03], [0.95, 6.8, 0.33]],
  ]
  twigs.forEach((path, i) => add(tree, 'twig-' + i, sweep(path, [0.085, 0.043, 0.008], 14, 6), wood))
  const crown = new THREE.Group()
  crown.name = 'crown'
  group.add(crown)
  const leafSystem = new THREE.Group()
  leafSystem.name = 'leaf-keels'
  crown.add(leafSystem)
  const leafGeometry = crystalLeaf()
  const dummy = new THREE.Object3D()
  const up = new THREE.Vector3(0, 1, 0)
  const direction = new THREE.Vector3()
  const heartGeometry = new THREE.IcosahedronGeometry(1, 1)
  const leafRandom = seeded(847231)
  crowns.forEach(([x, y, z, r], i) => {
    const core = add(crown, 'crystal-heart-' + i, heartGeometry, heartMats[i % 3])
    core.position.set(x, y, z)
    core.scale.set(r * 0.78, r * 0.5, r * 0.72)
    const leaves = new THREE.InstancedMesh(leafGeometry, leafMats[i % 3], 72)
    leaves.name = 'crystal-leaves-' + i
    leaves.position.set(x, y, z)
    for (let k = 0; k < 72; k++) {
      const layer = Math.floor(k / 18)
      const a = (k % 18) / 18 * TAU + layer * 0.28 + i * 0.9
      const elevation = [1.05, 0.38, -0.25, -0.85][layer] + (leafRandom() - 0.5) * 0.28
      direction.set(Math.cos(a) * Math.cos(elevation), Math.sin(elevation), Math.sin(a) * Math.cos(elevation))
      const length = r * (0.69 + leafRandom() * 0.2)
      dummy.position.copy(direction).multiplyScalar(r * (0.29 + leafRandom() * 0.11))
      dummy.position.y *= 0.65
      dummy.quaternion.setFromUnitVectors(up, direction)
      dummy.rotateY(leafRandom() * TAU)
      dummy.scale.set(length * (1.15 + leafRandom() * 0.3), length, length * 1.1)
      dummy.updateMatrix()
      leaves.setMatrixAt(k, dummy.matrix)
      const palette = i % 3 === 0 ? ['#b9dfff', '#d2eaff', '#dbccff'] : i % 3 === 1 ? ['#d6b9ff', '#e4ccff', '#c5dbff'] : ['#ffd2ed', '#ffedf8', '#ddc6ff']
      leaves.setColorAt(k, new THREE.Color(palette[(k + layer) % palette.length]))
    }
    leaves.instanceMatrix.needsUpdate = true
    leaves.instanceColor.needsUpdate = true
    leaves.castShadow = false
    leaves.receiveShadow = false
    leafSystem.add(leaves)
  })
  // 葉冠獨立亂數，維持島面花草與原版相同
  for (let i = 0; i < 486 * 4; i++) random()
  const fruit = new THREE.Group()
  fruit.name = 'star-fruit'
  tree.add(fruit)
  const gold = standard('#ffda83', { roughness: 0.62, emissive: '#a87328', emissiveIntensity: glowBase })
  const starHeart = standard('#fff0bd', { roughness: 0.65, emissive: '#a17b3e', emissiveIntensity: glowBase })
  const starGeo = starGeometry()
  const cordGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5)
  const starCount = 18
  const cordInstances = instance(fruit, 'star-cords', cordGeo, gold, starCount)
  const starInstances = instance(fruit, 'star-bodies', starGeo, gold, starCount)
  const heartInstances = instance(fruit, 'star-hearts', starGeo, starHeart, starCount)
  for (const mesh of [cordInstances, starInstances, heartInstances]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
  }
  const hangers = []
  const fruitRandom = seeded(63018)
  for (let i = 0; i < starCount; i++) {
    const path = i < 16 ? branches[i % 8] : trunkPath
    const curve = new THREE.CatmullRomCurve3(path.map(p => new THREE.Vector3(...p)))
    const anchor = curve.getPoint(i < 8 ? 0.92 : i < 16 ? 0.62 : i === 16 ? 0.84 : 0.99)
    const pivot = new THREE.Group()
    pivot.name = 'star-hanger-' + i
    pivot.position.copy(anchor)
    fruit.add(pivot)
    const length = 0.63 + fruitRandom() * 0.3
    dummy.position.set(0, -length / 2, 0)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(1, length, 1)
    dummy.updateMatrix()
    const cordMatrix = dummy.matrix.clone()
    const size = 0.29 + fruitRandom() * 0.075
    dummy.position.set(0, -length, 0)
    dummy.rotation.set(0, (fruitRandom() - 0.5) * 1.2, 0)
    dummy.scale.setScalar(size)
    dummy.updateMatrix()
    const starMatrix = dummy.matrix.clone()
    const inset = new THREE.Matrix4().makeScale(0.62, 0.62, 0.62)
    inset.setPosition(0, 0, 0.15)
    const heartMatrix = starMatrix.clone().multiply(inset)
    hangers.push({ pivot, cordMatrix, starMatrix, heartMatrix })
  }
  for (let i = 0; i < 12 * 3; i++) random()
  const vines = new THREE.Group()
  vines.name = 'vines'
  island.add(vines)
  const gemGeo = new THREE.OctahedronGeometry(1)
  const vineCrystals = instance(vines, 'vine-crystals', gemGeo, gemMat, 9)
  for (let i = 0; i < 9; i++) {
    const a = i / 8 * TAU + 0.2
    const x = i === 8 ? 0.13 : Math.cos(a) * (i % 3 === 0 ? 2.1 : 2.95)
    const z = i === 8 ? 0 : Math.sin(a) * (i % 3 === 0 ? 2.1 : 2.95) * 0.92
    const y = i === 8 ? -4.85 : i % 3 === 0 ? -2 : -0.25
    const length = i === 8 ? 0.27 : 0.8 + random() * 1.25
    const path = [[x, y, z], [x + 0.08, y - length * 0.45, z + 0.03], [x - 0.06, y - length, z + 0.04]]
    add(vines, 'glow-vine-' + i, sweep(path, [0.018, 0.011, 0.008], 10, 4), gold)
    dummy.position.set(x - 0.06, y - length - 0.13, z + 0.04)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(0.085, 0.19, 0.085)
    dummy.updateMatrix()
    vineCrystals.setMatrixAt(i, dummy.matrix)
  }

  const garden = new THREE.Group()
  garden.name = 'flowers'
  island.add(garden)
  const green = standard('#8fab94', { roughness: 0.88 })
  const petalsMat = standard('#ffffff', { roughness: 0.7, emissive: '#302637', emissiveIntensity: glowBase })
  const pebbleMat = standard('#ded9e7', { roughness: 0.84, flatShading: true })
  const setInstance = (mesh, i, position, scale, rotation = [0, 0, 0]) => {
    dummy.position.set(...position)
    dummy.rotation.set(...rotation)
    dummy.scale.set(...scale)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  const flowerCount = 44
  const petals = instance(garden, 'flower-petals', new THREE.SphereGeometry(1, 5, 3), petalsMat, flowerCount * 5)
  const centers = instance(garden, 'flower-centers', new THREE.IcosahedronGeometry(1, 0), gold, flowerCount)
  const stems = instance(garden, 'flower-stems', new THREE.CylinderGeometry(0.012, 0.015, 1, 4), green, flowerCount)
  const smallLeaves = instance(garden, 'flower-leaves', leafGeometry, green, flowerCount * 2)
  const flowerColors = ['#f19bb2', '#f4c1d5', '#faf2eb', '#f5dfae']
  for (let i = 0; i < flowerCount; i++) {
    const a = i * 2.39996
    const r = 1.2 + Math.sqrt(random()) * 1.65
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r * 0.94
    const height = 0.12 + random() * 0.12
    const size = 0.7 + random() * 0.55
    setInstance(stems, i, [x, height / 2 - 0.025, z], [1, height, 1])
    setInstance(centers, i, [x, height, z], [0.034 * size, 0.025 * size, 0.034 * size])
    for (let k = 0; k < 5; k++) {
      const b = k / 5 * TAU + a
      setInstance(petals, i * 5 + k, [x + Math.cos(b) * 0.057 * size, height, z + Math.sin(b) * 0.057 * size], [0.042 * size, 0.023 * size, 0.075 * size], [0, Math.PI / 2 - b, 0.1])
      petals.setColorAt(i * 5 + k, new THREE.Color(flowerColors[i % flowerColors.length]))
    }
    for (let k = 0; k < 2; k++) {
      const b = a + k * Math.PI
      dummy.position.set(x, 0.005, z)
      direction.set(Math.cos(b) * 0.7, 0.5, Math.sin(b) * 0.7).normalize()
      dummy.quaternion.setFromUnitVectors(up, direction)
      dummy.scale.set(0.24, 0.24, 0.18)
      dummy.updateMatrix()
      smallLeaves.setMatrixAt(i * 2 + k, dummy.matrix)
    }
  }
  const stones = instance(island, 'stones', new THREE.DodecahedronGeometry(1, 0), pebbleMat, 11)
  for (let i = 0; i < 11; i++) {
    const a = i * 2.39996 + 1.3
    const r = 1.8 + random() * 0.95
    const size = 0.11 + random() * 0.18
    setInstance(stones, i, [Math.cos(a) * r, size * 0.29, Math.sin(a) * r * 0.94], [size * 1.1, size * 0.75, size], [random(), random() * TAU, random() * 0.4])
  }
  const groundGems = instance(island, 'grass-crystals', gemGeo, gemMat, 7)
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU + 0.5
    const r = 1.5 + random() * 1.2
    setInstance(groundGems, i, [Math.cos(a) * r, 0.17, Math.sin(a) * r * 0.94], [0.12, 0.28 + random() * 0.14, 0.1], [0.18, a, 0.12])
  }
  const tuftGeo = new THREE.BufferGeometry()
  tuftGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.06, 0, 0, 0.02, 0.28, 0.01, 0.025, 0, 0,
    0, 0, -0.04, -0.07, 0.22, 0.02, 0, 0, 0.04,
    -0.02, 0, 0, 0.1, 0.2, -0.03, 0.05, 0, 0,
  ], 3))
  tuftGeo.computeVertexNormals()
  const tuftMat = standard('#a9c59c', { roughness: 0.9, side: THREE.DoubleSide })
  const tufts = instance(island, 'grass-tufts', tuftGeo, tuftMat, 64)
  for (let i = 0; i < 64; i++) {
    const a = i / 64 * TAU + random() * 0.08
    const r = 2.8 + random() * 0.25
    const size = 0.6 + random() * 0.6
    setInstance(tufts, i, [Math.cos(a) * r, -0.045, Math.sin(a) * r * 0.94], [size, size, size], [0, a, 0])
  }

  // 柔光直接畫在草地上，不增加場景燈光
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uNight: { value: 0 } },
    vertexShader: `varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform float uNight;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float ring = exp(-pow((r - 0.64) * 7.0, 2.0));
        float glow = 1.0 - smoothstep(0.0, 0.95, r);
        gl_FragColor = vec4(vec3(0.56, 0.58, 0.85), (glow * 0.1 + ring * 0.07) * (0.5 + uNight));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  ownedMaterials.push(haloMat)
  const halo = add(island, 'root-halo', new THREE.CircleGeometry(1.9, 48), haloMat)
  halo.rotation.x = -Math.PI / 2
  halo.position.y = 0.008
  halo.castShadow = false
  halo.receiveShadow = false

  const moteGeo = new THREE.BufferGeometry()
  const motePositions = []
  const phases = []
  const sizes = []
  for (let i = 0; i < 72; i++) {
    const a = random() * TAU
    const r = 0.6 + random() * 2.05
    motePositions.push(Math.cos(a) * r, 2.4 + random() * 5.7, Math.sin(a) * r * 0.8)
    phases.push(random())
    sizes.push(0.035 + random() * 0.045)
  }
  moteGeo.setAttribute('position', new THREE.Float32BufferAttribute(motePositions, 3))
  moteGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1))
  moteGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
  moteGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5.25, 0), 4.6)
  const moteMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
    vertexShader: `uniform float uTime;
      uniform float uNight;
      attribute float aPhase;
      attribute float aSize;
      varying float vFade;
      varying vec3 vColor;
      void main() {
        float f = fract(aPhase + uTime * 0.035);
        vec3 p = position;
        p.y = mix(2.4, 8.1, f);
        p.x += sin(uTime * 0.23 + aPhase * 30.0) * 0.13;
        p.z += cos(uTime * 0.18 + aPhase * 20.0) * 0.13;
        vFade = pow(sin(f * 3.14159265), 2.0) * (0.24 + uNight * 0.6);
        vColor = mix(vec3(0.62, 0.8, 1.0), vec3(1.0, 0.8, 0.46), step(0.7, aPhase));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * 1500.0 / -mv.z, 1.5, 6.5);
      }`,
    fragmentShader: `varying float vFade;
      varying vec3 vColor;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float r = length(p) * 2.0;
        float alpha = pow(max(0.0, 1.0 - r), 1.6) * vFade;
        gl_FragColor = vec4(vColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  ownedMaterials.push(moteMat)
  const motes = new THREE.Points(moteGeo, moteMat)
  motes.name = 'motes'
  group.add(motes)
  group.userData.ownedMaterials = ownedMaterials
  group.userData.ownedTextures = []
  group.userData.glow = { mats: [wood, fluteMat, ...leafMats, ...heartMats, gemMat, gold, starHeart, petalsMat], lights: [], base: glowBase }
  group.userData.sculptRuntime = {
    pivots: { island, wood: tree, crown, fruit },
    sockets: branches.map((_, i) => tree.getObjectByName('fork-' + i)),
    colliders: [
      { componentId: 'island', type: 'cylinder', radius: 3.2, height: 0.35, center: [0, -0.18, 0] },
      { componentId: 'wood', type: 'capsule', radius: 0.7, height: 5.4, center: [0, 2.7, 0] },
    ],
    destructionGroups: { terrain: ['island'], tree: ['wood'], foliage: ['crown'] },
  }
  const fruitMatrix = new THREE.Matrix4()
  // 只更新本地掛飾與光點；整座浮島的位置交由外層控制
  group.userData.anim = (t = 0, dt = 0, night = 0) => {
    const n = THREE.MathUtils.clamp(night, 0, 1)
    moteMat.uniforms.uTime.value = t
    moteMat.uniforms.uNight.value = n
    haloMat.uniforms.uNight.value = n
    for (let i = 0; i < hangers.length; i++) {
      const { pivot, cordMatrix, starMatrix, heartMatrix } = hangers[i]
      pivot.rotation.x = Math.sin(t * 0.55 + i * 1.7) * 0.045
      pivot.rotation.z = Math.sin(t * 0.65 + i * 2.2) * 0.065
      pivot.updateMatrix()
      cordInstances.setMatrixAt(i, fruitMatrix.multiplyMatrices(pivot.matrix, cordMatrix))
      starInstances.setMatrixAt(i, fruitMatrix.multiplyMatrices(pivot.matrix, starMatrix))
      heartInstances.setMatrixAt(i, fruitMatrix.multiplyMatrices(pivot.matrix, heartMatrix))
    }
    cordInstances.instanceMatrix.needsUpdate = true
    starInstances.instanceMatrix.needsUpdate = true
    heartInstances.instanceMatrix.needsUpdate = true
  }
  group.userData.anim(0, 0, 0)
  return group
}
