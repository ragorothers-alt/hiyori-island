import * as THREE from 'three'

const TAU = Math.PI * 2
const WOOD = '#c9a27a'
const CREAM = '#fff3df'
const LEAF = '#8fbc80'

// 同材質依結構合批，避免花朵與木框增加繪製次數
function batch(parent, name, material) {
  const positions = []
  const normals = []
  const colors = []
  const transform = new THREE.Object3D()
  const normalMatrix = new THREE.Matrix3()
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  return {
    add(
      geometry,
      position,
      scale = [1, 1, 1],
      rotation = [0, 0, 0],
      color = CREAM,
    ) {
      transform.position.fromArray(position)
      transform.scale.fromArray(scale)
      transform.rotation.set(...rotation)
      transform.updateMatrix()
      normalMatrix.getNormalMatrix(transform.matrix)
      const tint = new THREE.Color(color)
      const source = geometry.index ? geometry.toNonIndexed() : geometry
      for (let i = 0; i < source.attributes.position.count; i++) {
        point
          .fromBufferAttribute(source.attributes.position, i)
          .applyMatrix4(transform.matrix)
        normal
          .fromBufferAttribute(source.attributes.normal, i)
          .applyMatrix3(normalMatrix)
          .normalize()
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
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      )
      geometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(normals, 3),
      )
      geometry.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(colors, 3),
      )
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = name
      mesh.castShadow = !material.transparent
      mesh.receiveShadow = !material.transparent
      parent.add(mesh)
      return mesh
    },
  }
}

function box(b, x, y, z, w, h, d, color = WOOD, rotation = [0, 0, 0]) {
  b.add(new THREE.BoxGeometry(w, h, d), [x, y, z], [1, 1, 1], rotation, color)
}

function ball(b, x, y, z, r, color, scale = [1, 1, 1]) {
  b.add(new THREE.IcosahedronGeometry(r, 0), [x, y, z], scale, [0, 0, 0], color)
}

function rod(b, a, end, r, color = WOOD) {
  const start = new THREE.Vector3(a[0], Math.max(r, a[1]), a[2])
  const finish = new THREE.Vector3(end[0], Math.max(r, end[1]), end[2])
  const delta = finish.clone().sub(start)
  const rotation = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.clone().normalize(),
    ),
  )
  b.add(
    new THREE.CylinderGeometry(r, r, delta.length(), 6),
    start.add(finish).multiplyScalar(0.5).toArray(),
    [1, 1, 1],
    [rotation.x, rotation.y, rotation.z],
    color,
  )
}

function profile(points, depth) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 6,
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

function roof(b, x, y, z, w, d, rise, color) {
  b.add(
    profile(
      [
        [-w / 2, 0],
        [0, rise],
        [w / 2, 0],
        [w / 2, -0.055],
        [0, rise - 0.055],
        [-w / 2, -0.055],
      ],
      d,
    ),
    [x, y, z],
    [1, 1, 1],
    [0, 0, 0],
    color,
  )
}

