import * as THREE from 'three'

const TAU = Math.PI * 2

// 靜態零件按材質合併，暖簾與熱氣保留動態節點
function batch(parent, name, material) {
  const positions = []
  const normals = []
  const colors = []
  const transform = new THREE.Object3D()
  const normalMatrix = new THREE.Matrix3()
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  return {
    add(geometry, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], color = '#ffffff') {
      transform.position.fromArray(position)
      transform.scale.fromArray(scale)
      transform.rotation.set(...rotation)
      transform.updateMatrix()
      normalMatrix.getNormalMatrix(transform.matrix)
      const tint = new THREE.Color(color)
      const source = geometry.index ? geometry.toNonIndexed() : geometry
      for (let i = 0; i < source.attributes.position.count; i++) {
        point.fromBufferAttribute(source.attributes.position, i).applyMatrix4(transform.matrix)
        normal.fromBufferAttribute(source.attributes.normal, i).applyMatrix3(normalMatrix).normalize()
        positions.push(point.x, point.y, point.z)
        normals.push(normal.x, normal.y, normal.z)
        colors.push(tint.r, tint.g, tint.b)
      }
      if (source !== geometry) source.dispose()
      geometry.dispose()
    },
    finish() {
      if (!positions.length) return null
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = name
      mesh.castShadow = true
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    },
  }
}

function box(target, x, y, z, w, h, d, color) {
  target.add(new THREE.BoxGeometry(w, h, d), [x, y, z], [1, 1, 1], [0, 0, 0], color)
}

function beam(target, a, b, width, depth, color) {
  const start = new THREE.Vector3(...a)
  const end = new THREE.Vector3(...b)
  const direction = end.clone().sub(start)
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()))
  target.add(new THREE.BoxGeometry(width, direction.length(), depth), start.add(end).multiplyScalar(0.5).toArray(), [1, 1, 1], [rotation.x, rotation.y, rotation.z], color)
}

function profile(points, depth) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: false, curveSegments: 8 })
}

function tube(target, points, radius, color, segments = 12) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
  target.add(new THREE.TubeGeometry(curve, segments, radius, 5, false), [0, 0, 0], [1, 1, 1], [0, 0, 0], color)
}

function curvedRoof(target, halfWidth, halfDepth, base, rise, curved, color) {
  const roofY = x => base + (curved ? rise * Math.exp(-(((x / halfWidth) * 2.05) ** 2)) + 0.065 * (Math.abs(x) / halfWidth) ** 8 : rise * (1 - Math.abs(x) / halfWidth))
  const outline = []
  for (let i = 0; i <= 24; i++) {
    const x = -halfWidth + i * halfWidth / 12
    outline.push([x, roofY(x)])
  }
  const strip = [...outline, ...outline.slice().reverse().map(([x, y]) => [x, y - 0.055])]
  target.add(profile(strip, halfDepth * 2), [0, 0, -halfDepth], [1, 1, 1], [0, 0, 0], color)
  return { roofY, outline }
}

