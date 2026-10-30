import * as THREE from 'three'

const TAU = Math.PI * 2

// 同材質批次保留頂點色，避免書本與花葉增加繪製次數
function batch(parent, name, material) {
  const ranges = []
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
      const rangeStart = positions.length / 3
      const p = source.attributes.position
      const n = source.attributes.normal
      for (let i = 0; i < p.count; i++) {
        point.fromBufferAttribute(p, i).applyMatrix4(transform.matrix)
        normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize()
        if (Math.abs(point.y) < 1e-7) point.y = 0
        positions.push(point.x, point.y, point.z)
        normals.push(normal.x, normal.y, normal.z)
        colors.push(tint.r, tint.g, tint.b)
      }
      ranges.push([rangeStart, p.count])
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
      mesh.userData.solidRanges = ranges
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

function polygon(points, depth) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: false, curveSegments: 12 })
}

function gable(target, x, z, width, depth, eave, peak, color) {
  target.add(polygon([[-width / 2, eave], [width / 2, eave], [0, peak]], depth), [x, 0, z - depth / 2], [1, 1, 1], [0, 0, 0], color)
}

function roof(target, x, z, width, depth, eave, peak, color) {
  const half = width / 2
  const rise = peak - eave
  const slope = Math.atan2(rise, half)
  const length = Math.hypot(half, rise)
  for (const side of [-1, 1]) box(target, x + side * half / 2, (peak + eave) / 2, z, length, 0.045, depth, color, [0, 0, -side * slope])
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

function archGeometry(width, height, depth = 0.025) {
  return new THREE.ExtrudeGeometry(arch(width, height), { depth, bevelEnabled: false, curveSegments: 10 })
}

function books(target, x, y, z, width, rows, rowHeight, count = 10) {
  const palette = ['#96b5ac', '#d1aa86', '#a8a4be', '#c2c895', '#d7b7ad', '#82a8ad']
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < count; i++) {
      const bw = width / count * 0.77
      const h = rowHeight * (0.66 + ((i * 7 + row * 3) % 5) * 0.065)
      const bx = x - width / 2 + (i + 0.5) * width / count
      box(target, bx, y + row * rowHeight + h / 2, z, bw, h, 0.065, palette[(i + row * 2) % palette.length])
    }
  }
}