function context(stage, name, accent) {
  const group = new THREE.Group()
  group.name = name + '-' + stage
  const ownedMaterials = []
  const material = (options = {}) => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      flatShading: true,
      ...options,
    })
    ownedMaterials.push(m)
    return m
  }
  const solid = material()
  const windowMat = material({
    roughness: 0.3,
    emissive: '#ffc98d',
    emissiveIntensity: 0,
  })
  const bulbMat = material({
    emissive: '#ffd09a',
    emissiveIntensity: 0,
    roughness: 0.5,
  })
  const buckets = []
  const part = (name, mat = solid, parent = group) => {
    const b = batch(parent, name, mat)
    buckets.push(b)
    return b
  }
  const shell = part('shell')
  const roofs = part('roof')
  const garden = part('garden')
  const foundation = part('foundation')
  const frame = part('timber-frame')
  const glass = part('glazing', windowMat)
  const door = part('door')
  const sign = part('sign')
  const balcony = part('balcony')
  const wing = part('side-wing')
  const lamps = part('lanterns', bulbMat)
  const moving = new THREE.Group()
  moving.name = 'canopy-pivot'
  group.add(moving)
  const canopy = part('canopy', solid, moving)
  const cx = stage >= 4 ? -0.16 : 0
  const cz = stage === 5 ? -0.28 : -0.18
  const w = stage === 2 ? 1.25 : stage === 5 ? 1.76 : 1.62
  const d = stage === 2 ? 0.8 : stage === 5 ? 1.3 : 1.2
  const eave = [0, 0.98, 1.24, 1.62, 2.3, 2.44][stage]
  const rise = stage === 2 ? 0.38 : 0.49
  const front = stage === 1 ? 0.3 : cz + d / 2
  if (stage === 1) {
    box(shell, 0, 0.36, 0, 0.86, 0.33, 0.48, WOOD)
    box(foundation, 0, 0.55, 0, 0.98, 0.065, 0.59, '#dfbd98')
    for (const x of [-0.42, 0.42]) {
      shell.add(
        new THREE.TorusGeometry(0.135, 0.028, 5, 12),
        [x, 0.17, 0.08],
        [1, 1, 1],
        [0, Math.PI / 2, 0],
        '#927053',
      )
      rod(frame, [x, 0.17, 0.08], [x, 0.17, 0.08 + 0.001], 0.02)
    }
    rod(frame, [-0.2, 0.48, -0.1], [-0.2, 1.19, -0.1], 0.018)
    // 分瓣傘面延續店面主色
    for (let i = 0; i < 10; i++) {
      canopy.add(
        new THREE.ConeGeometry(
          0.51,
          0.18,
          1,
          1,
          false,
          (i * TAU) / 10,
          TAU / 10,
        ),
        [-0.2, 1.12, -0.1],
        [1, 1, 1],
        [0, 0, 0],
        i % 2 ? CREAM : accent,
      )
    }
    box(frame, 0, 0.1, -0.18, 0.72, 0.2, 0.06)
    rod(frame, [0.4, 0.42, 0], [0.66, 0.52, 0], 0.025)
  } else {
    box(foundation, cx, 0.055, cz, w + 0.08, 0.11, d + 0.08, '#ddc5ad')
    if (stage >= 3) {
      box(
        shell,
        cx,
        (eave + 0.1) / 2,
        cz,
        w,
        eave - 0.1,
        d,
        name === 'florist' ? CREAM : '#d3b28e',
      )
      shell.add(
        profile(
          [
            [-w / 2, 0],
            [0, rise],
            [w / 2, 0],
          ],
          d,
        ),
        [cx, eave, cz],
        [1, 1, 1],
        [0, 0, 0],
        CREAM,
      )
    } else {
      box(shell, cx, 0.4, cz, w, 0.58, d, WOOD)
      for (const x of [-w / 2 + 0.03, w / 2 - 0.03])
        for (const z of [-d / 2, d / 2])
          box(frame, x, 0.72, cz + z, 0.065, 1.24, 0.065)
    }
    roof(roofs, cx, eave, cz, w + 0.2, d + 0.19, rise, accent)
  }
  return {
    group,
    stage,
    accent,
    ownedMaterials,
    material,
    solid,
    windowMat,
    bulbMat,
    part,
    shell,
    roofs,
    garden,
    foundation,
    frame,
    glass,
    door,
    sign,
    balcony,
    wing,
    lamps,
    moving,
    canopy,
    buckets,
    cx,
    cz,
    w,
    d,
    eave,
    rise,
    front,
  }
}

