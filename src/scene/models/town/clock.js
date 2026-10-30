import * as THREE from 'three'

const TAU = Math.PI * 2
const C = {
  stone: '#ded2bd', stoneLight: '#ecdfc9', cream: '#eddfc6', plaster: '#e6d2b7',
  wood: '#c19871', woodLight: '#d4ad81', woodDark: '#a98365',
  roof: '#7b9697', roofLight: '#8da6a4', roofDark: '#6c8589',
  gold: '#c4a35f', goldLight: '#d5b777', dial: '#fff1d6', ink: '#79634c',
  leaf: '#94a77c', leafLight: '#afbd91', flower: '#f0bbbd', white: '#fff1dd',
}

// 靜態零件批次合併，色差寫入頂點
function batch(parent, name, material) {
  const positions = []
  const normals = []
  const colors = []
  const transform = new THREE.Object3D()
  const matrix = new THREE.Matrix3()
  const v = new THREE.Vector3()
  const n = new THREE.Vector3()
  return {
    add(geometry, position = [0, 0, 0], rotation = [0, 0, 0], color = '#ffffff', scale = [1, 1, 1]) {
      transform.position.fromArray(position)
      transform.rotation.set(...rotation)
      transform.scale.fromArray(scale)
      transform.updateMatrix()
      matrix.getNormalMatrix(transform.matrix)
      const tint = new THREE.Color(color)
      const source = geometry.index ? geometry.toNonIndexed() : geometry
      const p = source.attributes.position
      const normal = source.attributes.normal
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(transform.matrix)
        n.fromBufferAttribute(normal, i).applyMatrix3(matrix).normalize()
        positions.push(v.x, v.y, v.z)
        normals.push(n.x, n.y, n.z)
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

function box(target, x, y, z, w, h, d, color, rotation = [0, 0, 0]) {
  target.add(new THREE.BoxGeometry(w, h, d), [x, y, z], rotation, color)
}

function beam(target, a, b, width, color, depth = width) {
  const start = new THREE.Vector3(...a)
  const end = new THREE.Vector3(...b)
  const direction = end.clone().sub(start)
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()))
  target.add(new THREE.BoxGeometry(width, direction.length(), depth), start.add(end).multiplyScalar(0.5).toArray(), [rotation.x, rotation.y, rotation.z], color)
}

function cylinder(target, x, y, z, top, bottom, h, color, rotation = [0, 0, 0], segments = 12) {
  target.add(new THREE.CylinderGeometry(top, bottom, h, segments), [x, y, z], rotation, color)
}

function pyramid(target, x, y, z, width, height, depth, color) {
  target.add(new THREE.ConeGeometry(1, 1, 4), [x, y + height / 2, z], [0, Math.PI / 4, 0], color, [width / Math.SQRT2, height, depth / Math.SQRT2])
}

function profile(points, depth) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 })
}

function arch(width, height, y = 0, shape = new THREE.Shape()) {
  const r = width / 2
  shape.moveTo(-r, y)
  shape.lineTo(r, y)
  shape.lineTo(r, y + height - r)
  shape.absarc(0, y + height - r, r, 0, Math.PI, false)
  shape.lineTo(-r, y)
  return shape
}

function surface(target, geometry, x, y, z, angle, color) {
  geometry.rotateY(angle)
  geometry.translate(x, y, z)
  target.add(geometry, [0, 0, 0], [0, 0, 0], color)
}

function tilePrism(points, thickness = 0.008) {
  const vertices = points.concat(points.map(([x, y, z]) => [x, y - thickness, z]))
  const faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(faces.flatMap(f => f.flatMap(i => vertices[i])), 3))
  geometry.computeVertexNormals()
  return geometry
}

