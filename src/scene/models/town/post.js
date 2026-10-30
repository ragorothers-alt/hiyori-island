import * as THREE from 'three'

const TAU = Math.PI * 2

function batch(parent, name, material) {
  const positions = []
  const normals = []
  const colors = []
  const transform = new THREE.Object3D()
  const normalMatrix = new THREE.Matrix3()
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  return {
    add(geometry, position = [0, 0, 0], rotation = [0, 0, 0], color = '#ffffff', scale = [1, 1, 1]) {
      transform.position.fromArray(position)
      transform.rotation.set(...rotation)
      transform.scale.fromArray(scale)
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
      if (!positions.length) return null
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = name
      mesh.castShadow = !material.transparent
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    },
  }
}

function box(target, x, y, z, w, h, d, color, rotation = [0, 0, 0]) {
  target.add(new THREE.BoxGeometry(w, h, d), [x, y, z], rotation, color)
}

function beam(target, a, b, width, depth, color) {
  const start = new THREE.Vector3(...a)
  const end = new THREE.Vector3(...b)
  const direction = end.clone().sub(start)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
  const r = new THREE.Euler().setFromQuaternion(q)
  target.add(new THREE.BoxGeometry(width, direction.length(), depth), start.add(end).multiplyScalar(0.5).toArray(), [r.x, r.y, r.z], color)
}

function profile(points, depth) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 10 })
}

function gable(target, width, eave, rise, depth, color, x = 0, z = 0) {
  target.add(profile([[-width / 2, 0], [width / 2, 0], [0, rise]], depth), [x, eave, z - depth / 2], [0, 0, 0], color)
}

function roof(target, width, depth, peak, slope, color, x = 0, z = 0) {
  const half = width / 2
  const length = half * Math.sqrt(1 + slope * slope)
  for (const side of [-1, 1]) {
    box(target, x + side * half / 2, peak - half * slope / 2, z, length + 0.025, 0.06, depth, color, [0, 0, -side * Math.atan(slope)])
  }
}

function fold(points) {
  const positions = []
  const center = new THREE.Vector3()
  const vertices = points.map(p => new THREE.Vector3(...p))
  vertices.forEach(v => center.add(v))
  center.multiplyScalar(0.25)
  for (const face of [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]]) {
    const [a, b, c] = face.map(i => vertices[i])
    const normal = b.clone().sub(a).cross(c.clone().sub(a))
    const outward = a.clone().add(b).add(c).multiplyScalar(1 / 3).sub(center)
    const ordered = normal.dot(outward) < 0 ? [a, c, b] : [a, b, c]
    ordered.forEach(v => positions.push(v.x, v.y, v.z))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.computeVertexNormals()
  return g
}