function finish(c) {
  c.buckets.forEach((b) => b.finish())
  const bounds = new THREE.Box3().setFromObject(c.group)
  c.group.userData.front = new THREE.Vector3(
    c.stage === 1 ? 0 : c.stage >= 3 ? c.cx - 0.12 : c.cx,
    0,
    c.stage === 1
      ? 0.65
      : c.stage === 2
        ? 0.83
        : c.stage === 5 && c.group.name.startsWith('florist')
          ? 1.21
          : c.front + 0.76,
  )
  c.group.userData.top = new THREE.Vector3(
    c.stage === 1 ? -0.2 : c.puffs ? c.cx + 0.51 : c.cx,
    (c.puffs ? 3.6 : bounds.max.y) + 0.35,
    c.stage === 1 ? -0.1 : c.puffs ? -0.6 : c.cz,
  )
  c.group.userData.ownedMaterials = c.ownedMaterials
  c.group.userData.ownedTextures = []
  c.group.userData.anim = (t, dt, state = {}) => {
    const night = THREE.MathUtils.clamp(state.night ?? 0, 0, 1)
    c.windowMat.emissiveIntensity = night * 0.64
    c.bulbMat.emissiveIntensity = night * 0.78
    c.moving.rotation.z = Math.sin(t * 0.9) * 0.009
    if (c.steamPivot) c.steamPivot.position.y = (Math.sin(t * 0.75) + 1) * 0.008
    c.puffs?.forEach((puff, i) => {
      const u = (((t * 0.12 + i / 3) % 1) + 1) % 1
      puff.position.set(
        c.cx + 0.51 + Math.sin(t * 0.8 + i) * 0.02,
        3.33 + u * 0.2,
        -0.6 + Math.sin(t * 0.6 + i) * 0.025,
      )
      puff.scale.setScalar(0.6 + u * 0.8)
    })
  }
  const nodes = {}
  const meshes = {}
  c.group.traverse((object) => {
    if (object.name) nodes[object.name] = object
    if (object.isMesh) meshes[object.name] = object
  })
  const sockets = {}
  for (const key of ['front', 'top']) {
    const socket = new THREE.Object3D()
    socket.name = key
    socket.position.copy(c.group.userData[key])
    c.group.add(socket)
    sockets[key] = socket
  }
  c.group.userData.sculptRuntime = {
    nodes,
    meshes,
    sockets,
    colliders: [
      {
        id: 'shop',
        type: 'box',
        center: [c.cx, c.eave / 2, c.cz],
        size: [c.stage === 1 ? 0.86 : c.w, c.eave, c.stage === 1 ? 0.48 : c.d],
      },
    ],
    destructionGroups: {
      shell: ['shell', 'timber-frame', 'glazing', 'door'],
      roof: ['roof', 'sign', 'canopy'],
      garden: ['garden', 'side-wing', 'balcony', 'lanterns'],
    },
  }
  c.group.userData.anim(0, 0, { night: 0, hour: 12 })
  return c.group
}
function facade(c) {
  const {
    stage,
    cx,
    cz,
    w,
    d,
    front,
    eave,
    frame,
    glass,
    door,
    foundation,
    balcony,
    canopy,
    sign,
    accent,
  } = c
  if (stage === 1) {
    for (let i = 0; i < 6; i++)
      box(frame, -0.36 + i * 0.145, 0.36, 0.246, 0.012, 0.29, 0.015, '#b58c66')
    rod(frame, [-0.4, 0.18, 0.08], [0.4, 0.18, 0.08], 0.028, '#927053')
    for (const x of [-0.435, 0.435]) {
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3
        rod(
          frame,
          [x, 0.17, 0.08],
          [x, 0.17 + Math.sin(a) * 0.13, 0.08 + Math.cos(a) * 0.13],
          0.009,
          '#dfbd98',
        )
      }
    }
  } else {
    for (const side of [-1, 1]) {
      const x = cx + side * (w / 2 - 0.02)
      for (const z of [cz - d / 2, front + 0.015])
        box(frame, x, eave / 2 + 0.04, z, 0.065, eave, 0.065, '#b68c69')
    }
    for (const y of [0.16, eave - 0.035])
      box(frame, cx, y, front + 0.035, w + 0.06, 0.075, 0.065, '#b68c69')
    for (const side of [-1, 1]) {
      rod(
        frame,
        [cx, eave + c.rise, front + 0.09],
        [cx + side * (w / 2 + 0.1), eave - 0.015, front + 0.09],
        0.033,
        '#e9ca9f',
      )
    }
    if (stage >= 3) {
      const dx = cx - 0.12
      box(door, dx, 0.67, front + 0.023, 0.42, 1.12, 0.055, '#a68160')
      box(glass, dx, 0.9, front + 0.06, 0.3, 0.51, 0.022, '#bdd9da')
      box(frame, dx, 1.2, front + 0.065, 0.47, 0.06, 0.06, CREAM)
      for (const side of [-1, 1])
        box(
          frame,
          dx + side * 0.22,
          0.69,
          front + 0.055,
          0.045,
          1.08,
          0.05,
          CREAM,
        )
      ball(door, dx + 0.12, 0.62, front + 0.11, 0.026, '#f0c36a')
      box(foundation, dx, 0.04, front + 0.19, 0.57, 0.08, 0.32, '#e6d8c5')
      for (const side of [-1, 1]) {
        const x = cx + side * 0.56
        box(glass, x, 0.81, front + 0.025, 0.42, 0.78, 0.035, '#bcdade')
        for (const offset of [-0.23, 0, 0.23])
          box(frame, x + offset, 0.81, front + 0.06, 0.035, 0.84, 0.05, CREAM)
        for (const y of [0.4, 0.82, 1.22])
          box(frame, x, y, front + 0.06, 0.49, 0.035, 0.05, CREAM)
      }
      for (const side of [-1, 1]) {
        const sx = cx + side * (w / 2 + 0.015)
        box(glass, sx, 0.88, cz, 0.035, 0.68, 0.61, '#bcdade')
        for (const z of [cz - 0.32, cz, cz + 0.32])
          box(frame, sx + side * 0.025, 0.88, z, 0.04, 0.75, 0.04, CREAM)
        for (const y of [0.52, 0.88, 1.24])
          box(frame, sx + side * 0.025, y, cz, 0.04, 0.035, 0.67, CREAM)
      }
      // 背面保留窗框與橫樑，繞島時仍有完整立面
      box(glass, cx, 0.91, cz - d / 2 - 0.017, 0.65, 0.55, 0.022, '#bfdde0')
      for (const x of [-0.35, 0, 0.35])
        box(frame, cx + x, 0.91, cz - d / 2 - 0.035, 0.035, 0.62, 0.04, CREAM)
      for (const y of [0.61, 1.2])
        box(frame, cx, y, cz - d / 2 - 0.035, 0.73, 0.035, 0.04, CREAM)
    } else {
      box(foundation, 0, 0.7, front + 0.06, 1.35, 0.065, 0.4, '#dfbd98')
      box(glass, 0, 0.89, cz - d / 2 - 0.015, 0.65, 0.35, 0.02, '#bfdde0')
      box(frame, 0, 0.72, cz - d / 2 - 0.035, 0.9, 0.055, 0.055, CREAM)
    }
    // 固定後緣，僅前垂布小幅擺動
    const aw = w - 0.06
    const az = front + 0.2
    const ay = stage === 2 ? 1.15 : 1.44
    for (let i = 0; i < 9; i++) {
      const x = cx - aw / 2 + ((i + 0.5) * aw) / 9
      const col = i % 2 ? CREAM : accent
      box(frame, x, ay, az, aw / 9 + 0.002, 0.035, 0.43, col, [0.24, 0, 0])
      box(canopy, x, ay - 0.13, az + 0.21, aw / 9 + 0.002, 0.14, 0.025, col)
      canopy.add(
        new THREE.CylinderGeometry(
          aw / 18,
          aw / 18,
          0.026,
          8,
          1,
          false,
          0,
          Math.PI,
        ),
        [x, ay - 0.2, az + 0.211],
        [1, 1, 1],
        [Math.PI / 2, 0, 0],
        col,
      )
    }
    if (stage >= 4) {
      box(balcony, cx, 1.55, front + 0.11, w + 0.06, 0.09, 0.38, '#d9b48b')
      box(glass, cx, 1.98, front + 0.023, 1.05, 0.59, 0.025, '#bcdade')
      for (const x of [-0.55, 0, 0.55])
        box(frame, cx + x, 1.98, front + 0.06, 0.045, 0.65, 0.06, CREAM)
      for (const y of [1.66, 2.29])
        box(frame, cx, y, front + 0.06, 1.18, 0.045, 0.06, CREAM)
      for (let i = 0; i < 9; i++)
        box(
          balcony,
          cx - w / 2 + (i * w) / 8,
          1.82,
          front + 0.3,
          0.03,
          0.49,
          0.035,
        )
      box(balcony, cx, 2.07, front + 0.3, w + 0.07, 0.045, 0.06, '#e7c99e')
    }
  }
  const sy = stage === 1 ? 0.39 : eave + 0.17
  const sz = stage === 1 ? 0.3 : front + 0.115
  const sr = stage === 1 ? 0.14 : stage === 2 ? 0.16 : 0.2
  c.signPosition = [cx, sy, sz]
  c.signRadius = sr
  sign.add(
    new THREE.CylinderGeometry(sr + 0.023, sr + 0.023, 0.045, 20),
    [cx, sy, sz],
    [1, 1, 1],
    [Math.PI / 2, 0, 0],
    '#c59a6b',
  )
  sign.add(
    new THREE.CylinderGeometry(sr, sr, 0.052, 20),
    [cx, sy, sz + 0.012],
    [1, 1, 1],
    [Math.PI / 2, 0, 0],
    c.group.name.startsWith('florist') ? CREAM : '#456e5c',
  )
}

