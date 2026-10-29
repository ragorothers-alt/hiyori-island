import * as THREE from 'three'

const TAU = Math.PI * 2

// 批次合併同材質零件，保留分件色差
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
      const p = source.attributes.position
      const n = source.attributes.normal
      for (let i = 0; i < p.count; i++) {
        point.fromBufferAttribute(p, i).applyMatrix4(transform.matrix)
        normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize()
        positions.push(point.x, point.y, point.z)
        normals.push(normal.x, normal.y, normal.z)
        colors.push(tint.r, tint.g, tint.b)
      }
      if (source !== geometry) source.dispose()
      geometry.dispose()
    },
    finish() {
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

function box(target, x, y, z, w, h, d, color, rotation = [0, 0, 0]) {
  target.add(new THREE.BoxGeometry(w, h, d), [x, y, z], [1, 1, 1], rotation, color)
}

function beam(target, a, b, width, depth, color) {
  const start = new THREE.Vector3(...a)
  const end = new THREE.Vector3(...b)
  const direction = end.clone().sub(start)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
  const r = new THREE.Euler().setFromQuaternion(q)
  target.add(new THREE.BoxGeometry(width, direction.length(), depth), start.add(end).multiplyScalar(0.5).toArray(), [1, 1, 1], [r.x, r.y, r.z], color)
}

function polygon(points, depth, bevel = 0) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: bevel > 0, bevelSegments: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 10 })
}

function arch(width, height, x = 0, y = 0, path = new THREE.Shape()) {
  const r = width / 2
  path.moveTo(x - r, y)
  path.lineTo(x + r, y)
  path.lineTo(x + r, y + height - r)
  path.absarc(x, y + height - r, r, 0, Math.PI, false)
  path.lineTo(x - r, y)
  return path
}

function log(target, a, b, y, side, axis, color) {
  if (b - a < 0.018) return
  const position = axis === 'x' ? [(a + b) / 2, y, side] : [side, y, (a + b) / 2]
  const rotation = axis === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]
  target.add(new THREE.CylinderGeometry(0.078, 0.078, b - a, 9, 1), position, [1, 1, 1], rotation, color)
}