export function buildLibrary(stage = 1) {
  const level = Number.isFinite(stage) ? THREE.MathUtils.clamp(Math.round(stage), 1, 5) : 1
  const group = new THREE.Group()
  group.name = `library-stage-${level}`
  const ownedMaterials = []
  const material = (options = {}) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true, emissiveIntensity: 0, ...options })
    ownedMaterials.push(m)
    return m
  }
  // 材質階段：純色頂點調色與獨立粗糙度，不使用貼圖
  const solid = material()
  const stone = material({ roughness: 0.96 })
  const paint = material({ roughness: 0.83 })
  const cx = [0, 0, 0, -0.34, -0.4][level - 1]
  const w = [0.69, 1.03, 1.35, 1.35, 1.4][level - 1]
  const d = [0.38, 0.73, 1.02, 1.12, 1.2][level - 1]
  const eave = [0.91, 1.22, 1.56, 1.64, 1.52][level - 1]
  const peak = [1.19, 1.69, 2.22, 2.32, 2.2][level - 1]
  const front = d / 2
  const foundation = batch(group, 'foundation', stone)
  if (level > 1) box(foundation, cx, 0.065, 0, w + 0.13, 0.13, d + 0.12, '#d4c9b5')
  if (level >= 3) foundation.add(new THREE.CylinderGeometry(1, 1, 0.11, 14), [0, 0.055, 0.05], [[1.15, 1.4, 1.64][level - 3], 1, [0.79, 0.85, 0.9][level - 3]], [0, 0, 0], '#d8cfba')
  foundation.finish()
  const body = batch(group, 'body', solid)
  if (level === 1) {
    box(body, 0, 0.61, -0.12, w, 0.6, 0.07, '#b8956b')
    for (const side of [-1, 1]) box(body, side * 0.31, 0.48, 0, 0.075, 0.96, 0.3, '#c9a276')
  } else if (level === 2) {
    box(body, 0, 0.67, -d / 2 + 0.045, w, 1.08, 0.09, '#ead6af')
    for (const side of [-1, 1]) box(body, side * (w / 2 - 0.045), 0.67, 0, 0.09, 1.08, d, '#f1dfbc')
    box(body, 0, 0.31, front, w, 0.36, 0.08, '#f1dfbc')
  } else {
    box(body, cx, (eave + 0.13) / 2, 0, w, eave - 0.13, d, '#f1dfbc')
  }
  gable(body, cx, 0, w, d, eave - 0.02, peak - 0.04, '#ead9b8')
  body.finish()
  const roofParts = batch(group, 'roof', paint)
  roof(roofParts, cx, 0, w + 0.22, d + 0.23, eave, peak, '#639fa5')
  if (level >= 3) roofParts.add(new THREE.CylinderGeometry(0.64, 0.8, 0.18, 4).rotateY(Math.PI / 4), [cx, eave - 0.32, front + 0.09], [1, 1, 0.44], [0, 0, 0], '#72afb0')
  if (level === 5) {
    gable(roofParts, -0.22, -0.28, 1.42, 0.7, 1.78, 2.42, '#e8d7b7')
    roof(roofParts, -0.22, -0.28, 1.62, 0.84, 1.8, 2.46, '#70aeb1')
  }
  roofParts.finish()
  if (level >= 4) {
    const wing = batch(group, 'reading-wing', solid)
    box(wing, 0.76, 0.77, -0.02, 0.82, 1.42, 1.08, '#efddba')
    box(wing, 0.76, 0.075, -0.02, 0.94, 0.15, 1.19, '#d0c5b3')
    wing.finish()
    const wingRoof = batch(group, 'skylight', paint)
    wingRoof.add(new THREE.CylinderGeometry(0.43, 0.67, 0.26, 4).rotateY(Math.PI / 4), [0.76, 1.61, -0.02], [1, 1, 1.32], [0, 0, 0], '#80b6b7')
    wingRoof.finish()
  }
  if (level === 5) {
    const tower = batch(group, 'observatory', solid)
    tower.add(new THREE.CylinderGeometry(0.53, 0.53, 2.82, 10), [0.52, 1.51, -0.25], [1, 1, 1], [0, Math.PI / 8, 0], '#f0dfbd')
    tower.add(new THREE.SphereGeometry(0.56, 10, 5, 0, TAU, 0, Math.PI / 2), [0.52, 2.92, -0.25], [1, 1, 1], [0, 0, 0], '#8ec1c7')
    tower.add(new THREE.ConeGeometry(0.045, 0.1, 6), [0.52, 3.53, -0.25], [1, 1, 1], [0, 0, 0], '#d2ae68')
    tower.finish()
  }
  if (level === 1) {
    const bench = batch(group, 'bench', solid)
    box(bench, -0.52, 0.225, 0.3, 0.43, 0.065, 0.23, '#c6a17a')
    for (const x of [-0.66, -0.38]) box(bench, x, 0.1, 0.3, 0.055, 0.2, 0.16, '#b6936e')
    bench.finish()
  }
  if (level >= 3) {
    const porch = batch(group, 'porch', solid)
    for (const side of [-1, 1]) box(porch, cx + side * 0.46, (eave - 0.28) / 2, front + 0.16, 0.085, eave - 0.28, 0.085, '#c6a074')
    porch.finish()
    const chimneys = batch(group, 'chimneys', stone)
    for (let i = 0; i < (level === 5 ? 2 : 1); i++) {
      const x = cx + (i ? -0.46 : 0.28)
      const h = level === 5 ? (i ? 2.4 : 2.74) : Math.min(peak + 0.1, 2.32)
      box(chimneys, x, h - 0.15, -0.32, 0.15, 0.34, 0.16, '#e1d1b5')
      box(chimneys, x, h + 0.035, -0.32, 0.2, 0.055, 0.21, '#cfb695')
    }
    chimneys.finish()
    const garden = batch(group, 'garden', solid)
    const spread = [0, 0, 0.96, 1.22, 1.42][level - 1]
    for (const side of [-1, 1]) {
      garden.add(new THREE.IcosahedronGeometry(1, 0), [side * spread, 0.19, 0.3], [0.18, 0.15, 0.24], [0, side, 0], '#99ad81')
      garden.add(new THREE.ConeGeometry(0.105, 0.5, 6), [side * (spread - 0.06), 0.34, 0.04], [1, 1, 1], [0, 0, 0], '#8da277')
    }
    garden.finish()
  }
  // 結構階段：開放書架、書店櫥窗與門窗均保留可辨識的層次
  const glazingMaterial = material({ emissive: '#ffd396', emissiveIntensity: 0, roughness: 0.54 })
  const glazing = batch(group, 'window-panes', glazingMaterial)
  const shelves = batch(group, 'bookcase', solid)
  const bookSpines = batch(group, 'books', solid)
  const trims = batch(group, 'window-frames', solid)
  const icon = batch(group, 'book-icon', solid)
  const shelfW = level === 1 ? 0.56 : level === 2 ? 0.81 : 0.52
  if (level <= 2) {
    const bottom = level === 1 ? 0.29 : 0.48
    const rowH = level === 1 ? 0.205 : 0.23
    const rows = 3
    box(shelves, 0, bottom + rowH * 1.5, front - 0.12, shelfW + 0.07, rowH * 3, 0.04, '#846b55')
    for (let i = 0; i <= rows; i++) box(shelves, 0, bottom + i * rowH, front + 0.015, shelfW + 0.11, 0.035, 0.2, '#c7a270')
    for (const side of [-1, 1]) box(shelves, side * (shelfW / 2 + 0.035), bottom + rowH * 1.5, front + 0.01, 0.055, rowH * 3 + 0.04, 0.18, '#d4b486')
    books(bookSpines, 0, bottom + 0.02, front + 0.045, shelfW, rows, rowH, level === 1 ? 7 : 10)
    if (level === 2) box(shelves, 0, bottom - 0.06, front + 0.04, w + 0.17, 0.07, 0.29, '#d3b283')
  } else {
    const door = batch(group, 'door', solid)
    door.add(archGeometry(0.66, 1.08), [cx, 0.15, front + 0.012], [1, 1, 1], [0, 0, 0], '#7e6c56')
    glazing.add(archGeometry(0.53, 0.97), [cx, 0.18, front + 0.047], [1, 1, 1], [0, 0, 0], '#c8c7a7')
    const frame = arch(0.75, 1.18)
    frame.holes.push(arch(0.62, 1.055, 0, 0.015, new THREE.Path()))
    trims.add(new THREE.ExtrudeGeometry(frame, { depth: 0.06, bevelEnabled: false, curveSegments: 10 }), [cx, 0.14, front + 0.055], [1, 1, 1], [0, 0, 0], '#d5ae74')
    for (const side of [-1, 1]) {
      const bx = cx + side * 0.185
      for (let i = 0; i < 4; i++) box(shelves, bx, 0.24 + i * 0.21, front + 0.092, 0.15, 0.018, 0.07, '#b28e61')
      books(bookSpines, bx, 0.255, front + 0.102, 0.14, 3, 0.21, 3)
    }
    box(door, cx, 0.62, front + 0.146, 0.035, 0.96, 0.025, '#c39b67')
    box(door, cx, 0.32, front + 0.147, 0.55, 0.03, 0.025, '#c39b67')
    door.finish()
    const round = batch(group, 'round-window', solid)
    const wy = peak - 0.47
    glazing.add(new THREE.CircleGeometry(0.165, 16), [cx, wy, front + 0.018], [1, 1, 1], [0, 0, 0], '#b8c8bf')
    round.add(new THREE.TorusGeometry(0.175, 0.025, 4, 16), [cx, wy, front + 0.035], [1, 1, 1], [0, 0, 0], '#d0a772')
    box(round, cx, wy, front + 0.056, 0.022, 0.32, 0.018, '#cba473')
    box(round, cx, wy, front + 0.056, 0.32, 0.022, 0.018, '#cba473')
    round.finish()
    const windows = new THREE.Group()
    windows.name = 'side-windows'
    group.add(windows)
    for (const side of [-1, 1]) {
      const pane = batch(windows, `side-window-${side}`, glazingMaterial)
      pane.add(archGeometry(0.36, 0.65), [cx + side * (w / 2 + 0.016), 0.59, 0], [1, 1, 1], [0, side * Math.PI / 2, 0], '#bbc9bc')
      const border = batch(windows, `side-frame-${side}`, solid)
      const shape = arch(0.43, 0.72)
      shape.holes.push(arch(0.34, 0.63, 0, 0.025, new THREE.Path()))
      border.add(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 10 }), [cx + side * (w / 2 + 0.028), 0.56, 0], [1, 1, 1], [0, side * Math.PI / 2, 0], '#cba475')
      pane.finish()
      border.finish()
    }
  }
  const iconW = [0.37, 0.46, 0.51, 0.51, 0.53][level - 1]
  const iconY = level <= 2 ? eave + 0.03 : eave - 0.21
  const iconZ = front + (level <= 2 ? 0.09 : 0.26)
  for (const side of [-1, 1]) {
    const points = [[0, -0.1], [side * iconW / 2, -0.07], [side * iconW / 2, 0.15], [side * 0.09, 0.17], [0, 0.12]]
    icon.add(polygon(points, 0.04), [cx, iconY, iconZ], [1, 1, 1], [0, 0, 0], '#c7a263')
    const pages = [[side * 0.012, -0.069], [side * (iconW / 2 - 0.022), -0.045], [side * (iconW / 2 - 0.025), 0.13], [side * 0.09, 0.145], [side * 0.012, 0.103]]
    icon.add(polygon(pages, 0.018), [cx, iconY, iconZ + 0.041], [1, 1, 1], [0, 0, 0], '#fff1ce')
  }
  if (level >= 4) {
    for (const x of [0.58, 0.96]) {
      glazing.add(archGeometry(0.27, 0.78), [x, 0.31, 0.537], [1, 1, 1], [0, 0, 0], '#bccbbd')
      for (let row = 0; row < 3; row++) box(shelves, x, 0.36 + row * 0.21, 0.573, 0.24, 0.023, 0.035, '#bf996b')
      books(bookSpines, x, 0.375, 0.594, 0.21, 3, 0.21, 4)
    }
    const sky = batch(group, 'skylight-glass', glazingMaterial)
    sky.add(new THREE.CylinderGeometry(0.26, 0.43, 0.25, 4).rotateY(Math.PI / 4), [0.76, 1.85, -0.02], [1, 1, 1.25], [0, 0, 0], '#bbd6cf')
    sky.finish()
  }
  if (level === 5) {
    for (const y of [0.42, 1.28, 2.08]) {
      glazing.add(archGeometry(0.35, 0.65), [0.62, y, 0.29], [1, 1, 1], [0, 0, 0], '#becbbd')
      const shape = arch(0.44, 0.74)
      shape.holes.push(arch(0.35, 0.65, 0, 0.025, new THREE.Path()))
      trims.add(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 10 }), [0.62, y - 0.025, 0.315], [1, 1, 1], [0, 0, 0], '#cba475')
      books(bookSpines, 0.62, y + 0.055, 0.333, 0.29, 2, 0.21, 5)
      for (const sy of [0.03, 0.25, 0.46]) box(shelves, 0.62, y + sy, 0.338, 0.33, 0.022, 0.035, '#b68f5e')
    }
  }
  for (const target of [shelves, bookSpines, trims, icon, glazing]) target.finish()
  // 形體階段：屋脊、簷板與圓頂肋條以實體幾何表現
  const fascia = batch(group, 'fascia', solid)
  const seams = batch(group, 'roof-seams', paint)
  const detailRoof = (x, z, rw, rd, low, high) => {
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) beam(fascia, [x, high + 0.012, z + end * rd / 2], [x + side * rw / 2, low + 0.012, z + end * rd / 2], 0.052, 0.055, '#c49a6c')
      for (let i = 0; i < 7; i++) {
        const rz = z - rd / 2 + (i + 0.5) * rd / 7
        beam(seams, [x, high + 0.026, rz], [x + side * rw / 2, low + 0.026, rz], 0.013, 0.016, i % 2 ? '#78afb1' : '#74adaf')
      }
      box(fascia, x + side * rw / 2, low - 0.012, z, 0.045, 0.055, rd, '#c7a579')
    }
    box(seams, x, high + 0.027, z, 0.06, 0.035, rd + 0.035, '#76b0b0')
  }
  detailRoof(cx, 0, w + 0.22, d + 0.23, eave, peak)
  if (level === 5) detailRoof(-0.22, -0.28, 1.62, 0.84, 1.8, 2.46)
  if (level >= 3) {
    for (const side of [-1, 1]) {
      const x = cx + side * 0.46
      for (const y of [0.17, eave - 0.37]) {
        box(fascia, x, y, front + 0.16, 0.15, 0.065, 0.15, '#d2b17d')
        box(fascia, x, y + 0.043, front + 0.16, 0.115, 0.035, 0.115, '#dcbf8f')
      }
      beam(fascia, [cx + side * w / 2, eave - 0.16, front + 0.015], [cx + side * (w / 2 - 0.16), eave, front + 0.015], 0.055, 0.065, '#b9926b')
    }
    const steps = batch(group, 'steps', stone)
    for (let i = 0; i < 2; i++) box(steps, cx, 0.04 + i * 0.06, front + 0.21 - i * 0.075, 0.84 - i * 0.07, 0.08, 0.24, i ? '#e5d8c1' : '#d9ccb6')
    steps.finish()
  }
  if (level >= 4) {
    const wx = 0.76
    for (const side of [-1, 1]) {
      box(fascia, wx + side * 0.3, 0.84, 0.58, 0.045, 1.2, 0.045, '#c6a47a')
      for (const z of [-0.39, -0.19, 0.01, 0.21, 0.41]) beam(fascia, [wx + side * 0.185, 1.98, z * 0.55 - 0.02], [wx + side * 0.305, 1.73, z - 0.02], 0.025, 0.025, '#d0ad7a')
    }
    box(fascia, wx, 1.985, -0.02, 0.39, 0.025, 0.49, '#c9a472')
    for (const x of [0.58, 0.96]) {
      const border = arch(0.34, 0.85)
      border.holes.push(arch(0.265, 0.775, 0, 0.025, new THREE.Path()))
      fascia.add(new THREE.ExtrudeGeometry(border, { depth: 0.035, bevelEnabled: false, curveSegments: 10 }), [x, 0.285, 0.605], [1, 1, 1], [0, 0, 0], '#caa474')
      box(fascia, x, 0.74, 0.646, 0.022, 0.7, 0.02, '#c49a6a')
    }
  }
  fascia.finish()
  seams.finish()
  const metalMaterial = material({ roughness: 0.58, metalness: 0.22 })
  const gold = batch(group, 'gold-trim', metalMaterial)
  let vanePivot = null
  if (level === 5) {
    for (const y of [2.89, 2.94]) gold.add(new THREE.TorusGeometry(0.565, 0.018, 4, 20), [0.52, y, -0.25], [1, 1, 1], [Math.PI / 2, 0, 0], '#d0ae69')
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU
      const points = []
      for (let j = 0; j <= 7; j++) {
        const t = j / 7 * Math.PI / 2
        points.push(new THREE.Vector3(0.52 + Math.cos(a) * 0.564 * Math.cos(t), 2.92 + 0.564 * Math.sin(t), -0.25 + Math.sin(a) * 0.564 * Math.cos(t)))
      }
      gold.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 8, 0.011, 4, false), [0, 0, 0], [1, 1, 1], [0, 0, 0], '#d6b87c')
    }
    for (const y of [0.22, 1.26, 2.16, 2.89]) gold.add(new THREE.CylinderGeometry(0.545, 0.545, 0.04, 10), [0.52, y, -0.25], [1, 1, 1], [0, Math.PI / 8, 0], '#d4be94')
    vanePivot = new THREE.Group()
    vanePivot.name = 'observatory-vane'
    vanePivot.position.set(0.52, 3.5, -0.25)
    group.add(vanePivot)
    const vane = batch(vanePivot, 'vane', metalMaterial)
    box(vane, 0, 0, 0, 0.27, 0.012, 0.012, '#c9a65e')
    vane.add(polygon([[0.1, 0], [0.155, 0.035], [0.155, -0.025]], 0.014), [0, 0, -0.007], [1, 1, 1], [0, 0, 0], '#d6b87c')
    vane.finish()
  }
  gold.finish()
  // 表面階段：分色石塊、書頁與低矮花圃
  const small = batch(group, 'surface-detail', solid)
  if (level >= 2) {
    for (let i = 0; i < 7; i++) box(small, cx - w / 2 + (i + 0.5) * w / 7, 0.085, front + 0.066, w / 7 - 0.009, 0.08, 0.025, ['#dbcfb7', '#cfc3ad', '#e1d5bc'][i % 3])
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) beam(small, [cx + side * 0.032, iconY - 0.056 + i * 0.014, iconZ + 0.061], [cx + side * (iconW / 2 - 0.03), iconY - 0.032 + i * 0.014, iconZ + 0.061], 0.004, 0.004, '#e2ce9f')
  }
  if (level === 2) {
    for (let i = 0; i < 4; i++) box(small, 0, 0.23 + i * 0.075, front + 0.047, w - 0.08, 0.008, 0.006, '#dec49c')
  }
  small.finish()
  const plantMaterial = material({ roughness: 0.96 })
  const plants = batch(group, 'garden-flowers', plantMaterial)
  const spread = [0.55, 0.66, 0.98, 1.22, 1.42][level - 1]
  const flowersPerSide = [2, 3, 4, 5, 6][level - 1]
  for (const side of [-1, 1]) {
    if (level === 1 && side < 0) continue
    for (let i = 0; i < flowersPerSide; i++) {
      const x = side * (spread + Math.sin(i * 2.1) * 0.06)
      const z = -0.04 + i / Math.max(1, flowersPerSide - 1) * 0.47
      const y = (level >= 3 ? 0.37 : 0.2) + Math.sin(i * 1.9 + side) * 0.035
      beam(plants, [x, 0.07, z], [x, y, z], 0.009, 0.009, '#829b70')
      for (let j = 0; j < 3; j++) {
        const a = j * TAU / 3 + i
        plants.add(new THREE.IcosahedronGeometry(1, 0), [x + Math.cos(a) * 0.045, y - 0.075, z + Math.sin(a) * 0.045], [0.07, 0.025, 0.035], [0, -a, 0.22], ['#9bb383', '#83a078', '#a8b98b'][j])
      }
      for (let j = 0; j < 5; j++) {
        const a = j / 5 * TAU
        plants.add(new THREE.IcosahedronGeometry(1, 0), [x + Math.cos(a) * 0.025, y + Math.sin(a) * 0.025, z + 0.016], [0.024, 0.025, 0.012], [0, 0, a], i % 3 === 0 ? '#d3cee0' : i % 3 === 1 ? '#f5e4c7' : '#ecc1c3')
      }
      plants.add(new THREE.IcosahedronGeometry(0.014, 0), [x, y, z + 0.032], [1, 1, 0.65], [0, 0, 0], '#d6b776')
    }
  }
  plants.finish()
  if (level >= 4) {
    const bench = batch(group, 'bench', solid)
    box(bench, 0.83, 0.23, 0.78, 0.48, 0.055, 0.17, '#c5a17b')
    box(bench, 0.83, 0.37, 0.72, 0.48, 0.1, 0.035, '#d2b28a')
    for (const x of [0.66, 1]) box(bench, x, 0.11, 0.77, 0.04, 0.22, 0.15, '#ad8c68')
    bench.finish()
  }
  // 光線階段：只調整燈罩自發光，場景不新增光源
  const lampMaterial = material({ emissive: '#ffcf8d', emissiveIntensity: 0, roughness: 0.63 })
  const cages = batch(group, 'lamps', metalMaterial)
  const lampPanes = batch(group, 'lamp-panes', lampMaterial)
  const lampX = level === 5 ? 0.62 : level === 1 ? 0.38 : level === 2 ? 0.58 : 0.4
  const lampY = level === 5 ? 1.13 : level <= 2 ? eave - 0.2 : eave - 0.53
  const lampZ = level === 5 ? 0.82 : front + (level <= 2 ? 0.1 : 0.21)
  const lampSize = level === 1 ? 0.07 : 0.09
  for (const side of [-1, 1]) {
    const x = cx + side * lampX
    const h = lampSize * 1.45
    if (level === 5) {
      cages.add(new THREE.CylinderGeometry(0.019, 0.024, 1.08, 7), [x, 0.54, lampZ], [1, 1, 1], [0, 0, 0], '#b29262')
      cages.add(new THREE.CylinderGeometry(0.065, 0.075, 0.1, 7), [x, 0.05, lampZ], [1, 1, 1], [0, 0, 0], '#ccb385')
    } else beam(cages, [x, lampY + h, front + 0.025], [x, lampY + h, lampZ], 0.015, 0.015, '#bc995e')
    box(cages, x, lampY + h * 0.73, lampZ, 0.012, h * 0.6, 0.012, '#bc995e')
    for (const y of [lampY - h / 2, lampY + h / 2]) box(cages, x, y, lampZ, lampSize * 1.25, 0.016, lampSize * 1.25, '#c5a369')
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(cages, x + sx * lampSize / 2, lampY, lampZ + sz * lampSize / 2, 0.011, h, 0.011, '#c8a66b')
    cages.add(new THREE.ConeGeometry(lampSize, 0.045, 4), [x, lampY + h / 2 + 0.025, lampZ], [1, 1, 1], [0, Math.PI / 4, 0], '#c9aa70')
    box(lampPanes, x, lampY, lampZ, lampSize * 0.83, h * 0.87, lampSize * 0.83, '#f9dfac')
  }
  if (level === 5) {
    const supports = [[-1.23, 1.68, -0.04], [-0.86, 2.42, -0.32], [-0.12, 2.76, -0.32]]
    box(cages, -1.23, 0.86, -0.04, 0.025, 1.72, 0.025, '#a68a60')
    for (let segment = 0; segment < 2; segment++) {
      const a = new THREE.Vector3(...supports[segment])
      const b = new THREE.Vector3(...supports[segment + 1])
      const midpoint = a.clone().lerp(b, 0.5)
      midpoint.y -= 0.13
      const curve = new THREE.QuadraticBezierCurve3(a, midpoint, b)
      cages.add(new THREE.TubeGeometry(curve, 10, 0.006, 4, false), [0, 0, 0], [1, 1, 1], [0, 0, 0], '#a88b61')
      for (let i = 1; i < 5; i++) {
        const pos = curve.getPoint(i / 5)
        box(cages, pos.x, pos.y - 0.02, pos.z, 0.009, 0.04, 0.009, '#c5a369')
        lampPanes.add(new THREE.IcosahedronGeometry(0.025, 0), [pos.x, pos.y - 0.047, pos.z], [1, 1.2, 1], [0, 0, 0], '#f6dca6')
      }
    }
  }
  cages.finish()
  lampPanes.finish()
  if (level === 5) group.traverse(node => {
    node.position.y *= 0.9
    if (node.isMesh) node.geometry.scale(1, 0.9, 1)
  })
  // 互動階段：世界座標由呼叫端決定，動畫只改風向標與自發光
  const entrance = front + (level === 1 ? 0.115 : level === 2 ? 0.185 : 0.16)
  group.userData.front = new THREE.Vector3(cx, 0, entrance + 0.35)
  group.updateMatrixWorld(true)
  const highest = new THREE.Vector3(0, -Infinity, 0)
  const vertex = new THREE.Vector3()
  group.traverse(node => {
    if (!node.isMesh) return
    const positions = node.geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld)
      if (vertex.y > highest.y) highest.copy(vertex)
    }
  })
  group.userData.top = highest.clone().add(new THREE.Vector3(0, 0.35, 0))
  group.userData.anim = (t, dt, state = {}) => {
    const night = Number.isFinite(state?.night) ? THREE.MathUtils.clamp(state.night, 0, 1) : 0
    const time = Number.isFinite(t) ? t : 0
    glazingMaterial.emissiveIntensity = night * 0.72
    lampMaterial.emissiveIntensity = night * 0.8
    if (vanePivot) vanePivot.rotation.y = time * 0.035 % TAU
  }
  const sockets = {}
  for (const id of ['front', 'top']) {
    const socket = new THREE.Object3D()
    socket.name = id
    socket.position.copy(group.userData[id])
    group.add(socket)
    sockets[id] = socket
  }
  const nodes = {}
  const meshes = {}
  group.traverse(node => {
    if (node !== group && node.name) nodes[node.name] = node
    if (node.isMesh) meshes[node.name] = node
  })
  group.userData.sculptRuntime = {
    nodes,
    meshes,
    sockets,
    colliders: [
      { id: 'main-volume', type: 'box', center: [cx, eave / 2, 0], size: [w, eave, d] },
      { id: 'entrance', type: 'box', center: [cx, 0.48, entrance], size: [0.55, 0.96, 0.2], isTrigger: true },
    ],
    destructionGroups: {
      shell: ['body', 'reading-wing', 'observatory'],
      roof: ['roof', 'fascia', 'roof-seams', 'skylight', 'skylight-glass', 'gold-trim', 'chimneys'],
      reading: ['bookcase', 'books', 'door', 'book-icon', 'bench'],
      garden: ['garden', 'garden-flowers'],
      lamps: ['lamps', 'lamp-panes'],
    },
  }
  // 最佳化階段：同材質分件批次，資源由呼叫端統一釋放
  group.userData.ownedMaterials = ownedMaterials
  group.userData.ownedTextures = []
  return group
}