function cupIcon(c) {
  const [x, y, z] = c.signPosition
  const r = c.signRadius
  c.sign.add(
    profile(
      [
        [-r * 0.64, r * 0.12],
        [r * 0.45, r * 0.12],
        [r * 0.28, -r * 0.48],
        [-r * 0.43, -r * 0.48],
      ],
      0.035,
    ),
    [x, y, z + 0.055],
    [1, 1, 1],
    [0, 0, 0],
    CREAM,
  )
  c.sign.add(
    new THREE.TorusGeometry(r * 0.25, r * 0.07, 5, 10),
    [x + r * 0.47, y - r * 0.08, z + 0.055],
    [1, 1, 1],
    [0, 0, 0],
    CREAM,
  )
  box(
    c.sign,
    x - r * 0.05,
    y - r * 0.57,
    z + 0.06,
    r * 1.3,
    r * 0.1,
    0.03,
    '#f0c36a',
  )
}

function bloom(b, x, y, z, r, color) {
  rod(b, [x, y - r * 2.6, z], [x, y, z], 0.008, '#77a877')
  ball(b, x + r * 0.48, y - r * 1.5, z, r * 0.5, LEAF, [1.4, 0.45, 0.7])
  for (let i = 0; i < 5; i++) {
    const a = (i * TAU) / 5
    b.add(
      new THREE.OctahedronGeometry(r * 0.62),
      [x + Math.cos(a) * r * 0.65, y + Math.sin(a) * r * 0.65, z],
      [1, 1, 0.65],
      [0, 0, a],
      color,
    )
  }
  ball(b, x, y, z + r * 0.25, r * 0.36, '#f0c36a')
}