export function buildCabin() {
  const group = new THREE.Group()
  group.name = 'mochi-cabin'
  const ownedMaterials = []
  const material = (options = {}) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, ...options })
    ownedMaterials.push(m)
    return m
  }
  const timber = material()
  const stone = material({ flatShading: true, roughness: 0.96 })
  const tile = material({ roughness: 0.9 })
  const trim = material({ roughness: 0.8 })
  const doorX = -0.3
  const doorY = 0.14
  const doorWidth = 0.62
  const doorHeight = 1
  const leafWidth = doorWidth - 0.016
  const leafHeight = doorHeight - 0.016
  const foundation = batch(group, 'foundation', stone)
  const stoneColors = ['#c5c0c9', '#ccc5c9', '#bbb8c3', '#d5cdc5']
  for (let course = 0; course < 2; course++) {
    const y = 0.018 + course * 0.07
    for (const front of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const x = -0.72 + i * 0.18
        foundation.add(new THREE.IcosahedronGeometry(1, 0), [x, y, front * 0.615], [0.135, 0.062, 0.098], [0.12 * Math.sin(i), i * 0.48 + course, 0.04], stoneColors[(i + course) % 4])
      }
    }
    for (const side of [-1, 1]) {
      for (let i = 1; i < 7; i++) {
        foundation.add(new THREE.IcosahedronGeometry(1, 0), [side * 0.745, y, -0.61 + i * 0.174], [0.105, 0.062, 0.13], [0, i * 0.5 + course, 0.13], stoneColors[(i + 2 * course) % 4])
      }
    }
  }
  foundation.finish()
  const wallGroup = new THREE.Group()
  wallGroup.name = 'walls'
  group.add(wallGroup)
  const walls = batch(wallGroup, 'front-logs', timber)
  const sides = batch(wallGroup, 'side-logs', timber)
  // 開口從圓木逐層切開，門內保留可通行的空間
  for (let i = 0; i < 8; i++) {
    const y = 0.22 + i * 0.14
    const color = ['#d7b18b', '#dcb991', '#d1aa80', '#debb94'][i % 4]
    const cuts = []
    if (y - 0.078 < doorY + doorHeight) {
      const h = Math.max(0, y - 0.078 - (doorY + doorHeight - doorWidth / 2))
      const half = Math.sqrt(Math.max(0, (doorWidth / 2) ** 2 - h ** 2))
      cuts.push([doorX - half, doorX + half])
    }
    if (y + 0.078 > 0.64 && y - 0.078 < 1.06) cuts.push([0.14, 0.58])
    let start = -0.825
    for (const [a, b] of cuts) {
      log(walls, start, a, y, 0.606, 'x', color)
      start = b
    }
    log(walls, start, 0.825, y, 0.606, 'x', color)
    log(walls, -0.825, 0.825, y, -0.606, 'x', color)
    for (const side of [-1, 1]) {
      const sy = y + 0.015
      if (sy + 0.078 > 0.67 && sy - 0.078 < 1.03) {
        log(sides, -0.69, -0.18, sy, side * 0.746, 'z', color)
        log(sides, 0.18, 0.69, sy, side * 0.746, 'z', color)
      } else log(sides, -0.69, 0.69, sy, side * 0.746, 'z', color)
    }
  }
  for (let i = 0; i < 4; i++) {
    const y = 1.34 + i * 0.14
    const half = Math.max(0.035, (1.85 - y - 0.06) / 0.64)
    for (const z of [-0.606, 0.606]) log(walls, -half, half, y, z, 'x', i % 2 ? '#dcb991' : '#d2ac84')
  }
  for (const z of [-0.58, 0.55]) walls.add(polygon([[-0.765, 1.205], [0.765, 1.205], [0, 1.84]], 0.025), [0, 0, z], [1, 1, 1], [0, 0, 0], '#c4a07b')
  walls.finish()
  sides.finish()
  const roof = batch(group, 'roof', tile)
  for (const side of [-1, 1]) {
    const shape = [[0, -0.82], [0.76, -0.82], [0.98, -0.64], [0.98, 0.64], [0.76, 0.82], [0, 0.82]]
    const geometry = polygon(shape, 0.055)
    const p = geometry.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const z = p.getY(i)
      const h = p.getZ(i)
      p.setXYZ(i, x * side, 1.87 - x * 0.64 + h, z)
    }
    if (side > 0) {
      const a = p.array
      for (let i = 0; i < a.length; i += 9) {
        for (let k = 0; k < 3; k++) [a[i + 3 + k], a[i + 6 + k]] = [a[i + 6 + k], a[i + 3 + k]]
      }
    }
    geometry.computeVertexNormals()
    roof.add(geometry, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#bb7e86')
  }
  roof.finish()
  const chimney = batch(group, 'chimney', stone)
  box(chimney, 0.43, 1.89, -0.36, 0.235, 0.46, 0.235, '#aaa3ac')
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      for (let j = 0; j < 2; j++) {
        const y = 1.706 + i * 0.108
        const shift = (j - 0.5) * 0.126
        chimney.add(polygon([[-0.056, -0.046], [0.051, -0.046], [0.057, 0.035], [0.038, 0.047], [-0.05, 0.046]], 0.025, 0.004), [0.43 + shift, y, -0.36 + side * 0.117], [1, 1, 1], [0, side < 0 ? Math.PI : 0, 0], stoneColors[(i + j) % 4])
        chimney.add(polygon([[-0.056, -0.046], [0.05, -0.046], [0.057, 0.035], [0.038, 0.047], [-0.05, 0.046]], 0.025, 0.004), [0.43 + side * 0.117, y, -0.36 + shift], [1, 1, 1], [0, side * Math.PI / 2, 0], stoneColors[(i + j + 1) % 4])
      }
    }
  }
  for (const side of [-1, 1]) {
    box(chimney, 0.43 + side * 0.124, 2.15, -0.36, 0.075, 0.09, 0.325, '#d5c9c1')
    box(chimney, 0.43, 2.15, -0.36 + side * 0.124, 0.175, 0.09, 0.075, '#d8cec6')
  }
  box(chimney, 0.43, 2.111, -0.36, 0.18, 0.008, 0.18, '#766c78')
  chimney.finish()
  const fascia = batch(group, 'fascia', trim)
  for (const z of [-0.82, 0.82]) {
    for (const side of [-1, 1]) beam(fascia, [0, 1.86, z], [side * 0.76, 1.37, z], 0.085, 0.065, '#f3dfb9')
  }
  fascia.finish()
  // 結構階段
  const endgrain = batch(group, 'endgrain', trim)
  for (let i = 0; i < 8; i++) {
    const y = 0.235 + i * 0.14
    for (const x of [-0.746, 0.746]) {
      for (const z of [-0.692, 0.692]) {
        endgrain.add(new THREE.CylinderGeometry(0.068, 0.068, 0.012, 9), [x, y, z], [1, 1, 1], [Math.PI / 2, 0, 0], '#e8c69b')
      }
    }
  }
  endgrain.finish()
  const doorFrame = batch(group, 'door-frame', trim)
  const frameShape = arch(doorWidth + 0.1, doorHeight + 0.1)
  frameShape.holes.push(arch(doorWidth, doorHeight, 0, 0.01, new THREE.Path()))
  doorFrame.add(new THREE.ExtrudeGeometry(frameShape, { depth: 0.065, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, curveSegments: 14 }), [doorX, doorY - 0.01, 0.67], [1, 1, 1], [0, 0, 0], '#efcf9f')
  doorFrame.finish()
  const doorPivot = new THREE.Group()
  doorPivot.name = 'door-hinge'
  // 鉸鏈略內縮，整段外開軌跡仍留在半徑 1.2 內
  doorPivot.position.set(doorX + leafWidth / 2, doorY + 0.004, 0.58)
  group.add(doorPivot)
  const doorLeaf = batch(doorPivot, 'door-leaf', timber)
  doorLeaf.add(new THREE.ExtrudeGeometry(arch(leafWidth, leafHeight, -leafWidth / 2), { depth: 0.038, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1, curveSegments: 14 }), [0, 0, -0.019], [1, 1, 1], [0, 0, 0], '#bd926e')
  doorLeaf.finish()
  const floor = batch(group, 'floor', timber)
  box(floor, 0, 0.11, 0, 1.47, 0.045, 1.18, '#a98772')
  floor.finish()
  const steps = batch(group, 'steps', timber)
  box(steps, doorX, 0.035, 0.89, 0.66, 0.07, 0.26, '#d5af83')
  box(steps, doorX, 0.105, 0.765, 0.72, 0.07, 0.24, '#e0be94')
  steps.finish()
  const paper = material({ emissive: '#ffbb61', emissiveIntensity: 0.08, roughness: 0.95 })
  const windows = []
  const windowFrames = []
  const makeWindow = (name, x, z, rotation, size) => {
    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(x, 0.85, z)
    pivot.rotation.y = rotation
    group.add(pivot)
    const pane = batch(pivot, `${name}-paper`, paper)
    box(pane, 0, 0, 0, size, size, 0.026, '#e9dcb9')
    const mesh = pane.finish()
    windows.push(mesh)
    const frames = batch(pivot, `${name}-frame`, timber)
    for (const s of [-1, 1]) {
      box(frames, s * (size / 2 + 0.022), 0, 0.008, 0.044, size + 0.09, 0.08, '#b58c6a')
      box(frames, 0, s * (size / 2 + 0.022), 0.012, size + 0.09, 0.044, 0.085, '#d2ac80')
    }
    const frameMesh = frames.finish()
    windowFrames.push({ pivot, size, frameMesh })
  }
  makeWindow('front-window', 0.36, 0.702, 0, 0.4)
  makeWindow('right-window', 0.828, 0, Math.PI / 2, 0.32)
  makeWindow('left-window', -0.828, 0, -Math.PI / 2, 0.32)
  // 形體階段
  const shingles = batch(group, 'shingles', tile)
  const roofY = x => 1.87 - Math.abs(x) * 0.64
  const roofZ = x => 0.82 - Math.max(0, x - 0.76) * 0.18 / 0.22
  for (const side of [-1, 1]) {
    for (let row = 0; row < 6; row++) {
      const a = Math.max(0, row * 0.1633 - 0.015)
      const b = Math.min(0.978, (row + 1) * 0.1633 + 0.014)
      for (let col = 0; col < 9; col++) {
        const z0 = -0.82 + col * 0.205 - (row % 2) * 0.1
        const z1 = z0 + 0.196
        const loA = Math.max(z0, -roofZ(a) + 0.005)
        const hiA = Math.min(z1, roofZ(a) - 0.005)
        const loB = Math.max(z0, -roofZ(b) + 0.005)
        const hiB = Math.min(z1, roofZ(b) - 0.005)
        if (loB >= hiB || loA >= hiA) continue
        const geometry = polygon([[a, loA], [b, loB], [b, hiB], [a, hiA]], 0.025, 0.003)
        const p = geometry.attributes.position
        const jitter = Math.sin(row * 7 + col * 3.2 + side) * 0.003
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i)
          const z = p.getY(i)
          const h = p.getZ(i)
          p.setXYZ(i, x * side, roofY(x) + 0.058 + h + jitter, z)
        }
        if (side > 0) {
          const array = p.array
          for (let i = 0; i < array.length; i += 9) {
            for (let k = 0; k < 3; k++) [array[i + 3 + k], array[i + 6 + k]] = [array[i + 6 + k], array[i + 3 + k]]
          }
        }
        geometry.computeVertexNormals()
        const palette = ['#be828a', '#c68d91', '#b77b86', '#cb9395', '#c18b89']
        shingles.add(geometry, [0, 0, 0], [1, 1, 1], [0, 0, 0], palette[(row * 3 + col + (side > 0 ? 2 : 0)) % palette.length])
      }
    }
  }
  const ridge = polygon([[-0.07, -0.81], [0.07, -0.81], [0.07, 0.81], [-0.07, 0.81]], 0.018, 0.003)
  const rp = ridge.attributes.position
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i)
    const z = rp.getY(i)
    const y = rp.getZ(i)
    rp.setXYZ(i, x, 1.949 - Math.abs(x) * 0.54 + y, z)
  }
  const ra = rp.array
  for (let i = 0; i < ra.length; i += 9) {
    for (let k = 0; k < 3; k++) [ra[i + 3 + k], ra[i + 6 + k]] = [ra[i + 6 + k], ra[i + 3 + k]]
  }
  ridge.computeVertexNormals()
  shingles.add(ridge, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#ae727f')
  shingles.finish()
  const eaves = batch(group, 'eaves', trim)
  for (const side of [-1, 1]) {
    beam(eaves, [side * 0.966, 1.247, -0.63], [side * 0.966, 1.247, 0.63], 0.055, 0.07, '#efdbb5')
    for (const front of [-1, 1]) beam(eaves, [side * 0.75, 1.382, front * 0.8], [side * 0.966, 1.247, front * 0.63], 0.075, 0.065, '#f2deb8')
    for (const z of [-0.48, 0, 0.48]) beam(eaves, [side * 0.77, 1.08, z], [side * 0.91, 1.24, z], 0.047, 0.05, '#bd9874')
  }
  eaves.finish()
  const lattice = batch(group, 'lattice', timber)
  for (const { pivot, size } of windowFrames) {
    pivot.updateMatrix()
    for (const s of [-1, 1]) {
      const transform = new THREE.Object3D()
      transform.position.set(s * size / 6, 0, 0.034)
      transform.updateMatrix()
      const v = new THREE.BoxGeometry(0.017, size, 0.026)
      v.applyMatrix4(transform.matrix).applyMatrix4(pivot.matrix)
      lattice.add(v, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#bd956d')
      transform.position.set(0, s * size / 6, 0.036)
      transform.updateMatrix()
      const h = new THREE.BoxGeometry(size, 0.017, 0.028)
      h.applyMatrix4(transform.matrix).applyMatrix4(pivot.matrix)
      lattice.add(h, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#c39d78')
    }
  }
  lattice.finish()
  const metal = material({ metalness: 0.25, roughness: 0.65 })
  const doorHardware = batch(doorPivot, 'door-hardware', metal)
  for (const y of [0.22, 0.69]) {
    box(doorHardware, -0.037, y, 0.027, 0.075, 0.022, 0.013, '#88746b')
    doorHardware.add(new THREE.CylinderGeometry(0.012, 0.012, 0.055, 7), [-0.006, y, 0.028], [1, 1, 1], [0, 0, 0], '#88746b')
  }
  doorHardware.add(new THREE.SphereGeometry(0.021, 9, 6), [-leafWidth + 0.096, 0.43, 0.04], [1, 1, 0.7], [0, 0, 0], '#b29b76')
  doorHardware.add(new THREE.TorusGeometry(0.026, 0.005, 4, 10), [-leafWidth + 0.096, 0.4, 0.055], [1, 1, 1], [0, 0, 0], '#8c7864')
  doorHardware.finish()
  const doorPlanks = batch(doorPivot, 'door-planks', timber)
  for (let i = 1; i < 6; i++) {
    const x = i * leafWidth / 6
    const height = leafHeight - leafWidth / 2 + Math.sqrt(Math.max(0, (leafWidth / 2) ** 2 - (x - leafWidth / 2) ** 2))
    box(doorPlanks, x - leafWidth, height / 2, 0.022, 0.004, height - 0.015, 0.003, '#a97e5d')
  }
  for (const y of [0.16, 0.65]) box(doorPlanks, -leafWidth / 2, y, 0.034, leafWidth - 0.08, 0.044, 0.026, '#c8a17a')
  doorPlanks.finish()
  // 材質階段
  // 細節階段
  const rings = batch(group, 'rings', timber)
  for (let i = 0; i < 8; i++) {
    for (const x of [-0.746, 0.746]) {
      for (const side of [-1, 1]) {
        for (const r of [0.023, 0.047]) rings.add(new THREE.RingGeometry(r, r + 0.0028, 9), [x, 0.235 + i * 0.14, side * 0.699], [1, 1, 1], [0, side < 0 ? Math.PI : 0, 0], '#c6a177')
      }
    }
  }
  const ringMesh = rings.finish()
  const planter = batch(group, 'planter', timber)
  box(planter, 0.36, 0.546, 0.765, 0.48, 0.1, 0.15, '#ad8664')
  box(planter, 0.36, 0.6, 0.765, 0.45, 0.014, 0.12, '#89785e')
  for (const y of [0.517, 0.568]) box(planter, 0.36, y, 0.843, 0.49, 0.034, 0.022, '#c69e76')
  for (const x of [0.132, 0.588]) box(planter, x, 0.55, 0.765, 0.025, 0.13, 0.17, '#cba57d')
  for (const x of [0.21, 0.51]) beam(planter, [x, 0.46, 0.7], [x, 0.53, 0.79], 0.025, 0.03, '#b18b67')
  planter.finish()
  const plants = material({ roughness: 0.94 })
  const flowers = batch(group, 'flowers', plants)
  for (let i = 0; i < 5; i++) {
    const x = 0.17 + i * 0.094
    const y = 0.665 + 0.025 * Math.sin(i * 2.3)
    const z = 0.765 + (i % 2 ? 0.027 : -0.015)
    beam(flowers, [x, 0.58, z], [x, y, z], 0.008, 0.009, '#87a477')
    for (const side of [-1, 1]) flowers.add(new THREE.IcosahedronGeometry(1, 0), [x + side * 0.024, y - 0.043, z], [0.038, 0.015, 0.02], [0, 0, side * 0.55], '#9cbb83')
    for (let petal = 0; petal < 5; petal++) {
      const a = petal / 5 * TAU
      flowers.add(new THREE.SphereGeometry(1, 7, 5), [x + Math.cos(a) * 0.021, y + Math.sin(a) * 0.021, z + 0.017], [0.021, 0.025, 0.01], [0, 0, a - Math.PI / 2], i % 2 ? '#fff4df' : '#f0acc0')
    }
    flowers.add(new THREE.SphereGeometry(0.012, 7, 4), [x, y, z + 0.027], [1, 1, 0.65], [0, 0, 0], '#edcb80')
  }
  flowers.finish()
  const moss = batch(group, 'moss', plants)
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? 1 : -1
    moss.add(new THREE.IcosahedronGeometry(1, 0), [side * (0.58 + (i % 3) * 0.088), 0.102, i < 5 ? 0.66 : -0.62], [0.042, 0.016, 0.026], [0, i, 0], '#9fb787')
  }
  moss.finish()
  const petals = batch(group, 'petals', plants)
  for (let i = 0; i < 6; i++) {
    const x = 0.19 + (i % 3) * 0.25
    const z = -0.53 + Math.floor(i / 3) * 0.75 + Math.sin(i) * 0.12
    petals.add(new THREE.SphereGeometry(1, 7, 4), [x, roofY(x) + 0.094, z], [0.016, 0.005, 0.027], [0, i * 1.9, -0.56], '#f5b8cc')
  }
  petals.finish()
  const doormat = batch(group, 'doormat', trim)
  doormat.add(polygon([[-0.18, -0.062], [-0.16, -0.075], [0.16, -0.075], [0.18, -0.055], [0.18, 0.055], [0.16, 0.075], [-0.16, 0.075], [-0.18, 0.055]], 0.01, 0.003), [doorX, 0.146, 0.775], [1, 1, 1], [-Math.PI / 2, 0, 0], '#d5bd8c')
  for (let i = 0; i < 11; i++) box(doormat, doorX - 0.155 + i * 0.031, 0.16, 0.775, 0.008, 0.003, 0.12, '#c1a474')
  doormat.finish()
  // 光線階段
  const lanternFrame = batch(group, 'lantern-frame', metal)
  beam(lanternFrame, [-0.715, 1.12, 0.67], [-0.715, 1.12, 0.79], 0.025, 0.026, '#9a8271')
  lanternFrame.add(new THREE.TorusGeometry(0.026, 0.006, 4, 10), [-0.715, 1.073, 0.79], [1, 1, 1], [0, 0, 0], '#9a8271')
  for (const y of [0.856, 1.026]) box(lanternFrame, -0.715, y, 0.79, 0.126, 0.022, 0.126, '#9a8271')
  lanternFrame.add(new THREE.ConeGeometry(0.1, 0.055, 4), [-0.715, 1.064, 0.79], [1, 1, 1], [0, Math.PI / 4, 0], '#ab8c74')
  for (const x of [-0.765, -0.665]) {
    for (const z of [0.74, 0.84]) box(lanternFrame, x, 0.941, z, 0.012, 0.17, 0.012, '#a1856e')
  }
  box(lanternFrame, -0.715, 0.94, 0.849, 0.105, 0.012, 0.008, '#a1856e')
  lanternFrame.finish()
  const lanternMaterial = material({ emissive: '#ffc078', emissiveIntensity: 0.2 })
  const lantern = batch(group, 'lantern-paper', lanternMaterial)
  box(lantern, -0.715, 0.941, 0.79, 0.092, 0.15, 0.092, '#ffe3b0')
  const lanternMesh = lantern.finish()
  // 互動階段
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#62556d', transparent: true, opacity: 0, depthWrite: false })
  ownedMaterials.push(shadowMaterial)
  // 兩個獨立頭肩輪廓，尖耳略有高低差
  const shadowMesh = new THREE.Group()
  shadowMesh.name = 'catgirls-shadow'
  for (let i = 0; i < 2; i++) {
    const shape = new THREE.Shape()
    shape.moveTo(-0.081, -0.105)
    shape.bezierCurveTo(-0.081, -0.067, -0.058, -0.052, -0.035, -0.048)
    shape.bezierCurveTo(-0.074, -0.025, -0.077, 0.025, -0.05, 0.057)
    shape.lineTo(-0.062, 0.112)
    shape.lineTo(-0.018, 0.077)
    shape.quadraticCurveTo(0, 0.083, 0.018, 0.077)
    shape.lineTo(0.062, 0.112)
    shape.lineTo(0.05, 0.057)
    shape.bezierCurveTo(0.077, 0.025, 0.074, -0.025, 0.035, -0.048)
    shape.bezierCurveTo(0.058, -0.052, 0.081, -0.067, 0.081, -0.105)
    shape.closePath()
    const silhouette = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), shadowMaterial)
    silhouette.name = i === 0 ? 'mochi-shadow' : 'fuji-shadow'
    silhouette.position.set(i === 0 ? -0.094 : 0.094, i === 0 ? -0.014 : 0.014, 0)
    silhouette.renderOrder = 1
    shadowMesh.add(silhouette)
  }
  shadowMesh.position.set(0.36, 0.825, 0.72)
  shadowMesh.visible = false
  shadowMesh.renderOrder = 1
  group.add(shadowMesh)
  const puffs = []
  const smokeGeometry = new THREE.SphereGeometry(1, 12, 8)
  const sp = smokeGeometry.attributes.position
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i)
    const y = sp.getY(i)
    const z = sp.getZ(i)
    const r = 1 + 0.065 * Math.sin(y * 6 + x * 3) * Math.cos(z * 5)
    sp.setXYZ(i, x * r, y * r, z * r)
  }
  smokeGeometry.computeVertexNormals()
  for (let i = 0; i < 4; i++) {
    const smokeMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { opacity: { value: 0 } },
      vertexShader: 'varying vec3 vNormal; varying vec3 vView; void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vNormal = normalize(normalMatrix * normal); vView = -p.xyz; gl_Position = projectionMatrix * p; }',
      fragmentShader: 'uniform float opacity; varying vec3 vNormal; varying vec3 vView; void main() { float rim = max(0.0, dot(normalize(vNormal), normalize(vView))); gl_FragColor = vec4(vec3(0.97, 0.975, 1.0), opacity * pow(rim, 1.45));\n #include <tonemapping_fragment>\n #include <colorspace_fragment>\n }',
    })
    ownedMaterials.push(smokeMaterial)
    const puff = new THREE.Mesh(smokeGeometry, smokeMaterial)
    puff.name = `smoke-${i}`
    puff.visible = false
    puff.position.set(0.43, 2.22, -0.36)
    puff.scale.setScalar(0.04)
    puff.renderOrder = 2
    group.add(puff)
    puffs.push(puff)
  }
  let smokeLevel = 0
  const paperDay = new THREE.Color('#e9dcb9')
  const paperFocus = new THREE.Color('#ffd58c')
  const clamp01 = value => Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0
  group.userData.doorway = new THREE.Vector3(doorX, 0, 1.32)
  group.userData.inside = new THREE.Vector3(doorX, 0, 0.156)
  group.userData.roofTop = new THREE.Vector3(0, 2.46, 0)
  group.userData.setDoor = k => { doorPivot.rotation.y = clamp01(k) * Math.PI * 5 / 9 }
  group.userData.anim = (t, dt, night, state = {}) => {
    const time = Number.isFinite(t) ? t : 0
    const delta = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0
    const n = night === true ? 1 : clamp01(night)
    const focus = clamp01(state.focus)
    const shadow = clamp01(state.shadow)
    paper.emissiveIntensity = 0.045 + n * 0.555 + focus * (1.65 - n * 0.8)
    paper.color.copy(paperDay).lerp(paperFocus, focus * 0.65)
    lanternMaterial.emissiveIntensity = 0.12 + n * 1.05
    shadowMesh.visible = shadow > 0.001
    // 紙窗亮燈時亮度很高，影子要夠濃才看得出來
    shadowMaterial.opacity = shadow * 0.8
    shadowMesh.position.y = 0.825 + Math.sin(time * 1.9) * 0.005
    shadowMesh.position.x = 0.36 + Math.sin(time * 0.57) * Math.max(0, Math.sin(time * 0.21)) * 0.008
    shadowMesh.rotation.z = Math.sin(time * 0.57) * Math.max(0, Math.sin(time * 0.21)) * 0.035
    shadowMesh.scale.y = 1 + Math.sin(time * 1.9) * 0.028
    smokeLevel += (focus - smokeLevel) * (1 - Math.exp(-delta * 4))
    if (focus === 0 && smokeLevel < 0.001) smokeLevel = 0
    for (let i = 0; i < puffs.length; i++) {
      const puff = puffs[i]
      if (smokeLevel === 0) {
        puff.visible = false
        puff.material.uniforms.opacity.value = 0
        puff.position.set(0.43, 2.195, -0.36)
        puff.scale.setScalar(0.001)
        continue
      }
      const phase = ((time * 0.22 + i / puffs.length) % 1 + 1) % 1
      const envelope = Math.sin(phase * Math.PI) ** 1.15
      puff.material.uniforms.opacity.value = smokeLevel * envelope * 0.72
      puff.visible = smokeLevel > 0 && envelope > 0.002
      puff.position.set(0.43 + Math.sin(time * 0.7 + i) * phase * 0.1, 2.2 + phase * 1.05, -0.36 - phase * 0.14)
      const radius = 0.07 + phase * 0.22
      puff.scale.set(radius * 1.13, radius * 0.85, radius)
    }
  }
  // 最佳化階段
  const sideWindows = new THREE.Group()
  sideWindows.name = 'side-windows'
  group.add(sideWindows)
  for (const name of ['right-window', 'left-window']) sideWindows.add(group.getObjectByName(name))
  const lanternGroup = new THREE.Group()
  lanternGroup.name = 'lantern'
  lanternGroup.position.x = -0.02
  group.add(lanternGroup)
  lanternGroup.add(group.getObjectByName('lantern-frame'), group.getObjectByName('lantern-paper'))
  const nodes = {}
  const meshes = {}
  group.traverse(object => {
    if (object.name) nodes[object.name] = object
    if (object.isMesh) meshes[object.name] = object
  })
  const sockets = {}
  for (const key of ['doorway', 'inside', 'roofTop']) {
    const socket = new THREE.Object3D()
    socket.name = key
    socket.position.copy(group.userData[key])
    group.add(socket)
    sockets[key] = socket
  }
  group.userData.sculptRuntime = {
    nodes,
    meshes,
    sockets,
    colliders: [
      { id: 'floor', type: 'box', center: [0, 0.08, 0], size: [1.5, 0.16, 1.2] },
      { id: 'doorway', type: 'box', center: [doorX, doorY + doorHeight / 2, 0.606], size: [doorWidth, doorHeight, 0.18], isTrigger: true },
    ],
    destructionGroups: { shell: ['front-logs', 'side-logs', 'endgrain'], roof: ['roof', 'shingles', 'fascia', 'eaves'], door: ['door-leaf', 'door-hardware', 'door-planks'] },
  }
  group.userData.ownedMaterials = ownedMaterials
  group.userData.ownedTextures = []
  return group
}