export function buildBathhouse(stage = 1) {
  const level = THREE.MathUtils.clamp(Math.floor(Number.isFinite(stage) ? stage : 1), 1, 5)
  const group = new THREE.Group()
  group.name = `bathhouse-stage-${level}`
  const ownedMaterials = []
  const material = (options = {}) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, ...options })
    ownedMaterials.push(m)
    return m
  }
  const timber = material()
  const plaster = material({ roughness: 0.97 })
  const slate = material({ roughness: 0.82 })
  const stone = material({ flatShading: true, roughness: 0.96 })
  const water = material({ roughness: 0.2, metalness: 0.03 })
  const clothMaterial = material({ roughness: 1, side: THREE.DoubleSide })
  const white = material({ roughness: 0.85 })
  const paper = material({ roughness: 0.8, emissive: '#ffbf65', emissiveIntensity: 0 })
  const brick = material({ roughness: 0.96 })
  const bamboo = material({ roughness: 0.9 })
  const foliage = material({ flatShading: true, roughness: 0.96 })
  const s = [null,
    { w: 0.59, d: 0.43, wall: 0, eave: 0, rise: 0, roofW: 0, roofD: 0, norenY: 1.05, frontZ: 0.1, chimney: 0 },
    { w: 0.6, d: 0.47, wall: 0.96, eave: 1.02, rise: 0.38, roofW: 0.76, roofD: 0.63, norenY: 0.93, frontZ: 0.53, chimney: 0 },
    { w: 0.78, d: 0.58, wall: 1.12, eave: 1.23, rise: 0.38, roofW: 0.98, roofD: 0.75, norenY: 1.06, frontZ: 0.64, chimney: 1.98 },
    { w: 0.75, d: 0.61, wall: 1.27, eave: 1.36, rise: 0.43, roofW: 0.94, roofD: 0.77, norenY: 1.2, frontZ: 0.68, chimney: 2.34 },
    { w: 0.88, d: 0.66, wall: 1.31, eave: 1.42, rise: 0.45, roofW: 1.1, roofD: 0.84, norenY: 1.24, frontZ: 0.73, chimney: 2.85 },
  ][level]
  const foundation = batch(group, 'foundation', stone)
  if (level === 1) {
    box(foundation, 0, 0.07, 0.3, 1.18, 0.14, 0.68, '#a9b2b0')
  } else {
    box(foundation, 0, 0.07, 0, s.w * 2 + 0.1, 0.14, s.d * 2 + 0.09, '#aeb4b2')
    box(foundation, 0, 0.035, s.d + 0.19, 0.83, 0.07, 0.3, '#c6c5b7')
    box(foundation, 0, 0.1, s.d + 0.07, 0.9, 0.09, 0.23, '#d3cdbb')
  }
  foundation.finish()
  const frame = batch(group, 'timber-frame', timber)
  const walls = batch(group, 'hall-shell', plaster)
  const upperWalls = batch(group, 'upper-gable', plaster)
  const roof = batch(group, 'roof-system', slate)
  const fascia = batch(group, 'curved-fascia', timber)
  let roofForm = null
  if (level === 1) {
    for (const x of [-0.54, 0.54]) box(frame, x, 0.56, 0.1, 0.075, 1.12, 0.075, '#b88a5f')
    box(frame, 0, 1.055, 0.1, 1.2, 0.07, 0.09, '#c89d6b')
    for (const x of [-0.44, 0.44]) for (const z of [0.6, 0.68]) box(frame, x, 0.105, z, 0.055, 0.21, 0.055, '#9e774e')
    box(frame, 0, 0.23, 0.64, 0.98, 0.065, 0.16, '#cda273')
  } else {
    box(walls, 0, (s.wall + 0.14) / 2, 0, s.w * 2, s.wall - 0.14, s.d * 2, '#e7d3ac')
    roofForm = curvedRoof(roof, s.roofW, s.roofD, s.eave, s.rise, level >= 3, '#6b7e94')
    const frontFill = [[-s.w, s.wall - 0.02], ...roofForm.outline.filter(([x]) => Math.abs(x) <= s.w).map(([x, y]) => [x, y - 0.07]), [s.w, s.wall - 0.02]]
    for (const z of [-s.d, s.d]) walls.add(profile(frontFill, 0.045), [0, 0, z - 0.02], [1, 1, 1], [0, 0, 0], '#dec392')
    for (const z of [-s.roofD - 0.01, s.roofD - 0.025]) {
      const edge = [...roofForm.outline.map(([x, y]) => [x, y - 0.045]), ...roofForm.outline.slice().reverse().map(([x, y]) => [x, y - 0.13])]
      fascia.add(profile(edge, 0.045), [0, 0, z], [1, 1, 1], [0, 0, 0], '#c39a67')
    }
    if (level === 5) {
      box(upperWalls, 0, 1.77, -0.1, 1.38, 0.56, 1.02, '#e7d4ad')
      curvedRoof(roof, 0.87, 0.66, 2.03, 0.46, false, '#63778e')
      for (const z of [-0.76, 0.53]) {
        upperWalls.add(profile([[-0.71, 2.02], [0, 2.46], [0.71, 2.02]], 0.035), [0, 0, z], [1, 1, 1], [0, 0, 0], '#eadab7')
        for (const side of [-1, 1]) beam(fascia, [0, 2.49, z + 0.035], [side * 0.86, 2.03, z + 0.035], 0.065, 0.065, '#c69e6c')
      }
      const mountain = batch(group, 'mountain-relief', slate)
      mountain.add(profile([[-0.49, 2.06], [-0.23, 2.17], [-0.08, 2.23], [0.05, 2.38], [0.18, 2.2], [0.36, 2.13], [0.49, 2.06]], 0.02), [0, 0, 0.575], [1, 1, 1], [0, 0, 0], '#7f9eb7')
      mountain.finish()
      const snow = batch(group, 'mountain-snowcap', white)
      snow.add(profile([[-0.08, 2.23], [0.05, 2.38], [0.18, 2.2], [0.1, 2.24], [0.08, 2.2], [0.01, 2.27], [-0.03, 2.23]], 0.014), [0, 0, 0.598], [1, 1, 1], [0, 0, 0], '#f3ead8')
      snow.finish()
    }
  }
  walls.finish()
  upperWalls.finish()
  roof.finish()
  fascia.finish()
  if (level >= 2) {
    const openings = batch(group, 'window-system', paper)
    const joinery = batch(group, 'window-lattice', timber)
    const recess = batch(group, 'entrance-recess', timber)
    box(recess, 0, 0.58, s.d + 0.013, 0.76, 0.87, 0.032, '#705e46')
    for (const x of [-s.w + 0.045, -0.43, 0.43, s.w - 0.045]) {
      for (const z of [-s.d - 0.008, s.d + 0.035]) {
        box(frame, x, (s.wall + 0.14) / 2, z, 0.066, s.wall - 0.11, 0.078, '#ba8d5f')
        box(frame, x, 0.2, z, 0.09, 0.13, 0.1, '#ad8156')
      }
    }
    for (const side of [-1, 1]) {
      const x = side * (s.w + 0.012)
      for (const y of [0.32, s.wall - 0.05]) box(frame, x, y, 0, 0.075, 0.065, s.d * 2 + 0.08, '#be9667')
      for (const z of [-s.d + 0.14, 0, s.d - 0.14]) box(frame, x, (s.wall + 0.14) / 2, z, 0.075, s.wall - 0.1, 0.055, '#bf9465')
      box(openings, side * (s.w + 0.018), 0.76, -0.04, 0.026, 0.4, s.d * 1.25, '#f1d9a4')
      for (let i = 0; i < 6; i++) box(joinery, side * (s.w + 0.038), 0.76, -s.d * 0.625 - 0.04 + i * s.d * 0.25, 0.035, 0.43, 0.018, '#ae8457')
      for (const y of [0.56, 0.76, 0.96]) box(joinery, side * (s.w + 0.04), y, -0.04, 0.035, 0.023, s.d * 1.3, '#bc9465')
      for (const x of [-0.57, 0.57]) {
        if (Math.abs(x) > s.w - 0.1) continue
        box(openings, x, 0.63, s.d + 0.025, 0.2, 0.48, 0.026, '#ebd49e')
        for (const dx of [-0.1, 0, 0.1]) box(joinery, x + dx, 0.63, s.d + 0.05, 0.018, 0.5, 0.027, '#b58d5f')
        for (const y of [0.39, 0.63, 0.87]) box(joinery, x, y, s.d + 0.052, 0.22, 0.022, 0.027, '#b58d5f')
      }
    }
    for (const z of [-s.d - 0.035, s.d + 0.05]) {
      box(frame, 0, s.wall - 0.02, z, s.w * 2 + 0.09, 0.085, 0.09, '#c69b68')
      box(frame, 0, 0.32, z, s.w * 2, 0.065, 0.09, '#bd9161')
    }
    box(frame, 0, s.norenY + 0.04, s.frontZ + 0.04, 0.94, 0.055, 0.065, '#d0ab78')
    for (const x of [-0.4, 0.4]) box(frame, x, 0.54, s.d + 0.06, 0.048, 0.82, 0.055, '#c6a06c')
    if (level === 5) {
      for (const x of [-0.59, -0.3, 0.3, 0.59]) {
        box(openings, x, 1.88, 0.424, 0.2, 0.22, 0.026, '#f4db9c')
        for (const dx of [-0.1, 0, 0.1]) box(joinery, x + dx, 1.88, 0.45, 0.016, 0.25, 0.025, '#ad8456')
      }
      for (const y of [1.75, 2.01]) box(frame, 0, y, 0.45, 1.42, 0.055, 0.06, '#c09864')
    }
    openings.finish()
    joinery.finish()
    recess.finish()
  }
  frame.finish()
  if (roofForm) {
    const tiles = batch(group, 'roof-tiles', slate)
    for (let row = 1; row <= 7; row++) {
      const x = s.roofW * row / 8
      for (const side of [-1, 1]) box(tiles, x * side, roofForm.roofY(x) + 0.014, 0, 0.017, 0.018, s.roofD * 2 - 0.02, row % 2 ? '#6a7d91' : '#75899b')
    }
    for (let col = 0; col <= 10; col++) {
      const z = -s.roofD + 0.025 + col * (s.roofD * 2 - 0.05) / 10
      for (const side of [-1, 1]) {
        const points = []
        for (let i = 0; i <= 8; i++) {
          const x = s.roofW * i / 8
          points.push([x * side, roofForm.roofY(x) + 0.018, z])
        }
        tube(tiles, points, 0.009, col % 2 ? '#70859b' : '#7e90a1', 12)
      }
    }
    beam(tiles, [0, s.eave + s.rise + 0.035, -s.roofD], [0, s.eave + s.rise + 0.035, s.roofD], 0.065, 0.065, '#526a82')
    for (const z of [-s.roofD - 0.012, s.roofD + 0.012]) {
      tiles.add(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 8), [0, s.eave + s.rise + 0.038, z], [1, 1, 1], [Math.PI / 2, 0, 0], '#61768c')
      for (const side of [-1, 1]) tiles.add(new THREE.SphereGeometry(0.035, 7, 5), [side * s.roofW, roofForm.roofY(s.roofW) + 0.024, z], [1, 1, 1], [0, 0, 0], '#62788d')
    }
    if (level === 5) {
      for (let col = 0; col <= 8; col++) {
        const z = -0.635 + col * 0.159
        for (const side of [-1, 1]) beam(tiles, [0, 2.505, z], [side * 0.86, 2.05, z], 0.016, 0.02, '#7a8fa1')
      }
      for (let row = 1; row <= 5; row++) {
        const x = row * 0.145
        for (const side of [-1, 1]) box(tiles, side * x, 2.03 + 0.46 * (1 - x / 0.87) + 0.014, 0, 0.02, 0.02, 1.3, '#71869b')
      }
      beam(tiles, [0, 2.52, -0.69], [0, 2.52, 0.68], 0.07, 0.07, '#5a7088')
    }
    tiles.finish()
  }
  if (level >= 3) {
    const chimney = batch(group, 'chimney', brick)
    const x = level === 5 ? 0.64 : 0.55
    const base = s.eave - 0.1
    box(chimney, x, (base + s.chimney) / 2, -0.43, 0.19, s.chimney - base, 0.19, '#b48666')
    box(chimney, x, s.chimney, -0.43, 0.245, 0.07, 0.245, '#bd9578')
    box(chimney, x, s.chimney + 0.036, -0.43, 0.16, 0.004, 0.16, '#6f6962')
    chimney.finish()
  }
  const poolX = level === 5 ? 1.18 : level === 4 ? 1.07 : 0
  const poolZ = level >= 4 ? 0.08 : 0.3
  const poolW = level === 5 ? 0.48 : level === 4 ? 0.44 : 1.03
  const poolD = level >= 4 ? 0.86 : 0.5
  if (level === 1 || level >= 4) {
    const rim = batch(group, 'pool-stones', stone)
    box(rim, poolX, 0.1, poolZ - poolD / 2, poolW + 0.16, 0.2, 0.14, '#a3afac')
    box(rim, poolX, 0.1, poolZ + poolD / 2, poolW + 0.16, 0.2, 0.14, '#aab4af')
    for (const side of [-1, 1]) box(rim, poolX + side * (poolW / 2 + 0.03), 0.1, poolZ, 0.14, 0.2, poolD, '#acb6ae')
    rim.finish()
    const bath = batch(group, 'pool-water', water)
    box(bath, poolX, 0.155, poolZ, poolW - 0.065, 0.018, poolD - 0.09, '#82d3d1')
    bath.finish()
    const stones = batch(group, 'pool-rock-rim', stone)
    for (let i = 0; i < (level === 1 ? 7 : 6); i++) {
      const f = i / (level === 1 ? 6 : 5)
      for (const side of [-1, 1]) {
        const x = level === 1 ? -0.51 + f * 1.02 : poolX + side * (poolW / 2 + 0.017)
        const z = level === 1 ? poolZ + side * poolD / 2 : poolZ - poolD / 2 + f * poolD
        stones.add(new THREE.IcosahedronGeometry(1, 0), [x, 0.155, z], level === 1 ? [0.105, 0.095, 0.08] : [0.075, 0.1, 0.105], [0, i * 0.73, 0], ['#abb6ae', '#bac1b5', '#97a79e'][i % 3])
      }
    }
    stones.finish()
    const ripples = batch(group, 'water-ripples', white)
    for (const [x, z] of [[poolX - 0.055, poolZ - 0.12], [poolX + 0.04, poolZ + 0.13]]) {
      for (const radius of [0.055, 0.09]) ripples.add(new THREE.TorusGeometry(radius, 0.0035, 3, 16), [x, 0.168, z], [1, 1, 0.6], [Math.PI / 2, 0, 0], '#cfefdf')
    }
    ripples.finish()
  }
  if (level >= 4) {
    const fence = batch(group, 'fence', bamboo)
    const outside = poolX + poolW / 2 + 0.1
    for (let i = 0; i < 10; i++) {
      const z = poolZ - 0.48 + i * 0.108
      fence.add(new THREE.CylinderGeometry(0.021, 0.025, 0.64 + (i % 3) * 0.025, 6), [outside, 0.38, z], [1, 1, 1], [0, 0, 0], i % 2 ? '#b5bc82' : '#9eac72')
      for (const y of [0.24, 0.5]) fence.add(new THREE.CylinderGeometry(0.026, 0.026, 0.018, 6), [outside, y, z], [1, 1, 1], [0, 0, 0], '#859566')
    }
    for (const y of [0.28, 0.6]) beam(fence, [outside, y, poolZ - 0.53], [outside, y, poolZ + 0.53], 0.032, 0.035, '#bdc58c')
    fence.finish()
  }
  const surface = batch(group, 'surface-joinery', timber)
  const brickCourses = batch(group, 'brick-courses', brick)
  if (level >= 3) {
    const x = level === 5 ? 0.64 : 0.55
    for (let y = s.eave + 0.03, row = 0; y < s.chimney - 0.06; y += 0.094, row++) {
      for (const side of [-1, 1]) {
        box(brickCourses, x, y, -0.43 + side * 0.097, 0.194, 0.012, 0.005, '#c59e7e')
        box(brickCourses, x + side * 0.097, y, -0.43, 0.005, 0.012, 0.194, '#c59e7e')
        box(brickCourses, x + (row % 2 ? -0.035 : 0.035), y + 0.045, -0.43 + side * 0.098, 0.009, 0.082, 0.005, '#c8a184')
        box(brickCourses, x + side * 0.098, y + 0.045, -0.43 + (row % 2 ? 0.035 : -0.035), 0.005, 0.082, 0.009, '#c8a184')
      }
    }
    const ornament = batch(group, 'gable-ornament', timber)
    const cy = s.eave + s.rise - 0.16
    for (const x of [-0.07, 0, 0.07]) ornament.add(new THREE.TorusGeometry(0.038, 0.009, 4, 9), [x, cy - Math.abs(x) * 0.6, s.roofD + 0.028], [1, 0.75, 1], [0, 0, 0], '#cba776')
    ornament.finish()
  }
  brickCourses.finish()
  if (level >= 2) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const x = side * (0.47 + i * 0.09)
        if (Math.abs(x) < s.w - 0.03) box(surface, x, 0.26, s.d + 0.061, 0.005, 0.11, 0.004, '#a27a52')
      }
    }
  }
  const bucketX = level === 1 ? -0.43 : -s.w + 0.14
  const bucketZ = level === 1 ? -0.02 : s.d + 0.1
  surface.add(new THREE.CylinderGeometry(0.075, 0.06, 0.11, 10), [bucketX, 0.235, bucketZ], [1, 1, 1], [0, 0, 0], '#c49b68')
  surface.add(new THREE.CylinderGeometry(0.062, 0.062, 0.003, 10), [bucketX, 0.292, bucketZ], [1, 1, 1], [0, 0, 0], '#796950')
  for (const y of [0.204, 0.267]) surface.add(new THREE.TorusGeometry(y < 0.22 ? 0.065 : 0.072, 0.005, 3, 10), [bucketX, y, bucketZ], [1, 1, 1], [Math.PI / 2, 0, 0], '#9c8058')
  surface.finish()
  if (level >= 2) {
    const yard = batch(group, 'garden-stones', stone)
    const leaves = batch(group, 'garden-foliage', foliage)
    const x = -s.w - 0.085
    for (let i = 0; i < 4; i++) {
      const z = -0.34 + i * 0.22
      yard.add(new THREE.IcosahedronGeometry(1, 0), [x, 0.085, z], [0.12, 0.085, 0.13], [0, i, 0], i % 2 ? '#b5bcb0' : '#9daaa0')
      leaves.add(new THREE.IcosahedronGeometry(1, 0), [x - 0.015, 0.16 + (i % 2) * 0.025, z], [0.11, 0.12, 0.13], [0, i * 0.7, 0], ['#8caa78', '#779b70', '#a5b77d'][i % 3])
    }
    yard.finish()
    leaves.finish()
  }
  const lampFrames = batch(group, 'lantern-caps', timber)
  const lampPaper = batch(group, 'lantern-paper', paper)
  const lamp = (x, y, z, hanging = true) => {
    const height = level === 1 ? 0.135 : 0.17
    const points = [[0.035, -height / 2], [0.055, -height * 0.35], [0.062, 0], [0.055, height * 0.35], [0.035, height / 2]].map(([r, h]) => new THREE.Vector2(r, h))
    lampPaper.add(new THREE.LatheGeometry(points, 8), [x, y, z], [1, 1, 1], [0, 0, 0], '#ffe3a0')
    for (const sign of [-1, 1]) lampFrames.add(new THREE.CylinderGeometry(0.042, 0.042, 0.022, 8), [x, y + sign * (height / 2 + 0.007), z], [1, 1, 1], [0, 0, 0], '#827356')
    if (hanging) box(lampFrames, x, y + height / 2 + 0.055, z, 0.013, 0.09, 0.013, '#877456')
    for (const dy of [-0.034, 0.034]) lampFrames.add(new THREE.TorusGeometry(0.06, 0.003, 3, 8), [x, y + dy, z], [1, 1, 1], [Math.PI / 2, 0, 0], '#d3b988')
  }
  if (level === 1) {
    box(lampFrames, 0.69, 0.35, 0.08, 0.042, 0.7, 0.042, '#ab8b5d')
    lamp(0.69, 0.73, 0.08, false)
    lampFrames.add(new THREE.ConeGeometry(0.105, 0.055, 4), [0.69, 0.845, 0.08], [1, 1, 1], [0, Math.PI / 4, 0], '#75817e')
  } else {
    for (const side of [-1, 1]) {
      const x = side * Math.min(s.w - 0.035, 0.59)
      lamp(x, s.norenY - 0.085, s.frontZ + 0.1)
      beam(lampFrames, [x, s.norenY + 0.03, s.d], [x, s.norenY + 0.03, s.frontZ + 0.1], 0.025, 0.027, '#8c7755')
    }
    if (level === 5) {
      for (const side of [-1, 1]) {
        const x = side * (s.w + 0.095)
        tube(lampFrames, [[x, 1.44, -0.58], [x, 1.37, -0.2], [x, 1.37, 0.2], [x, 1.44, 0.6]], 0.008, '#806f51')
        for (const z of [-0.48, -0.16, 0.16, 0.48]) lamp(x, 1.23 + Math.abs(z) * 0.08, z)
      }
    }
  }
  lampFrames.finish()
  lampPaper.finish()
  const noren = new THREE.Group()
  noren.name = 'noren-pivot'
  noren.position.set(0, s.norenY, s.frontZ + 0.035)
  group.add(noren)
  const panels = batch(noren, 'noren', clothMaterial)
  const curtainW = level === 1 ? 0.86 : 0.78
  for (let i = 0; i < 3; i++) box(panels, (i - 1) * curtainW / 3, -0.205, 0, curtainW / 3 - 0.012, 0.41, 0.016, i === 1 ? '#384e79' : '#3f567f')
  panels.finish()
  const icon = batch(noren, 'steam-pictogram', white)
  for (let i = -1; i <= 1; i++) {
    const x = i * 0.053
    tube(icon, [[x - 0.01, -0.265, 0.016], [x + 0.012, -0.21, 0.018], [x - 0.012, -0.157, 0.018], [x + 0.008, -0.105, 0.016]], 0.009, '#f7eedc', 10)
  }
  tube(icon, [[-0.115, -0.24, 0.018], [-0.095, -0.292, 0.018], [0, -0.31, 0.018], [0.095, -0.292, 0.018], [0.115, -0.24, 0.018]], 0.009, '#f7eedc')
  icon.finish()
  const puffs = []
  const smokeGeometry = new THREE.SphereGeometry(1, 10, 7)
  const addSteam = (source, rise, maxRadius, count, speed) => {
    for (let i = 0; i < count; i++) {
      const steamMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { opacity: { value: 0 } },
        vertexShader: 'varying vec3 vNormal; varying vec3 vView; void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vNormal = normalize(normalMatrix * normal); vView = -p.xyz; gl_Position = projectionMatrix * p; }',
        fragmentShader: 'uniform float opacity; varying vec3 vNormal; varying vec3 vView; void main() { float facing = max(0.0, dot(normalize(vNormal), normalize(vView))); gl_FragColor = vec4(vec3(0.98, 0.985, 1.0), opacity * pow(facing, 1.5));\n #include <tonemapping_fragment>\n #include <colorspace_fragment>\n }',
      })
      ownedMaterials.push(steamMaterial)
      const puff = new THREE.Mesh(smokeGeometry, steamMaterial)
      puff.name = `steam-${puffs.length}`
      puff.position.fromArray(source)
      puff.scale.setScalar(0.001)
      puff.castShadow = false
      puff.receiveShadow = false
      puff.renderOrder = 2
      group.add(puff)
      puffs.push({ puff, source, rise, maxRadius, phase: i / count, speed })
    }
  }
  if (level === 1) addSteam([0, 0.21, 0.3], 0.34, 0.075, 3, 0.23)
  else if (level === 2) addSteam([0.25, 1.42, -0.12], 0.2, 0.07, 3, 0.2)
  else addSteam([level === 5 ? 0.64 : 0.55, s.chimney + 0.045, -0.43], [0, 0, 0, 0.21, 0.35, 0.46][level], [0, 0, 0, 0.085, 0.105, 0.14][level], 4, 0.2)
  if (level >= 4) addSteam([poolX, 0.21, poolZ], 0.46, 0.09, 3, 0.24)
  group.userData.front = new THREE.Vector3(0, 0, level === 1 ? 1.07 : s.frontZ + 0.385)
  group.userData.top = new THREE.Vector3(0, [0, 1.48, 2.05, 2.66, 3.23, 3.88][level], 0)
  group.userData.ownedMaterials = ownedMaterials
  group.userData.ownedTextures = []
  group.userData.anim = (t, dt, { night = 0 } = {}) => {
    const time = Number.isFinite(t) ? t : 0
    const n = night === true ? 1 : Number.isFinite(night) ? THREE.MathUtils.clamp(night, 0, 1) : 0
    noren.rotation.x = Math.sin(time * 1.7) * 0.035
    noren.rotation.z = Math.sin(time * 1.1) * 0.012
    paper.emissiveIntensity = n * 0.72
    for (let i = 0; i < puffs.length; i++) {
      const { puff, source, rise, maxRadius, phase, speed } = puffs[i]
      const k = ((time * speed + phase) % 1 + 1) % 1
      const radius = 0.025 + k * (maxRadius - 0.025)
      puff.position.set(source[0] + Math.sin(time * 0.7 + i) * k * 0.035, source[1] + k * rise, source[2] - k * 0.04)
      puff.scale.set(radius, radius * 0.8, radius * 0.9)
      puff.material.uniforms.opacity.value = Math.sin(k * Math.PI) * (level === 5 && source[1] > 1 ? 0.63 : 0.4)
      puff.visible = k > 0.015 && k < 0.99
    }
  }
  if (level === 1 || level >= 4) {
    const bathAssembly = new THREE.Group()
    bathAssembly.name = 'pool-system'
    group.add(bathAssembly)
    for (const name of ['pool-stones', 'pool-water', 'pool-rock-rim', 'water-ripples', 'fence']) {
      const part = group.getObjectByName(name)
      if (part) bathAssembly.add(part)
    }
  }
  const nodes = {}
  const meshes = {}
  group.traverse(object => {
    if (object.name) nodes[object.name] = object
    if (object.isMesh) meshes[object.name] = object
  })
  const sockets = {}
  for (const key of ['front', 'top']) {
    const socket = new THREE.Object3D()
    socket.name = `${key}-socket`
    socket.position.copy(group.userData[key])
    group.add(socket)
    sockets[key] = socket
  }
  group.userData.sculptRuntime = {
    nodes,
    meshes,
    sockets,
    colliders: level === 1 ? [{ id: 'footbath', type: 'box', center: [0, 0.12, 0.3], size: [1.18, 0.24, 0.68] }] : [{ id: 'hall', type: 'box', center: [0, s.wall / 2, 0], size: [s.w * 2, s.wall, s.d * 2] }],
    destructionGroups: { hall: ['hall-shell', 'timber-frame', 'window-system', 'window-lattice'], roof: ['roof-system', 'roof-tiles', 'curved-fascia', 'mountain-relief'], bath: ['pool-stones', 'pool-water', 'pool-rock-rim', 'fence'], entrance: ['noren', 'steam-pictogram', 'lantern-paper', 'lantern-caps'] },
    inferredRegions: ['rear wall and rear roof ornament follow front timber grammar; concealed interior omitted'],
  }
  group.userData.anim(0, 0, { night: 0, hour: 12 })
  return group
}