function planter(b, x, y, z, r = 0.12, color = '#e0b18e', flowers = true) {
  b.add(
    new THREE.CylinderGeometry(r, r * 0.74, r * 1.5, 8),
    [x, y + r * 0.75, z],
    [1, 1, 1],
    [0, 0, 0],
    color,
  )
  b.add(
    new THREE.TorusGeometry(r * 0.95, 0.014, 4, 10),
    [x, y + r * 1.5, z],
    [1, 1, 1],
    [Math.PI / 2, 0, 0],
    '#ead0b0',
  )
  ball(b, x, y + r * 1.65, z, r * 0.88, LEAF, [1.1, 0.6, 1])
  if (flowers) {
    const palette = ['#f19bb2', '#f0d27d', '#9bc9e6', '#b9a3d8']
    for (let i = 0; i < 3; i++) {
      const a = (i * TAU) / 3 + x * 2
      bloom(
        b,
        x + Math.cos(a) * r * 0.52,
        y + r * (2.35 + i * 0.18),
        z + Math.sin(a) * r * 0.52,
        r * 0.43,
        palette[(i + Math.round(Math.abs(x) * 5)) % 4],
      )
    }
  }
}

function rail(b, x, y, z, w, d, h = 0.3) {
  for (let i = 0; i <= 6; i++)
    box(b, x - w / 2 + (i * w) / 6, y + h / 2, z, 0.025, h, 0.025)
  box(b, x, y + h, z, w + 0.05, 0.04, 0.045, '#e6c798')
  for (const side of [-1, 1]) {
    box(b, x + (side * w) / 2, y + h, z - d / 2, 0.04, 0.04, d)
    for (let i = 1; i <= 3; i++)
      box(b, x + (side * w) / 2, y + h / 2, z - (i * d) / 3, 0.025, h, 0.025)
  }
}

function cup(b, x, y, z, r = 0.055) {
  b.add(
    new THREE.CylinderGeometry(r, r * 0.75, r * 1.3, 8),
    [x, y + r * 0.65, z],
    [1, 1, 1],
    [0, 0, 0],
    CREAM,
  )
  b.add(
    new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.006, 8),
    [x, y + r * 1.33, z],
    [1, 1, 1],
    [0, 0, 0],
    '#765543',
  )
  b.add(
    new THREE.TorusGeometry(r * 0.44, r * 0.12, 4, 8),
    [x + r, y + r * 0.7, z],
    [1, 1, 1],
    [0, 0, 0],
    CREAM,
  )
  b.add(
    new THREE.CylinderGeometry(r * 1.3, r * 1.3, 0.014, 10),
    [x, y - 0.007, z],
    [1, 1, 1],
    [0, 0, 0],
    '#e7d6b6',
  )
}