export function buildClockTower(stage = 1) {
  const level = THREE.MathUtils.clamp(Math.round(Number.isFinite(stage) ? stage : 1), 1, 5)
  const root = new THREE.Group()
  root.name = `clock-tower-${level}`
  const ownedMaterials = []
  const material = (options = {}) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: true, emissiveIntensity: 0, ...options })
    ownedMaterials.push(m)
    return m
  }
  const matte = material()
  const metal = material({ metalness: 0.28, roughness: 0.58 })
  const glow = material({ emissive: '#ffdba4', emissiveIntensity: 0 })
  const stone = batch(root, 'foundation', matte)
  const shell = batch(root, 'timber-shell', matte)
  const roof = batch(root, 'roof', matte)
  const gold = batch(root, 'finial', metal)
  const roofs = []
  const hip = (x, y, z, w, h, d, color) => {
    pyramid(roof, x, y, z, w, h, d, color)
    roofs.push({ x, y, z, w, h, d, power: 1 })
  }
  const heights = [1.3, 1.8, 2.4, 3.8, 4.4]
  const heightsIndex = level - 1
  const height = heights[heightsIndex]
  const width = [0.26, 1.08, 1.3, 1.3, 0.98][heightsIndex]
  const depth = [0.27, 0.88, 1.06, 1.15, 0.92][heightsIndex]
  const front = depth / 2
  const clockHands = []
  const clocks = []
  const clock = (name, x, y, z, angle, radius) => {
    const face = new THREE.Group()
    face.name = `clock-${name}`
    face.position.set(x, y, z)
    face.rotation.y = angle
    root.add(face)
    const rim = batch(face, `clock-rim-${name}`, metal)
    cylinder(rim, 0, 0, 0, radius, radius, radius * 0.22, C.gold, [Math.PI / 2, 0, 0], 32)
    rim.finish()
    const dial = batch(face, `clock-face-${name}`, glow)
    cylinder(dial, 0, 0, radius * 0.125, radius * 0.88, radius * 0.88, radius * 0.055, C.dial, [Math.PI / 2, 0, 0], 32)
    dial.finish()
    for (const [hand, length, w] of [['hour', 0.48, 0.065], ['minute', 0.69, 0.045]]) {
      const pivot = new THREE.Group()
      pivot.name = `clock-${hand}-${name}`
      pivot.position.z = radius * 0.19
      face.add(pivot)
      const pointer = batch(pivot, `${hand}-hand-${name}`, metal)
      box(pointer, 0, radius * length / 2, 0, radius * w, radius * length, radius * 0.04, C.ink)
      pointer.finish()
      clockHands.push({ pivot, hand })
    }
    const hub = batch(face, `clock-hub-${name}`, metal)
    cylinder(hub, 0, 0, radius * 0.24, radius * 0.07, radius * 0.07, radius * 0.06, C.goldLight, [Math.PI / 2, 0, 0])
    hub.finish()
    {
      const dots = batch(face, `clock-dots-${name}`, metal)
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU
        cylinder(dots, Math.sin(a) * radius * 0.73, Math.cos(a) * radius * 0.73, radius * 0.18, radius * 0.026, radius * 0.026, radius * 0.025, C.gold, [Math.PI / 2, 0, 0], 8)
      }
      dots.finish()
    }
    clocks.push(face)
  }
  if (level === 1) {
    box(stone, 0, 0.045, 0, 0.32, 0.09, 0.32, C.stone)
    box(stone, 0, 0.16, 0, 0.21, 0.15, 0.21, C.stoneLight)
    cylinder(shell, 0, 0.57, 0, 0.036, 0.047, 0.75, C.wood)
    clock('front', 0, 0.885, 0.035, 0, 0.216)
    hip(0, 1.105, 0, 0.49, 0.145, 0.37, C.roof)
    cylinder(gold, 0, 1.27, 0, 0, 0.025, 0.06, C.gold)
  } else {
    box(stone, 0, 0.055, 0, width + 0.3, 0.11, depth + 0.3, C.stone)
    box(stone, 0, 0.14, 0, width + 0.13, 0.1, depth + 0.13, C.stoneLight)
    if (level === 2) {
      for (const x of [-0.4, 0.4]) for (const z of [-0.3, 0.3]) box(shell, x, 0.64, z, 0.085, 1.01, 0.085, C.wood)
      box(shell, 0, 1.09, 0, 1.02, 0.09, 0.8, C.wood)
      roof.add(profile([[-0.52, 0], [0.52, 0], [0, 0.5]], 0.96), [0, 1.1, -0.36], [0, 0, 0], C.cream)
      hip(0, 1.08, 0, 1.35, 0.59, 1.08, C.roof)
      clock('front', 0, 1.24, 0.62, 0, 0.238)
      cylinder(gold, 0, 1.73, 0, 0, 0.035, 0.14, C.gold)
    } else if (level === 3) {
      box(shell, 0, 0.88, 0, width, 1.4, depth, C.cream)
      hip(0, 1.51, 0, 1.66, 0.72, 1.4, C.roof)
      roof.add(profile([[-0.6, 0], [0.6, 0], [0, 0.63]], 0.17), [0, 1.5, front + 0.04], [0, 0, 0], C.cream)
      cylinder(shell, 0, 1.68, 0.635, 0.31, 0.31, 0.24, C.cream, [Math.PI / 2, 0, 0], 16)
      clock('front', 0, 1.68, front + 0.23, 0, 0.292)
      cylinder(gold, 0, 2.315, 0, 0, 0.043, 0.17, C.gold)
    } else {
      const lowerTop = level === 4 ? 1.5 : 2.2
      const housingBottom = level === 4 ? 2.38 : 2.2
      const housingTop = 3.06
      box(shell, 0, (0.18 + lowerTop) / 2, 0, width, lowerTop - 0.18, depth, C.cream)
      if (level === 4) {
        for (const x of [-0.55, 0.55]) for (const z of [-0.48, 0.48]) box(shell, x, 1.96, z, 0.105, 1.0, 0.105, C.wood)
        box(shell, 0, 2.39, 0, width + 0.08, 0.12, depth + 0.08, C.wood)
        const bell = new THREE.Group()
        bell.name = 'bell-pivot'
        bell.position.set(0, -0.1, 0)
        const hanger = new THREE.Group()
        hanger.name = 'bell-hanger'
        hanger.position.y = 2.39
        root.add(hanger)
        hanger.add(bell)
        const bronze = batch(bell, 'hanging-bell', metal)
        const points = [[0, -0.48], [0.27, -0.48], [0.29, -0.43], [0.22, -0.39], [0.17, -0.2], [0.15, -0.08], [0.1, -0.025], [0, -0.02]].map(p => new THREE.Vector2(...p))
        bronze.add(new THREE.LatheGeometry(points, 20), [0, 0, 0], [0, 0, 0], C.gold)
        bronze.finish()
      }
      box(shell, 0, (housingBottom + housingTop) / 2, 0, width + 0.05, housingTop - housingBottom, depth + 0.05, C.cream)
      const cy = level === 4 ? 2.72 : 2.58
      const r = level === 4 ? 0.31 : 0.32
      clock('front', 0, cy, front + 0.045, 0, r)
      if (level === 5) {
        clock('right', width / 2 + 0.045, cy, 0, Math.PI / 2, r)
        clock('rear', 0, cy, -front - 0.045, Math.PI, r)
        clock('left', -width / 2 - 0.045, cy, 0, -Math.PI / 2, r)
        for (const x of [-0.43, 0.43]) for (const z of [-0.4, 0.4]) {
          const near = x > 0 && z > 0 ? 0.15 : 0
          box(shell, x, 3.09 - near, z, 0.17, 0.3, 0.17, C.cream)
          hip(x, 3.23 - near, z, 0.27, 0.3, 0.27, C.roof)
          cylinder(gold, x, 3.61 - near, z, 0, 0.022, 0.16, C.gold)
        }
        box(stone, 0, 0.05, 0, 1.72, 0.1, 1.5, C.stone)
        for (const x of [-0.72, 0.72]) for (const z of [-0.5, 0.5]) {
          box(stone, x, 0.22, z, 0.27, 0.34, 0.3, C.stoneLight)
        }
        box(shell, 0, 2.08, 0, 1.22, 0.14, 1.14, C.wood)
        hip(0, 1.08, 0, 1.2, 0.49, 1.1, C.roof)
        box(shell, 0, 1.31, 0, 0.98, 0.54, 0.92, C.cream)
        hip(0, 1.02, front + 0.14, 0.68, 0.29, 0.46, C.roof)
        hip(width / 2 + 0.14, 1.02, 0, 0.46, 0.29, 0.68, C.roof)
        for (const x of [-0.68, 0.68]) {
          const lz = x > 0 ? -0.4 : 0.4
          beam(gold, [x * 0.72, 2.7, lz], [x, 2.7, lz], 0.025, C.gold)
          beam(gold, [x, 2.7, lz], [x, 2.6, lz], 0.02, C.gold)
          for (const z of [-0.48, 0.48]) shell.add(new THREE.IcosahedronGeometry(1, 0), [Math.sign(x) * 0.76, 0.43, z], [0, 0, 0], C.leaf, [0.17, 0.3, 0.17])
          for (const z of [-0.48, 0.48]) {
            cylinder(shell, Math.sign(x) * 0.76, 0.66, z, 0, 0.13, 0.58, C.leaf, [0, 0, 0], 7)
          }
        }
        for (const z of [-0.54, 0.54]) for (let i = 0; i < 5; i++) shell.add(new THREE.IcosahedronGeometry(1, 0), [(i - 2) * 0.215, 2.13, z], [0, i, 0], C.leaf, [0.13, 0.1, 0.12])
        for (const x of [-0.57, 0.57]) for (let i = 0; i < 4; i++) shell.add(new THREE.IcosahedronGeometry(1, 0), [x, 2.13, (i - 1.5) * 0.215], [0, i, 0], C.leaf, [0.12, 0.1, 0.13])
        for (const x of [-0.55, 0.55]) for (const z of [-0.48, 0.48]) {
          shell.add(profile([[-0.045, 0], [0.045, 0], [0.045, -0.29], [0, -0.35], [-0.045, -0.29]], 0.016), [x, 2.02, z], [0, 0, 0], C.roof)
        }
      }
      const roofHeight = level === 4 ? 0.48 : 1.14
      const roofBottom = level === 4 ? 3.06 : 2.94
      if (level === 4) hip(0, roofBottom, 0, width + 0.18, roofHeight, depth + 0.18, C.roof)
      else {
        roofs.push({ x: 0, y: roofBottom, z: 0, w: 0.84, h: roofHeight, d: 0.8, power: 1.4 })
        for (const [a, b] of [[0, 0.55], [0.55, 1]]) {
          const h = (b - a) * roofHeight
          roof.add(new THREE.CylinderGeometry((1 - b) ** 1.4, (1 - a) ** 1.4, h, 4), [0, roofBottom + (a + b) / 2 * roofHeight, 0], [0, Math.PI / 4, 0], C.roof, [0.84 / Math.SQRT2, 1, 0.8 / Math.SQRT2])
        }
      }
      if (level === 4) cylinder(gold, 0, roofBottom + roofHeight + 0.05, 0, 0, 0.043, 0.1, C.gold)
      if (level === 5) {
        gold.add(new THREE.LatheGeometry([[0, 4.4], [0.01, 4.35], [0.018, 4.26], [0.067, 4.2], [0.07, 4.17], [0.036, 4.14], [0.036, 4.1], [0.061, 4.08], [0, 4.08]].reverse().map(p => new THREE.Vector2(...p)), 12), [0, 0, 0], [0, 0, 0], C.gold)
        for (const sign of [-1, 1]) beam(gold, [0, 3.92, 0], [sign * 0.43, 3.65, sign * -0.4], 0.012, C.gold)
      }
      if (level === 4) {
        const apex = new THREE.Group()
        apex.name = 'roof-apex'
        apex.position.y = 3.54
        root.add(apex)
        const vane = new THREE.Group()
        vane.name = 'rooster-vane'
        vane.position.y = 0.07
        apex.add(vane)
        const rooster = batch(vane, 'rooster', metal)
        rooster.add(profile([[-0.1, 0], [-0.13, 0.06], [-0.12, 0.1], [-0.08, 0.09], [-0.06, 0.16], [-0.02, 0.19], [0.01, 0.16], [0.025, 0.12], [0.1, 0.15], [0.13, 0.1], [0.14, 0.04], [0.1, 0.06], [0.06, 0.1], [0.035, 0.015], [-0.04, -0.015]], 0.025), [0, 0, 0], [0, 0, 0], C.gold)
        beam(rooster, [-0.17, -0.025, 0], [0.17, -0.025, 0], 0.012, C.gold)
        rooster.finish()
      }
    }
  }
  // 結構階段：木構、拱門與窗格都留在主輪廓內
  {
    const timber = batch(root, 'timber-braces', matte)
    const doors = batch(root, 'door', matte)
    const frames = batch(root, 'window-frames', matte)
    const panes = batch(root, 'window-panes', glow)
    const lampFrames = batch(root, 'lantern-frame', metal)
    const lampPanes = batch(root, 'lantern-pane', glow)
    const lantern = (x, y, z, size = 0.13) => {
      box(lampPanes, x, y, z, size * 0.7, size * 1.3, size * 0.7, C.dial)
      for (const s of [-1, 1]) for (const t of [-1, 1]) box(lampFrames, x + s * size * 0.39, y, z + t * size * 0.39, size * 0.09, size * 1.55, size * 0.09, C.gold)
      for (const s of [-1, 1]) box(lampFrames, x, y + s * size * 0.8, z, size, size * 0.12, size, C.gold)
      pyramid(lampFrames, x, y + size * 0.85, z, size * 1.25, size * 0.4, size * 1.25, C.gold)
    }
    if (level === 1) {
      beam(lampFrames, [0, 0.78, 0], [0.2, 0.78, 0], 0.024, C.gold)
      beam(lampFrames, [0.2, 0.78, 0], [0.2, 0.7, 0], 0.017, C.gold)
      lantern(0.2, 0.6, 0, 0.115)
      for (const y of [0.27, 0.75]) cylinder(lampFrames, 0, y, 0, 0.052, 0.052, 0.038, C.gold)
    } else if (level === 2) {
      lantern(0, 0.84, 0, 0.14)
      beam(lampFrames, [0, 1.08, 0], [0, 0.98, 0], 0.018, C.gold)
      for (const z of [-0.3, 0.3]) for (const sign of [-1, 1]) beam(timber, [sign * 0.4, 0.82, z], [sign * 0.19, 1.09, z], 0.055, C.wood)
      for (const x of [-0.4, 0.4]) for (const sign of [-1, 1]) beam(timber, [x, 0.83, sign * 0.3], [x, 1.09, 0], 0.045, C.wood)
      for (const z of [-0.37, 0.64]) for (const sign of [-1, 1]) beam(timber, [0, 1.62, z], [sign * 0.51, 1.11, z], 0.065, C.woodLight)
      box(timber, 0, 1.41, 0.61, 0.055, 0.4, 0.045, C.wood)
    } else {
      const lowerTop = level === 3 ? 1.49 : level === 4 ? 1.48 : 2.12
      const cornerX = width / 2 - 0.018
      const cornerZ = front - 0.018
      for (const x of [-cornerX, cornerX]) for (const z of [-cornerZ, cornerZ]) box(timber, x, (lowerTop + 0.2) / 2, z, 0.08, lowerTop - 0.2, 0.08, C.wood)
      for (const y of level === 5 ? [0.24, 1.14, 1.48, 2.1, 2.23, 3.02] : [0.24, 1.0, 1.48]) {
        for (const z of [-front, front]) box(timber, 0, y, z, width + 0.04, 0.075, 0.065, C.woodLight)
        for (const x of [-width / 2, width / 2]) box(timber, x, y, 0, 0.065, 0.075, depth, C.wood)
      }
      for (const side of [-1, 1]) {
        for (const z of [-front - 0.012, front + 0.012]) beam(timber, [side * cornerX, 1.47, z], [side * 0.12, 1.05, z], 0.055, C.wood)
        for (const x of [-width / 2 - 0.012, width / 2 + 0.012]) beam(timber, [x, 1.47, side * cornerZ], [x, 1.05, side * 0.04], 0.055, C.wood)
      }
      if (level >= 4) {
        const y0 = level === 4 ? 2.4 : 2.2
        for (const x of [-cornerX, cornerX]) for (const z of [-cornerZ, cornerZ]) box(timber, x, (y0 + 3.05) / 2, z, 0.08, 3.05 - y0, 0.08, C.wood)
        for (const z of [-front, front]) box(timber, 0, 3.03, z, width + 0.06, 0.08, 0.08, C.woodLight)
        for (const x of [-width / 2, width / 2]) box(timber, x, 3.03, 0, 0.08, 0.08, depth + 0.06, C.woodLight)
      }
      const doorW = level === 3 ? 0.38 : 0.4
      const doorH = level === 3 ? 0.72 : 0.8
      const doorZ = front + 0.035
      doors.add(new THREE.ExtrudeGeometry(arch(doorW, doorH), { depth: 0.035, bevelEnabled: false, curveSegments: 10 }), [0, 0.18, doorZ], [0, 0, 0], C.woodDark)
      const surround = arch(doorW + 0.13, doorH + 0.1)
      surround.holes.push(arch(doorW + 0.01, doorH + 0.015, 0.005, new THREE.Path()))
      frames.add(new THREE.ExtrudeGeometry(surround, { depth: 0.05, bevelEnabled: false, curveSegments: 10 }), [0, 0.17, doorZ + 0.008], [0, 0, 0], C.stoneLight)
      for (let i = 1; i < 6; i++) {
        const x = (i / 6 - 0.5) * doorW
        const h = doorH - doorW / 2 + Math.sqrt(Math.max(0, (doorW / 2) ** 2 - x * x))
        box(doors, x, 0.18 + h / 2, doorZ + 0.038, 0.004, h - 0.005, 0.004, C.wood)
      }
      for (const y of [0.34, 0.72]) box(doors, 0, y, doorZ + 0.045, doorW - 0.04, 0.026, 0.014, C.woodLight)
      cylinder(lampFrames, 0.09, 0.56, doorZ + 0.06, 0.013, 0.013, 0.023, C.gold, [Math.PI / 2, 0, 0])
      for (let i = 0; i < 3; i++) box(stone, 0, 0.025 + i * 0.045, front + 0.26 - i * 0.075, doorW + 0.22 - i * 0.035, 0.05, 0.22, i % 2 ? C.stone : C.stoneLight)
      const window = (x, y, z, angle, w = 0.21, h = 0.42) => {
        const outer = arch(w + 0.065, h + 0.055)
        outer.holes.push(arch(w, h, 0.025, new THREE.Path()))
        surface(frames, new THREE.ExtrudeGeometry(outer, { depth: 0.035, bevelEnabled: false, curveSegments: 8 }), x, y, z, angle, C.wood)
        surface(panes, new THREE.ExtrudeGeometry(arch(w, h), { depth: 0.022, bevelEnabled: false, curveSegments: 8 }), x, y + 0.025, z, angle, C.dial)
        for (const a of [-1, 1]) surface(frames, new THREE.BoxGeometry(0.012, h * 0.76, 0.025).translate(a * w / 6, h * 0.42, 0.034), x, y + 0.025, z, angle, C.woodLight)
        surface(frames, new THREE.BoxGeometry(w, 0.014, 0.027).translate(0, h * 0.42, 0.035), x, y + 0.025, z, angle, C.woodLight)
      }
      for (const sign of [-1, 1]) {
        window(sign * (width / 2 + 0.025), level === 5 ? 1.57 : 0.54, 0, sign * Math.PI / 2)
        if (level === 3) window(sign * 0.45, 0.55, front + 0.025, 0, 0.15, 0.34)
      }
      if (level === 5) window(0, 1.57, front + 0.025, 0)
      if (level >= 3 && level <= 4) for (const sign of [-1, 1]) lantern(sign * (width / 2 + 0.12), 0.91, front - 0.08, 0.13)
      if (level === 4) {
        const bell = root.getObjectByName('bell-pivot')
        const hardware = batch(bell, 'bell-hardware', metal)
        cylinder(hardware, 0, 0.03, 0, 0.017, 0.017, 0.2, C.gold)
        cylinder(hardware, 0, -0.49, 0, 0.27, 0.27, 0.024, C.goldLight)
        hardware.add(new THREE.SphereGeometry(0.038, 10, 6), [0, -0.53, 0], [0, 0, 0], C.gold)
        hardware.finish()
        for (const x of [-0.55, 0.55]) for (const z of [-0.48, 0.48]) beam(timber, [x, 2.12, z], [x * 0.6, 2.39, z], 0.06, C.wood)
      }
      if (level === 5) for (const x of [-0.68, 0.68]) lantern(x, 2.48, x > 0 ? -0.4 : 0.4, 0.13)
      if (level === 5) for (const sign of [-1, 1]) {
        cylinder(lampFrames, sign * 0.73, 0.46, -0.64, 0.019, 0.025, 0.53, C.gold, [0, 0, 0], 8)
        lantern(sign * 0.73, 0.75, -0.64, 0.12)
      }
    }
    for (const b of [timber, doors, frames, panes, lampFrames, lampPanes]) b.finish()
  }
  // 形體階段：分層瓦片貼合既有屋頂，避免擴大輪廓
  {
    const tiles = batch(root, 'roof-courses', matte)
    const masonry = batch(root, 'stone-joints', matte)
    const planters = batch(root, 'planters', matte)
    const gables = batch(root, 'clock-gables', matte)
    for (const r of roofs) {
      const rows = r.h > 0.7 ? 7 : r.h > 0.4 ? 5 : 3
      const columns = r.w > 0.9 ? 7 : r.w > 0.5 ? 5 : 2
      const shrink = t => r.power === 1 ? 1 - t : t <= 0.55 ? 1 + ((0.45 ** 1.4) - 1) * t / 0.55 : (0.45 ** 1.4) * (1 - t) / 0.45
      const cuts = r.power === 1 ? Array.from({ length: rows + 1 }, (_, i) => i / rows) : [0, 0.1375, 0.275, 0.4125, 0.55, 0.7, 0.85, 1]
      for (let side = 0; side < 4; side++) {
        const point = (u, t) => {
          const scale = shrink(t) * 0.994
          const w = r.w * scale / 2
          const d = r.d * scale / 2
          const y = r.y + t * r.h + 0.009
          return side === 0 ? [r.x + u * w, y, r.z + d] : side === 1 ? [r.x + w, y, r.z - u * d] : side === 2 ? [r.x - u * w, y, r.z - d] : [r.x - w, y, r.z + u * d]
        }
        for (let row = 0; row < cuts.length - 1; row++) for (let col = 0; col < columns; col++) {
          const u0 = -1 + col * 2 / columns + 0.012
          const u1 = -1 + (col + 1) * 2 / columns - 0.012
          const a = cuts[row]
          const b = Math.min(0.998, cuts[row + 1] - 0.004)
          tiles.add(tilePrism([point(u0, a), point(u1, a), point(u1, b), point(u0, b)]), [0, 0, 0], [0, 0, 0], [C.roof, C.roofLight, C.roofDark, '#829c9c'][(row * 3 + col + side) % 4])
        }
      }
    }
    if (level >= 3) {
      const limit = level === 5 ? 1.45 : level === 4 ? 1.4 : 0.95
      for (let row = 0; 0.25 + row * 0.16 < limit; row++) {
        const y = 0.25 + row * 0.16
        for (const sign of [-1, 1]) {
          box(masonry, sign * (width / 2 + 0.01), y, front - 0.01, 0.105, 0.145, 0.11, row % 2 ? C.stoneLight : C.stone)
          box(masonry, sign * (width / 2 + 0.01), y, -front + 0.01, 0.105, 0.145, 0.11, row % 2 ? C.stone : C.stoneLight)
        }
      }
      const py = level === 3 ? 1.03 : level === 4 ? 1.47 : 2.07
      for (const sign of [-1, 1]) {
        box(planters, sign * width * 0.3, py, front + 0.07, width * 0.38, 0.11, 0.17, C.wood)
        for (const y of [py - 0.04, py + 0.04]) box(planters, sign * width * 0.3, y, front + 0.16, width * 0.4, 0.025, 0.025, C.woodLight)
      }
      for (const sign of [-1, 1]) for (const z of [-front * 0.7, front * 0.7]) box(planters, sign * (width / 2 + 0.1), 0.23, z, 0.23, 0.19, 0.25, C.wood)
    }
    if (level >= 4) {
      const gw = width * 0.82
      for (const angle of level === 5 ? [0, Math.PI / 2, Math.PI, -Math.PI / 2] : [0, Math.PI]) {
        const x = Math.sin(angle) * (width / 2 + 0.012)
        const z = Math.cos(angle) * (front + 0.012)
        surface(gables, profile([[-gw / 2, 0], [gw / 2, 0], [0, 0.26]], 0.035), x, 2.99, z, angle, C.cream)
        for (const sign of [-1, 1]) {
          const geometry = new THREE.BoxGeometry(Math.hypot(gw / 2, 0.26), 0.055, 0.07)
          geometry.rotateZ(sign * Math.atan2(0.26, gw / 2)).translate(-sign * gw / 4, 0.13, 0.055)
          surface(gables, geometry, x, 2.99, z, angle, C.woodLight)
        }
        surface(gables, new THREE.BoxGeometry(0.045, 0.23, 0.05).translate(0, 0.11, 0.06), x, 2.99, z, angle, C.wood)
      }
    }
    for (const b of [tiles, masonry, planters, gables]) b.finish()
  }
  // 細節階段：少量花瓣與垂葉保留花園辨識度
  {
    const flowers = batch(root, 'garden', matte)
    const beds = batch(root, 'garden-beds', matte)
    const flower = (x, y, z, angle, index) => {
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU
        const dx = Math.sin(a) * 0.024
        flowers.add(new THREE.OctahedronGeometry(1, 0), [x + Math.cos(angle) * dx, y + Math.cos(a) * 0.024, z - Math.sin(angle) * dx], [0, angle, -a], index % 3 ? C.white : C.flower, [0.017, 0.024, 0.01])
      }
      flowers.add(new THREE.OctahedronGeometry(1, 0), [x + Math.sin(angle) * 0.014, y, z + Math.cos(angle) * 0.014], [0, angle, 0], C.goldLight, [0.011, 0.011, 0.008])
      for (const sign of [-1, 1]) flowers.add(new THREE.OctahedronGeometry(1, 0), [x + sign * 0.028, y - 0.04, z - 0.008], [0, angle, sign * 0.5], index % 2 ? C.leaf : C.leafLight, [0.045, 0.014, 0.022])
    }
    if (level === 2) {
      for (const sign of [-1, 1]) {
        flowers.add(new THREE.IcosahedronGeometry(1, 0), [sign * 0.43, 0.23, 0.31], [0, 0, 0], C.leaf, [0.12, 0.075, 0.1])
        flower(sign * 0.44, 0.3, 0.37, 0, sign + 1)
      }
    }
    if (level >= 3) {
      const py = level === 3 ? 1.14 : level === 4 ? 1.59 : 2.19
      for (let i = 0; i < (level === 5 ? 6 : 4); i++) {
        const x = (i - (level === 5 ? 2.5 : 1.5)) * (level === 5 ? 0.165 : 0.21)
        flower(x, py + Math.sin(i * 1.8) * 0.022, front + 0.17, 0, i)
      }
      if (level === 5) for (const sign of [-1, 1]) for (let i = 0; i < 3; i++) flower(sign * 0.64, 2.2 + i % 2 * 0.018, (i - 1) * 0.25, sign * Math.PI / 2, i)
      for (const sign of [-1, 1]) for (const z of [-front * 0.7, front * 0.7]) {
        const x = sign * (width / 2 + (level === 5 ? 0.25 : 0.1))
        box(beds, x, 0.2, z, 0.27, 0.22, 0.28, level === 5 ? C.stoneLight : C.wood)
        box(beds, x, 0.32, z, 0.29, 0.035, 0.3, C.stoneLight)
        flowers.add(new THREE.IcosahedronGeometry(1, 0), [x, 0.35, z], [0, z, 0], C.leaf, [0.16, 0.065, 0.16])
        flower(x, 0.4, z + 0.13, 0, sign + Math.round(z * 10))
      }
      for (let i = 0; i < 6; i++) {
        const x = (i - 2.5) * width / 7
        flowers.add(new THREE.OctahedronGeometry(1, 0), [x, py - 0.12 - i % 2 * 0.05, front + 0.17], [0, 0, i * 0.6], C.leaf, [0.024, 0.07, 0.013])
      }
    }
    flowers.finish()
    beds.finish()
  }
  stone.finish()
  shell.finish()
  roof.finish()
  gold.finish()
  // 互動階段：旗幟、鐘與風向雞各有自己的局部樞紐
  if (level === 5) {
    const anchor = new THREE.Group()
    anchor.name = 'pennant-anchor'
    anchor.position.y = 3.92
    root.add(anchor)
    const pivot = new THREE.Group()
    pivot.name = 'pennant-pivot'
    anchor.add(pivot)
    const flags = batch(pivot, 'flags', matte)
    for (const sign of [-1, 1]) for (let i = 0; i < 3; i++) {
      const t = 0.24 + i * 0.23
      flags.add(profile([[-0.045, 0], [0.045, -0.012], [0.025, -0.115], [-0.025, -0.087]], 0.008), [sign * 0.43 * t, -0.27 * t, -sign * 0.4 * t], [0, Math.atan2(sign * 0.4, sign * 0.43), 0], [C.flower, C.dial, '#d4aa94'][i])
    }
    flags.finish()
  }
  root.userData.front = new THREE.Vector3(0, 0, level === 1 ? 0.55 : front + (level >= 3 ? 0.4 : 0.35))
  root.userData.top = new THREE.Vector3(0, height + 0.35, 0)
  root.userData.ownedMaterials = ownedMaterials
  root.userData.ownedTextures = []
  const bellPivot = root.getObjectByName('bell-pivot')
  const vanePivot = root.getObjectByName('rooster-vane')
  const pennantPivot = root.getObjectByName('pennant-pivot')
  const sockets = {}
  for (const key of ['front', 'top']) {
    const socket = new THREE.Object3D()
    socket.name = `socket-${key}`
    socket.position.copy(root.userData[key])
    root.add(socket)
    sockets[key] = socket
  }
  const nodes = {}
  const meshes = {}
  root.traverse(object => {
    if (object === root) return
    if (object.name) nodes[object.name] = object
    if (object.isMesh) meshes[object.name] = object
  })
  const colliders = level === 2 ? [-1, 1].flatMap(x => [-1, 1].map(z => ({ id: `post-${x}-${z}`, type: 'box', center: [x * 0.4, 0.64, z * 0.3], size: [0.085, 1.01, 0.085] }))) : [{ id: 'building', type: 'box', center: [0, level === 1 ? 0.5 : 0.8, 0], size: [width, level === 1 ? 1 : 1.6, depth] }]
  root.userData.sculptRuntime = {
    nodes,
    meshes,
    sockets,
    colliders,
    destructionGroups: {
      foundation: ['foundation', 'stone-joints', 'garden-beds'],
      timber: ['timber-shell', 'timber-braces', 'door', 'window-frames'],
      roof: ['roof', 'roof-courses', 'clock-gables', 'finial'],
      clocks: clocks.map(clock => clock.name),
      garden: ['garden', 'planters', 'lantern-frame', 'lantern-pane'],
    },
  }
  root.userData.anim = (t, dt, state = {}) => {
    const time = Number.isFinite(t) ? t : 0
    const night = state.night === true ? 1 : Number.isFinite(state.night) ? THREE.MathUtils.clamp(state.night, 0, 1) : 0
    glow.emissiveIntensity = night * 0.7
    const hour = Number.isFinite(state.hour) ? state.hour : 10.1
    for (const { pivot, hand } of clockHands) pivot.rotation.z = -TAU * (hand === 'hour' ? ((hour % 12) + 12) % 12 / 12 : ((hour % 1) + 1) % 1)
    if (bellPivot) bellPivot.rotation.z = Math.sin(time * 1.7) * 0.035
    if (vanePivot) vanePivot.rotation.y = Math.sin(time * 0.3) * 0.12
    if (pennantPivot) pennantPivot.rotation.y = Math.sin(time * 1.3) * 0.045
  }
  root.userData.anim(0, 0)
  return root
}