export function buildPostOffice(stage = 1) {
  stage = THREE.MathUtils.clamp(Math.floor(Number.isFinite(stage) ? stage : 1), 1, 5)
  const group = new THREE.Group()
  group.name = `post-office-${stage}`
  const ownedMaterials = []
  const material = (options = {}) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, ...options })
    ownedMaterials.push(m)
    return m
  }
  const plaster = material({ roughness: 0.94 })
  const timber = material()
  const tile = material({ roughness: 0.84 })
  const enamel = material({ roughness: 0.52 })
  const stone = material({ roughness: 0.97, flatShading: true })
  const paper = material({ roughness: 0.94 })
  const glow = material({ roughness: 0.72, emissive: '#ffc36f', emissiveIntensity: 0 })
  const cream = '#f6e6c8'
  const red = '#c75443'
  const wood = '#bd925f'
  const darkWood = '#8d6340'
  const parts = {}
  const birds = []
  let planePivot
  let flagMesh
  let flagPositions
  const part = (name, mat) => {
    const p = new THREE.Group()
    p.name = name
    group.add(p)
    parts[name] = p
    return batch(p, `${name}-mesh`, mat)
  }
  const base = part('foundation', stone)
  const radius = [0.84, 1.04, 1.29, 1.49, 1.64][stage - 1]
  base.add(new THREE.CylinderGeometry(radius, radius, 0.055, 28), [0, 0.0275, 0], [0, 0, 0], '#c5bcaa')
  const post = part('mailbox', enamel)
  const mx = stage === 1 ? -0.32 : stage === 2 ? -0.66 : -0.98
  const mz = stage === 1 ? 0.06 : 0.43
  const mr = stage === 1 ? 0.19 : 0.145
  const mh = stage === 1 ? 0.87 : 0.79
  base.add(new THREE.CylinderGeometry(mr + 0.035, mr + 0.045, 0.1, 14), [mx, 0.05, mz], [0, 0, 0], '#aca99e')
  post.add(new THREE.CylinderGeometry(mr, mr, mh - 0.12, 18), [mx, 0.1 + (mh - 0.12) / 2, mz], [0, 0, 0], red)
  post.add(new THREE.SphereGeometry(mr + 0.027, 18, 7, 0, TAU, 0, Math.PI / 2), [mx, mh - 0.02, mz], [0, 0, 0], '#d55743', [1, 0.32, 1])
  post.finish()

  let entranceZ = 0.55
  let maxY = 1.25
  const width = stage === 2 ? 1.12 : 1.58
  const depth = stage === 2 ? 0.84 : 1.16
  const eave = stage === 2 ? 1.12 : 1.38
  const peak = stage === 2 ? 1.62 : 2.12
  const roofWidth = stage === 2 ? 1.38 : 1.99
  const roofDepth = stage === 2 ? 1.14 : 1.5
  const slope = (peak - eave + 0.025) / (roofWidth / 2)
  const rz = stage === 2 ? -0.13 : -0.06

  if (stage === 1) {
    const letterbox = part('letterbox', timber)
    box(letterbox, 0.31, 0.43, -0.11, 0.075, 0.86, 0.075, darkWood)
    box(letterbox, 0.31, 0.88, -0.11, 0.37, 0.29, 0.27, wood)
    letterbox.finish()
    const cap = part('letterbox-roof', tile)
    roof(cap, 0.48, 0.39, 1.2, 0.68, red, 0.31, -0.11)
    cap.finish()
  } else {
    box(base, 0, 0.06, rz, width + 0.08, 0.12, depth + 0.09, '#bcb5a7')
    const walls = part('cottage', plaster)
    if (stage === 2) {
      box(walls, 0, 0.62, rz - depth / 2 + 0.06, width, 1, 0.12, cream)
      for (const side of [-1, 1]) box(walls, side * (width / 2 - 0.055), 0.62, rz, 0.11, 1, depth, cream)
      box(walls, 0, 0.39, rz + depth / 2, width, 0.54, 0.08, cream)
    } else box(walls, 0, (eave + 0.12) / 2, rz, width, eave - 0.12, depth, cream)
    gable(walls, width, eave - 0.02, peak - eave - 0.08, depth, cream, 0, rz)
    walls.finish()
    const mainRoof = part('roof', tile)
    roof(mainRoof, roofWidth, roofDepth, peak, slope, red, 0, rz)
    mainRoof.finish()
    entranceZ = rz + depth / 2 + 0.08
    maxY = peak + 0.05
    const sign = part('envelope', paper)
    box(sign, 0, stage === 2 ? 1.02 : 1.38, entranceZ + 0.055, stage === 2 ? 0.49 : 0.65, stage === 2 ? 0.28 : 0.34, 0.07, '#fff0cc')
    sign.finish()
    if (stage >= 3) {
      const door = part('door', enamel)
      box(door, 0, 0.655, rz + depth / 2 + 0.04, 0.51, 1.05, 0.06, red)
      door.finish()
      const window = part('window', glow)
      window.add(new THREE.CylinderGeometry(0.185, 0.185, 0.035, 24), [0, 1.77, rz + depth / 2 + 0.015], [Math.PI / 2, 0, 0], '#706c54')
      window.finish()
    }
    if (stage >= 4) {
      const shed = part('shed', plaster)
      box(shed, 1.02, 0.6, -0.09, 0.58, 1.1, 0.96, cream)
      shed.finish()
      const shedRoof = part('shed-roof', tile)
      box(shedRoof, stage === 4 ? 1.01 : 1.075, 1.2, -0.09, stage === 4 ? 0.68 : 0.79, 0.055, stage === 4 ? 1.05 : 1.18, red, [0, 0, -0.22])
      shedRoof.finish()
      const parcels = part('parcels', paper)
      box(parcels, 1.13, 0.18, 0.59, 0.32, 0.3, 0.28, '#e4c18a')
      box(parcels, 1.08, 0.41, 0.59, 0.22, 0.17, 0.22, '#f5dfb3')
      parcels.finish()
    }
    if (stage === 5) {
      const tower = part('tower', plaster)
      box(tower, 0.38, 2.36, -0.28, 0.46, 1.27, 0.46, cream)
      tower.finish()
      const towerRoof = part('tower-roof', tile)
      towerRoof.add(new THREE.ConeGeometry(0.48, 0.39, 4), [0.38, 3.09, -0.28], [0, Math.PI / 4, 0], red)
      towerRoof.finish()
      const pole = part('flagpole', timber)
      box(pole, 0.38, 3.34, -0.28, 0.025, 0.32, 0.025, wood)
      pole.finish()
      const flagPivot = new THREE.Group()
      flagPivot.name = 'flag'
      flagPivot.position.set(0.39, 3.47, -0.28)
      group.add(flagPivot)
      parts.flag = flagPivot
      const flag = batch(flagPivot, 'flag-cloth', tile)
      flag.add(profile([[0, 0], [0.39, -0.025], [0.3, -0.115], [0.39, -0.2], [0, -0.18]], 0.015), [0, 0, 0], [0, 0, 0], red)
      flagMesh = flag.finish()
      flagPositions = flagMesh.geometry.attributes.position.array.slice()
      const flight = new THREE.Group()
      flight.name = 'cranes'
      group.add(flight)
      parts.cranes = flight
      for (let i = 0; i < 3; i++) {
        const bird = new THREE.Group()
        bird.name = `paper-crane-${i}`
        const a = i * TAU / 3
        bird.position.set(0.38 + Math.cos(a) * 0.83, 2.78 + i * 0.09, -0.28 + Math.sin(a) * 0.83)
        bird.rotation.y = -a
        flight.add(bird)
        const body = batch(bird, `crane-${i}-body`, paper)
        body.add(fold([[0, 0.04, 0.11], [-0.04, 0, -0.1], [0.04, 0, -0.1], [0, -0.025, 0]]), [0, 0, 0], [0, 0, 0], '#fff1cf')
        body.add(fold([[0, 0.03, 0.09], [0, 0.18, 0.19], [0.018, 0.16, 0.15], [-0.015, 0.02, 0.06]]), [0, 0, 0], [0, 0, 0], '#f8dfb7')
        body.add(fold([[0, 0.18, 0.19], [0, 0.13, 0.24], [0.022, 0.16, 0.17], [-0.012, 0.16, 0.17]]), [0, 0, 0], [0, 0, 0], '#f2d4a1')
        body.add(fold([[0, 0.01, -0.06], [0, 0.14, -0.26], [-0.021, 0, -0.09], [0.021, 0, -0.09]]), [0, 0, 0], [0, 0, 0], '#fff2d9')
        body.finish()
        const wings = []
        for (const side of [-1, 1]) {
          const wing = new THREE.Group()
          wing.name = `crane-${i}-wing-${side}`
          bird.add(wing)
          const folds = batch(wing, `crane-${i}-wing-${side}-mesh`, paper)
          folds.add(fold([[0, 0.035, 0.07], [side * 0.26, 0.16, -0.03], [0, 0.015, -0.105], [side * 0.05, 0.025, -0.01]]), [0, 0, 0], [0, 0, 0], side < 0 ? '#fff4dd' : '#f2d9af')
          folds.finish()
          wings.push(wing)
        }
        birds.push({ bird, wings, phase: a })
      }
      maxY = 3.5
    }
  }
  if (stage >= 3) {
    const foliage = part('foliage', material({ roughness: 0.97, flatShading: true }))
    const clusters = stage >= 4 ? [[-1.08, 0.8, -0.35], [-0.99, 1.44, -0.25], [-0.78, 1.63, -0.43], [1.19, 1.33, -0.51], [1.18, 0.74, -0.56]] : [[-1.02, 0.78, -0.28], [-0.91, 1.2, -0.36]]
    for (let i = 0; i < clusters.length; i++) {
      const [x, y, z] = clusters[i]
      beam(foliage, [x, 0.055, z], [x, y, z], 0.026, 0.026, wood)
      foliage.add(new THREE.IcosahedronGeometry(1, 0), [x, y, z], [0, i, 0], i % 2 ? '#91a464' : '#7f9755', [0.22, 0.3, 0.23])
    }
    if (stage >= 4) {
      for (const [x, z] of [[-1.24, 0.18], [-1.11, 0.72], [1.28, 0.48], [1.35, -0.44]]) {
        foliage.add(new THREE.IcosahedronGeometry(1, 0), [stage === 4 ? x * 0.92 : x, 0.29, z], [0, x * 3, 0], '#899f5e', [0.17, 0.25, 0.18])
      }
    }
    foliage.finish()
  }
  base.finish()
  const postalTrim = part('mailbox-trim', enamel)
  for (const y of [0.14, mh - 0.05, mh - 0.1]) {
    postalTrim.add(new THREE.CylinderGeometry(mr + 0.014, mr + 0.014, 0.025, 18), [mx, y, mz], [0, 0, 0], y < 0.2 ? '#a93932' : '#e2674c')
  }
  postalTrim.add(new THREE.SphereGeometry(0.022, 8, 5), [mx, mh + mr * 0.32 - 0.012, mz], [0, 0, 0], '#a73a30')
  box(postalTrim, mx, mh - 0.205, mz + mr - 0.003, mr * 1.45, 0.105, 0.027, '#f4dec0')
  box(postalTrim, mx, mh - 0.194, mz + mr + 0.014, mr * 1.08, 0.022, 0.006, '#6b4e3b')
  postalTrim.finish()
  const frame = part('frame', timber)
  const envelope = (target, x, y, z, w, h) => {
    box(target, x, y, z, w + 0.065, h + 0.055, 0.045, darkWood)
    box(target, x, y, z + 0.027, w, h, 0.018, '#fff0cf')
    target.add(profile([[-w / 2, h / 2], [w / 2, h / 2], [0, -h * 0.06]], 0.01), [x, y, z + 0.042], [0, 0, 0], '#f7d6a0')
    for (const side of [-1, 1]) beam(target, [x, y - h * 0.06, z + 0.053], [x + side * w / 2, y + h / 2, z + 0.053], 0.012, 0.008, '#bb8b58')
  }
  if (stage === 1) {
    envelope(frame, 0.31, 0.88, 0.037, 0.27, 0.18)
    for (const side of [-1, 1]) beam(frame, [0.31, 1.19, 0.095], [0.31 + side * 0.23, 1.04, 0.095], 0.035, 0.035, '#e5bc85')
  } else {
    const frontZ = rz + depth / 2 + 0.045
    for (const x of [-width / 2 + 0.025, width / 2 - 0.025]) {
      for (const z of [rz - depth / 2 + 0.005, frontZ]) box(frame, x, (eave + 0.1) / 2, z, 0.09, eave - 0.1, 0.09, wood)
      box(frame, x, 0.3, rz, 0.09, 0.095, depth + 0.07, '#ae814e')
      box(frame, x, eave - 0.03, rz, 0.11, 0.12, depth + 0.09, wood)
    }
    for (const z of [frontZ, rz - depth / 2 - 0.025]) {
      box(frame, 0, eave - 0.03, z, width + 0.12, 0.12, 0.09, wood)
      for (const side of [-1, 1]) beam(frame, [0, peak - 0.035, z], [side * roofWidth / 2, peak - roofWidth * slope / 2, z], 0.075, 0.08, '#d4ad75')
    }
    if (stage === 2) {
      box(frame, 0, 0.65, frontZ + 0.025, 1.13, 0.085, 0.24, wood)
      envelope(frame, 0, 1.02, entranceZ + 0.104, 0.43, 0.23)
    } else {
      for (const x of [-0.3, 0.3]) box(frame, x, 0.68, frontZ + 0.035, 0.075, 1.15, 0.09, '#af3f33')
      box(frame, 0, 1.235, frontZ + 0.035, 0.68, 0.085, 0.1, '#ac3c30')
      const canopy = part('canopy', tile)
      box(canopy, 0, 1.28, frontZ + 0.125, 1.27, 0.06, 0.38, red, [0.23, 0, 0])
      canopy.finish()
      box(frame, 0, 1.21, frontZ + 0.31, 1.31, 0.075, 0.07, wood)
      for (const side of [-1, 1]) beam(frame, [side * 0.5, 1.01, frontZ], [side * 0.5, 1.21, frontZ + 0.24], 0.045, 0.045, darkWood)
      envelope(frame, 0, 1.38, entranceZ + 0.104, 0.59, 0.28)
      frame.add(new THREE.TorusGeometry(0.186, 0.031, 6, 24), [0, 1.77, frontZ + 0.026], [0, 0, 0], '#c2935b')
      box(frame, 0, 1.77, frontZ + 0.04, 0.027, 0.34, 0.035, '#ba8953')
      box(frame, 0, 1.77, frontZ + 0.04, 0.34, 0.027, 0.035, '#ba8953')
      if (stage >= 4) {
        for (const x of [0.82, 1.27]) {
          for (const z of [-0.51, 0.36]) box(frame, x, 0.62, z, 0.07, 1.15, 0.07, wood)
          box(frame, x, 0.33, -0.09, 0.075, 0.075, 0.92, darkWood)
          box(frame, x, 1.09, -0.09, 0.075, 0.075, 0.92, wood)
        }
        for (const y of [0.32, 1.08]) box(frame, 1.04, y, 0.4, 0.55, 0.07, 0.08, wood)
      }
      if (stage === 5) {
        for (const y of [1.9, 2.68, 2.95]) box(frame, 0.38, y, -0.28, 0.58, 0.075, 0.58, wood)
        for (const x of [0.15, 0.61]) {
          for (const z of [-0.51, -0.05]) box(frame, x, 2.81, z, 0.045, 0.27, 0.045, '#d0a575')
        }
        const openings = part('tower-openings', glow)
        const arch = profile([[-0.067, 0], [0.067, 0], [0.067, 0.12], [0.047, 0.17], [0, 0.188], [-0.047, 0.17], [-0.067, 0.12]], 0.017)
        for (let side = 0; side < 4; side++) {
          const a = side * Math.PI / 2
          openings.add(arch.clone(), [0.38 + Math.sin(a) * 0.232, 2.73, -0.28 + Math.cos(a) * 0.232], [0, a, 0], '#584a36')
        }
        arch.dispose()
        openings.finish()
      }
    }
  }
  frame.finish()
  if (stage >= 2) {
    const tiles = part('tile-courses', tile)
    const half = roofWidth / 2
    const rows = stage === 2 ? 4 : 5
    const columns = stage === 2 ? 5 : 7
    const angle = Math.atan(slope)
    for (const side of [-1, 1]) {
      for (let row = 0; row < rows; row++) {
        const x = (row + 0.5) * half / rows
        for (let col = 0; col < columns; col++) {
          const z = rz - roofDepth / 2 + (col + 0.5) * roofDepth / columns
          const color = ['#ca5e4c', '#c55947', '#ce644f', '#bf5444'][(row * 3 + col + (side > 0 ? 1 : 0)) % 4]
          box(tiles, side * x, peak - x * slope + 0.043, z, half / rows * Math.sqrt(1 + slope * slope) - 0.006, 0.028, roofDepth / columns - 0.014, color, [0, 0, -side * angle])
        }
      }
    }
    for (let i = 0; i < columns; i++) tiles.add(new THREE.CylinderGeometry(0.058, 0.058, roofDepth / columns - 0.008, 8), [0, peak + 0.058, rz - roofDepth / 2 + (i + 0.5) * roofDepth / columns], [Math.PI / 2, 0, 0], '#be4535')
    tiles.finish()
    maxY = Math.max(maxY, peak + 0.116)
    const windows = part('door-panes', glow)
    const mullions = part('door-details', timber)
    const fz = rz + depth / 2 + 0.084
    if (stage >= 3) {
      for (const x of [-0.115, 0.115]) {
        for (let row = 0; row < 3; row++) box(windows, x, 0.815 + row * 0.125, fz, 0.18, 0.095, 0.008, '#dcc17f')
        box(mullions, x, 0.38, fz, 0.18, 0.31, 0.012, '#ad3c32')
        box(mullions, x, 0.38, fz + 0.01, 0.14, 0.27, 0.01, '#cd5743')
      }
      mullions.add(new THREE.SphereGeometry(0.025, 9, 6), [0.175, 0.67, fz + 0.026], [0, 0, 0], '#d8b16a')
      for (const side of [-1, 1]) {
        const sideX = side * (width / 2 + 0.012)
        box(windows, sideX, 0.84, rz - 0.12, 0.02, 0.4, 0.32, '#b9aa72')
        for (const z of [rz - 0.31, rz + 0.07]) box(mullions, sideX + side * 0.012, 0.84, z, 0.045, 0.47, 0.045, wood)
        for (const y of [0.61, 0.84, 1.07]) box(mullions, sideX + side * 0.012, y, rz - 0.12, 0.05, 0.04, 0.43, wood)
        box(mullions, sideX + side * 0.025, 0.84, rz - 0.12, 0.05, 0.43, 0.028, wood)
      }
    } else {
      for (const x of [-0.22, 0.18]) {
        box(windows, x, 0.78, rz - depth / 2 + 0.069, 0.25, 0.33, 0.012, '#68503c')
        box(mullions, x, 0.77, rz - depth / 2 + 0.09, 0.018, 0.32, 0.018, wood)
      }
    }
    windows.finish()
    mullions.finish()
  }
  if (stage >= 4) {
    const ribbons = part('parcel-ribbon', enamel)
    for (const [x, y, w, h, d] of [[1.13, 0.18, 0.32, 0.3, 0.28], [1.08, 0.41, 0.22, 0.17, 0.22]]) {
      box(ribbons, x, y, 0.59, 0.024, h + 0.004, d + 0.004, '#c35543')
      box(ribbons, x, y, 0.59, w + 0.004, 0.025, d + 0.007, '#d67655')
    }
    ribbons.finish()
    planePivot = new THREE.Group()
    planePivot.name = 'paper-plane'
    planePivot.position.set(1.02, 0.89, 0.49)
    group.add(planePivot)
    parts['paper-plane'] = planePivot
    const plane = batch(planePivot, 'paper-plane-folds', paper)
    plane.add(fold([[0, -0.018, 0.19], [-0.16, 0.02, -0.1], [0, 0.06, -0.065], [0, 0.004, -0.08]]), [0, 0, 0], [0, 0, 0], '#fff4d6')
    plane.add(fold([[0, -0.018, 0.19], [0.16, 0.02, -0.1], [0, 0.06, -0.065], [0, 0.004, -0.08]]), [0, 0, 0], [0, 0, 0], '#ead6ae')
    plane.finish()
    const string = part('plane-suspension', timber)
    string.add(new THREE.CylinderGeometry(0.004, 0.004, 0.28, 5), [1.02, 1.06, 0.49], [0, 0, 0], '#b69462')
    string.finish()
  }
  const cobbles = part('cobbles', stone)
  const count = stage === 1 ? 14 : stage === 2 ? 18 : 24
  for (let i = 0; i < count; i++) {
    const a = i * TAU / count
    const r = radius - 0.055
    box(cobbles, Math.sin(a) * r, 0.046, Math.cos(a) * r, 0.18, 0.047, 0.09, ['#c4bba9', '#b8ae9d', '#d2c6b0', '#cabea8'][i % 4], [0, a, 0])
  }
  const pavingExtent = Math.ceil(radius / 0.23)
  for (let row = -pavingExtent; row <= pavingExtent; row++) {
    for (let col = -pavingExtent; col <= pavingExtent; col++) {
      const x = col * 0.27 + (row % 2) * 0.12
      const z = row * 0.23
      if (Math.hypot(x, z) > radius - 0.23) continue
      box(cobbles, x, 0.058, z, 0.252, 0.02, 0.212, (row + col) % 3 ? '#d8cdb6' : '#cabc9f')
    }
  }
  cobbles.finish()
  if (stage >= 3) {
    const surface = part('timber-seams', timber)
    for (const side of [-1, 1]) {
      const x = side * (width / 2 - 0.025)
      for (let i = 0; i < 2; i++) box(surface, x - 0.014 + i * 0.025, 0.67, rz + depth / 2 + 0.092, 0.005, 1.01 - i * 0.13, 0.004, '#a27b4f')
      beam(surface, [side * 0.67, 0.17, -0.49], [side * 0.95, 1.23, -0.36], 0.055, 0.055, '#8b7045')
    }
    if (stage === 5) {
      const frontArch = profile([[-0.07, 0], [0.07, 0], [0.07, 0.13], [0.05, 0.18], [0, 0.195], [-0.05, 0.18], [-0.07, 0.13]], 0.018)
      for (const [x, z, angle] of [[0.38, -0.036, 0], [0.622, -0.28, Math.PI / 2]]) {
        surface.add(frontArch.clone(), [x, 2.25, z], [0, angle, 0], '#a67b4d')
        surface.add(frontArch.clone(), [x, 2.265, z], [0, angle, 0], '#71583a', [0.68, 0.79, 1.2])
      }
      frontArch.dispose()
      for (const z of [-0.5, -0.06]) box(surface, 0.38, 2.245, z, 0.22, 0.035, 0.04, '#c29b67')
    }
    surface.finish()
  }
  const lanternGlass = material({ roughness: 0.8, emissive: '#ffc477', emissiveIntensity: 0 })
  if (stage >= 2) {
    const lampFrames = part('lantern-frames', material({ metalness: 0.3, roughness: 0.65 }))
    const lampPanes = part('lanterns', lanternGlass)
    const fz = rz + depth / 2 + 0.17
    const y = stage === 2 ? 0.87 : 1.005
    for (const side of [-1, 1]) {
      const x = side * (stage === 2 ? 0.46 : 0.59)
      beam(lampFrames, [x, y + 0.12, fz - 0.13], [x, y + 0.12, fz], 0.018, 0.018, '#8a673d')
      for (const yy of [y - 0.087, y + 0.087]) box(lampFrames, x, yy, fz, 0.125, 0.018, 0.105, '#987544')
      lampFrames.add(new THREE.ConeGeometry(0.095, 0.07, 4), [x, y + 0.128, fz], [0, Math.PI / 4, 0], '#997344')
      for (const dx of [-0.052, 0.052]) {
        for (const dz of [-0.042, 0.042]) box(lampFrames, x + dx, y, fz + dz, 0.013, 0.17, 0.013, '#9b7847')
      }
      box(lampPanes, x, y, fz, 0.092, 0.15, 0.075, '#ffdda0')
    }
    if (stage === 5) {
      box(lampPanes, 0.38, 2.24, -0.018, 0.052, 0.07, 0.024, '#ffe2a4')
      box(lampFrames, 0.38, 2.19, -0.018, 0.09, 0.025, 0.06, '#987544')
    }
    lampFrames.finish()
    lampPanes.finish()
  }
  const nodes = {}
  const meshes = {}
  group.traverse(object => {
    if (object.name) nodes[object.name] = object
    if (object.isMesh) meshes[object.name] = object
  })
  group.userData.front = new THREE.Vector3(0, 0, entranceZ + 0.35)
  group.userData.top = new THREE.Vector3(0, maxY + 0.35, 0)
  group.userData.anim = (t, dt, state = {}) => {
    const night = state?.night ?? 0
    const time = Number.isFinite(t) ? t : 0
    const n = night === true ? 1 : Number.isFinite(night) ? THREE.MathUtils.clamp(night, 0, 1) : 0
    glow.emissiveIntensity = n * 0.65
    lanternGlass.emissiveIntensity = n * 0.85
    if (planePivot) {
      planePivot.rotation.y = Math.sin(time * 0.85) * 0.22
      planePivot.rotation.z = Math.sin(time * 1.25) * 0.12
    }
    for (let i = 0; i < birds.length; i++) {
      const { bird, wings, phase } = birds[i]
      const a = time * 0.38 + phase
      bird.position.set(0.38 + Math.cos(a) * 0.83, 2.78 + i * 0.07 + Math.sin(time * 1.2 + phase) * 0.075, -0.28 + Math.sin(a) * 0.83)
      bird.rotation.set(Math.sin(time * 1.1 + phase) * 0.06, -a, Math.sin(time * 0.6 + phase) * 0.08)
      wings[0].rotation.z = Math.sin(time * 2.5 + phase) * 0.16
      wings[1].rotation.z = -Math.sin(time * 2.5 + phase) * 0.16
    }
    if (flagMesh) {
      const position = flagMesh.geometry.attributes.position
      for (let i = 0; i < position.count; i++) {
        const x = flagPositions[i * 3]
        position.setZ(i, flagPositions[i * 3 + 2] + Math.sin(time * 2.8 - x * 11) * x * 0.16)
      }
      position.needsUpdate = true
      flagMesh.geometry.computeVertexNormals()
    }
  }
  const sockets = {}
  for (const name of ['front', 'top']) {
    const socket = new THREE.Object3D()
    socket.name = `${name}-socket`
    socket.position.copy(group.userData[name])
    group.add(socket)
    sockets[name] = socket
    nodes[socket.name] = socket
  }
  group.userData.sculptRuntime = {
    nodes,
    meshes,
    sockets,
    colliders: [
      { id: 'mailbox', type: 'cylinder', center: [mx, mh / 2, mz], radius: mr, height: mh },
      ...(stage > 1 ? [{ id: 'cottage', type: 'box', center: [0, eave / 2, rz], size: [width, eave, depth] }] : []),
      { id: 'front', type: 'box', center: [0, 0.65, entranceZ + 0.15], size: [0.55, 1.3, 0.3], isTrigger: true },
    ],
    destructionGroups: {
      building: ['cottage', 'frame', 'roof', 'tile-courses', 'door', 'canopy'],
      postal: ['mailbox', 'mailbox-trim', 'letterbox', 'envelope', 'parcels'],
      tower: ['tower', 'tower-roof', 'tower-openings', 'flagpole', 'flag', 'cranes'],
    },
  }
  group.userData.ownedMaterials = ownedMaterials
  group.userData.ownedTextures = []
  return group
}