function table(c, x, y, z, size = 1) {
  const b = c.wing
  const r = 0.17 * size
  b.add(
    new THREE.CylinderGeometry(r, r, 0.035, 12),
    [x, y + 0.37 * size, z],
    [1, 1, 1],
    [0, 0, 0],
    '#e2c29c',
  )
  rod(b, [x, y, z], [x, y + 0.36 * size, z], 0.023, '#64776a')
  for (const side of [-1, 1]) {
    rod(
      b,
      [x, y + 0.05, z],
      [x + side * 0.12 * size, y + 0.018, z],
      0.015,
      '#64776a',
    )
    const sx = x + side * 0.265 * size
    box(b, sx, y + 0.23 * size, z, 0.15 * size, 0.035, 0.17 * size, '#5f8471')
    box(
      b,
      sx + side * 0.065 * size,
      y + 0.36 * size,
      z,
      0.025,
      0.22 * size,
      0.17 * size,
      '#5f8471',
    )
    for (const ox of [-0.05, 0.05])
      for (const oz of [-0.05, 0.05])
        rod(
          b,
          [sx + ox * size, y, z + oz * size],
          [sx + ox * size, y + 0.23 * size, z + oz * size],
          0.012,
        )
  }
  cup(c.garden, x, y + 0.39 * size, z, 0.037 * size)
}

function cafeForm(c) {
  const { stage, garden, frame, wing, front, cx } = c
  if (stage === 1) {
    cup(garden, 0.06, 0.585, 0.1, 0.07)
    cup(garden, -0.28, 0.585, 0.12, 0.055)
    ball(garden, 0.28, 0.7, -0.09, 0.085, '#b9c8c7', [0.85, 1.1, 0.85])
    garden.add(
      new THREE.CylinderGeometry(0.037, 0.05, 0.055, 8),
      [0.28, 0.79, -0.09],
      [1, 1, 1],
      [0, 0, 0],
      '#cbd4d0',
    )
    rod(garden, [0.22, 0.71, -0.09], [0.13, 0.78, -0.09], 0.018, '#b9c8c7')
    garden.add(
      new THREE.TorusGeometry(0.057, 0.013, 4, 8),
      [0.35, 0.72, -0.09],
      [1, 1, 1],
      [0, 0, 0],
      '#927053',
    )
  } else {
    if (stage === 2) {
      table(c, -0.38, 0, 0.64, 0.7)
      table(c, 0.38, 0, 0.64, 0.7)
      rod(wing, [0.48, 0, 0.42], [0.48, 1.05, 0.42], 0.014)
      wing.add(
        new THREE.ConeGeometry(0.31, 0.12, 10),
        [0.48, 1.05, 0.42],
        [1, 1, 1],
        [0, 0, 0],
        '#719b80',
      )
      for (const x of [-0.38, -0.12, 0.14, 0.4])
        cup(garden, x, 0.74, -0.02, 0.048)
    }
    if (stage >= 3) {
      // 空白黑板以杯形壓紋取代文字
      box(
        wing,
        cx + 0.83,
        0.3,
        0.72,
        0.28,
        0.42,
        0.045,
        '#aa825d',
        [0, 0, -0.08],
      )
      box(
        wing,
        cx + 0.83,
        0.3,
        0.75,
        0.23,
        0.34,
        0.018,
        '#49645a',
        [0, 0, -0.08],
      )
      for (const z of [0.61, 0.84])
        rod(wing, [cx + 0.72, 0, z], [cx + 0.83, 0.5, 0.72], 0.014)
      planter(garden, cx - 0.88, 0, 0.55, 0.12)
      for (const side of [-1, 1]) {
        box(
          garden,
          cx + side * 0.56,
          0.38,
          front + 0.1,
          0.4,
          0.13,
          0.18,
          '#be9670',
        )
        planter(garden, cx + side * 0.56, 0.4, front + 0.1, 0.085, '#be9670')
      }
    }
    if (stage >= 4) {
      table(c, cx - 0.26, 1.6, front + 0.12, 0.7)
      for (const x of [-0.62, 0.62])
        planter(garden, cx + x, 1.62, front + 0.13, 0.1)
      // 側邊花園露台落在圓形地塊內
      box(wing, 1.03, 0.08, -0.17, 0.58, 0.16, 1.1, '#d8b68f')
      table(c, 1.03, 0.17, -0.27, 0.68)
      rail(wing, 1.03, 0.16, 0.39, 0.58, 1.08, 0.28)
      planter(garden, 1.05, 0.17, -0.64, 0.1)
    }
    if (stage === 5) {
      // 甜點櫥窗：玻璃內真的有蛋糕與小麵包
      box(wing, cx + 0.48, 0.35, front + 0.23, 0.43, 0.48, 0.3, '#bd966f')
      const display = c.part(
        'pastry-glass',
        c.material({
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          roughness: 0.2,
          side: THREE.DoubleSide,
        }),
      )
      box(display, cx + 0.48, 0.65, front + 0.23, 0.43, 0.3, 0.3, '#d2e8e4')
      for (const y of [0.51, 0.78])
        box(wing, cx + 0.48, y, front + 0.23, 0.46, 0.028, 0.33, CREAM)
      for (const x of [0.28, 0.68])
        box(wing, cx + x, 0.65, front + 0.39, 0.018, 0.3, 0.02, CREAM)
      for (const x of [0.37, 0.57]) {
        garden.add(
          new THREE.CylinderGeometry(0.064, 0.064, 0.07, 10),
          [cx + x, 0.57, front + 0.26],
          [1, 1, 1],
          [0, 0, 0],
          '#fff1d0',
        )
        ball(garden, cx + x, 0.62, front + 0.26, 0.027, '#e28e9b')
        ball(
          garden,
          cx + x,
          0.82,
          front + 0.24,
          0.063,
          '#dba76b',
          [1, 0.65, 0.8],
        )
      }
      // 露台花架與側邊遮棚
      for (const z of [-0.69, 0.35])
        rod(wing, [1.27, 0.16, z], [1.27, 1.5, z], 0.025)
      for (let i = 0; i < 5; i++)
        box(
          wing,
          1.05,
          1.51,
          -0.61 + i * 0.22,
          0.59,
          0.04,
          0.08,
          i % 2 ? CREAM : c.accent,
        )
      rod(wing, [1.28, 1.48, -0.71], [1.28, 1.48, 0.38], 0.025)
      box(wing, cx + 0.51, 2.97, -0.6, 0.23, 0.59, 0.24, '#c6ae94')
      for (const y of [2.79, 2.97, 3.15])
        box(wing, cx + 0.51, y, -0.6, 0.26, 0.035, 0.26, '#e0c9aa')
      box(wing, cx + 0.51, 3.28, -0.6, 0.31, 0.065, 0.31, '#947d69')
      planter(garden, 1.15, 0.16, 0.31, 0.1)
    }
  }
}

function surface(c) {
  const { stage, cx, cz, w, d, front, eave, rise, frame, roofs, shell } = c
  if (stage === 1) return
  // 瓦片接縫以幾何表現，不依賴貼圖
  const half = (w + 0.2) / 2
  for (const side of [-1, 1]) {
    for (let i = 1; i <= 4; i++) {
      const x = (side * half * i) / 4
      const y = eave + rise * (1 - i / 4) + 0.012
      rod(
        roofs,
        [cx + x, y, cz - (d + 0.19) / 2],
        [cx + x, y, cz + (d + 0.19) / 2],
        0.009,
        stage === 2 ? '#deb58d' : c.accent,
      )
    }
  }
  rod(
    roofs,
    [cx, eave + rise + 0.012, cz - (d + 0.19) / 2],
    [cx, eave + rise + 0.012, cz + (d + 0.19) / 2],
    0.025,
    c.accent,
  )
  if (stage >= 3) {
    for (let i = 0; i < 8; i++) {
      const y = 0.2 + i * 0.15
      for (const side of [-1, 1]) {
        box(
          shell,
          cx + side * (w / 2 + 0.004),
          y,
          cz,
          0.015,
          0.014,
          d - 0.08,
          c.group.name.startsWith('cafe') ? '#c5a17c' : '#eadbc5',
        )
      }
    }
    // 二樓兩側小窗，補齊環視時的樓層讀感
    if (stage >= 4) {
      for (const side of [-1, 1]) {
        const x = cx + side * (w / 2 + 0.018)
        box(c.glass, x, 1.95, cz - 0.03, 0.024, 0.44, 0.44, '#bcdade')
        for (const z of [cz - 0.27, cz - 0.03, cz + 0.21])
          box(frame, x + side * 0.02, 1.95, z, 0.035, 0.5, 0.03, CREAM)
        for (const y of [1.7, 2.2])
          box(frame, x + side * 0.02, y, cz - 0.03, 0.035, 0.035, 0.52, CREAM)
      }
    }
  }
}

function lanterns(c) {
  const { stage, cx, front, frame, lamps } = c
  if (stage === 1) {
    ball(lamps, 0.35, 0.91, -0.1, 0.045, '#ffdfad', [0.8, 1.1, 0.8])
    rod(frame, [0.35, 0.98, -0.1], [0.35, 1.1, -0.1], 0.008, '#876e55')
  } else {
    const y = stage === 2 ? 0.98 : 1.13
    for (const side of [-1, 1]) {
      const x = cx + side * (c.w / 2 - 0.025)
      rod(
        frame,
        [x, y + 0.12, front],
        [x, y + 0.12, front + 0.14],
        0.014,
        '#8e7962',
      )
      box(lamps, x, y - 0.005, front + 0.14, 0.075, 0.14, 0.07, '#ffdda4')
      roof(frame, x, y + 0.08, front + 0.14, 0.13, 0.12, 0.055, '#897760')
      box(frame, x, y - 0.09, front + 0.14, 0.1, 0.025, 0.1, '#897760')
      for (const dx of [-0.047, 0.047])
        box(frame, x + dx, y, front + 0.18, 0.012, 0.16, 0.014, '#897760')
    }
  }
  if (stage === 5) {
    // 燈串都掛在屋簷或花架，無需實體光源
    const x0 = cx - c.w / 2
    const x1 = cx + c.w / 2
    const y = c.eave - 0.13
    let last = [x0, y, front + 0.1]
    for (let i = 1; i <= 10; i++) {
      const u = i / 10
      const next = [
        x0 + (x1 - x0) * u,
        y - Math.sin(u * Math.PI) * 0.12,
        front + 0.1,
      ]
      rod(frame, last, next, 0.008, '#96866d')
      ball(
        lamps,
        next[0],
        next[1] - 0.055,
        next[2],
        0.035,
        '#ffe3ae',
        [0.8, 1.15, 0.8],
      )
      rod(frame, next, [next[0], next[1] - 0.045, next[2]], 0.007, '#96866d')
      last = next
    }
    for (let i = 0; i < 6; i++) {
      const z = -0.68 + i * 0.2
      const yy = 1.46 - Math.sin((i / 5) * Math.PI) * 0.1
      if (c.group.name.startsWith('cafe')) {
        rod(frame, [1.28, yy, z], [1.28, yy - 0.045, z], 0.007, '#96866d')
        ball(lamps, 1.28, yy - 0.07, z, 0.034, '#ffe3ae')
      }
    }
  }
}

function steam(c) {
  const [x, y, z] = c.signPosition
  const r = c.signRadius
  const pivot = new THREE.Group()
  pivot.name = 'cup-steam-pivot'
  c.group.add(pivot)
  const b = c.part('cup-steam', c.solid, pivot)
  for (let i = 0; i < 3; i++) {
    const xx = x + (i - 1) * r * 0.33
    const points = []
    for (let j = 0; j < 6; j++)
      points.push(
        new THREE.Vector3(
          xx + Math.sin(j * 1.3 + i) * r * 0.07,
          y + r * (0.22 + j * 0.085),
          z + 0.064,
        ),
      )
    b.add(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        6,
        r * 0.035,
        4,
        false,
      ),
      [0, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
      CREAM,
    )
  }
  c.steamPivot = pivot
  if (c.stage === 5) {
    const mat = c.material({
      transparent: true,
      opacity: 0.19,
      depthWrite: false,
      color: '#fff9ed',
      vertexColors: false,
    })
    c.puffs = []
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.047, 1), mat)
      m.name = 'chimney-steam-' + i
      m.castShadow = false
      m.receiveShadow = false
      c.group.add(m)
      c.puffs.push(m)
    }
  }
}

export function buildCafe(stage = 1) {
  stage = Number.isInteger(stage) ? THREE.MathUtils.clamp(stage, 1, 5) : 1
  const c = context(stage, 'cafe', '#5f8471')
  facade(c)
  cupIcon(c)
  cafeForm(c)
  surface(c)
  lanterns(c)
  steam(c)
  return finish(c)
}
