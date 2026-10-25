import * as THREE from 'three'

const TAU = Math.PI * 2
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b)

// 封閉曲面共用接縫法線，避免雲身出現直線。
function surface(rows, columns, sample) {
  const positions = []
  const indices = []
  const point = new THREE.Vector3()
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= columns; j++) {
      sample(i / rows, j / columns * TAU, point)
      positions.push(point.x, point.y, point.z)
      if (i < rows && j < columns) {
        const a = i * (columns + 1) + j
        const b = a + columns + 1
        if (i > 0) indices.push(a, b, a + 1)
        if (i < rows - 1) indices.push(b, b + 1, a + 1)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const normals = geometry.attributes.normal
  for (let i = 0; i <= rows; i++) {
    const a = i * (columns + 1)
    const b = a + columns
    point.fromBufferAttribute(normals, a)
    point.add(new THREE.Vector3().fromBufferAttribute(normals, b)).normalize()
    normals.setXYZ(a, point.x, point.y, point.z)
    normals.setXYZ(b, point.x, point.y, point.z)
  }
  return geometry
}

function bodyPoint(u, phi, out) {
  const theta = u * Math.PI
  const x = 0.05 + 2.5 * Math.cos(theta)
  const taper = 0.3 + 0.7 * smooth(-2.45, 0.2, x)
  const ripple = 1 + 0.045 * Math.sin(theta * 7 + 1.5 * Math.sin(phi)) * Math.sin(phi * 5 + theta) + 0.023 * Math.sin(theta * 13 - phi * 3)
  const radius = Math.sin(theta) * taper * ripple
  return out.set(x, 0.035 + radius * 1.09 * Math.cos(phi), radius * 1.17 * Math.sin(phi))
}

function skinPoint(x, y, side, offset = 0.014) {
  const u = Math.acos(THREE.MathUtils.clamp((x - 0.05) / 2.5, -1, 1)) / Math.PI
  let lo = 0
  let hi = Math.PI
  const point = new THREE.Vector3()
  for (let i = 0; i < 18; i++) {
    const phi = (lo + hi) / 2
    bodyPoint(u, phi * side, point)
    if (point.y > y) lo = phi
    else hi = phi
  }
  bodyPoint(u, (lo + hi) / 2 * side, point)
  point.z += offset * side
  return point
}

function cloudPuff() {
  const geometry = new THREE.SphereGeometry(1, 20, 16)
  const positions = geometry.attributes.position
  const lobes = [
    [0.5, 0.75, 0.3], [-0.6, 0.6, 0.35], [0.1, 0.4, -0.9],
    [0.7, -0.3, 0.6], [-0.6, -0.5, 0.6], [0.2, -0.8, -0.4],
    [-0.8, 0.05, -0.5], [0.8, 0.35, -0.45],
  ].map(p => new THREE.Vector3(...p).normalize())
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    let relief = 1 + 0.018 * Math.sin(x * 8 + y * 3) * Math.cos(z * 7 - y * 2)
    for (const lobe of lobes) relief += 0.045 * Math.exp(22 * (x * lobe.x + y * lobe.y + z * lobe.z - 1))
    positions.setXYZ(i, x * relief, y * relief, z * relief)
  }
  geometry.computeVertexNormals()
  const normals = geometry.attributes.normal
  const shared = new Map()
  for (let i = 0; i < positions.count; i++) {
    const key = `${positions.getX(i).toFixed(5)},${positions.getY(i).toFixed(5)},${positions.getZ(i).toFixed(5)}`
    if (!shared.has(key)) shared.set(key, [])
    shared.get(key).push(i)
  }
  const normal = new THREE.Vector3()
  for (const vertices of shared.values()) {
    normal.set(0, 0, 0)
    for (const i of vertices) normal.add(new THREE.Vector3().fromBufferAttribute(normals, i))
    normal.normalize()
    for (const i of vertices) normals.setXYZ(i, normal.x, normal.y, normal.z)
  }
  return geometry
}

function paddle(points, width, depth, rows = 20, columns = 14) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
  const tangent = new THREE.Vector3()
  const across = new THREE.Vector3()
  const up = new THREE.Vector3()
  const axis = new THREE.Vector3(0, 1, 0)
  return surface(rows, columns, (u, phi, out) => {
    curve.getPoint(u, out)
    curve.getTangent(u, tangent)
    across.crossVectors(tangent, axis).normalize()
    up.crossVectors(across, tangent).normalize()
    const envelope = Math.sin(Math.PI * u) ** 0.6 * (1 + 0.08 * Math.sin(u * Math.PI * 7 + Math.cos(phi) * 2))
    out.addScaledVector(across, Math.cos(phi) * width * envelope)
    out.addScaledVector(up, Math.sin(phi) * depth * envelope)
  })
}

// 色差寫入頂點，保留日夜光照的立體感。
function cloudColors(geometry) {
  const positions = geometry.attributes.position
  const colors = new Float32Array(positions.count * 3)
  const pearl = new THREE.Color('#fffdfb')
  const aqua = new THREE.Color('#bbdfea')
  const pink = new THREE.Color('#f7e6f0')
  const color = new THREE.Color()
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    const belly = (1 - smooth(-0.85, 0.3, y)) * 0.78
    const blush = smooth(0.02, 0.9, y) * (0.12 + 0.09 * Math.sin(x * 2.4 + z))
    color.copy(pearl).lerp(aqua, belly).lerp(pink, blush)
    color.toArray(colors, i * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

export function buildCloudWhale() {
  const group = new THREE.Group()
  group.name = 'cloud-whale'
  const body = new THREE.Group()
  body.name = 'body-pivot'
  group.add(body)
  const ownedMaterials = []
  const material = options => {
    const m = new THREE.MeshStandardMaterial(options)
    ownedMaterials.push(m)
    return m
  }
  const cloud = material({ color: '#ffffff', vertexColors: true, roughness: 0.96, metalness: 0, emissive: '#d7e7ff', emissiveIntensity: 0.012 })
  // 雲層漫射稍微繞光，仍由外部日光與月光決定明暗。
  cloud.onBeforeCompile = shader => {
    const physical = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
      'float dotNL = saturate( dot( geometryNormal, directLight.direction ) * 0.55 + 0.45 );',
    )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', physical)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= 1.35;')
  }
  cloud.customProgramCacheKey = () => 'cloud-whale-wrap-r186'
  const add = (parent, name, geometry, mat = cloud) => {
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.name = name
    mesh.castShadow = true
    parent.add(mesh)
    return mesh
  }
  add(body, 'body', surface(48, 32, bodyPoint))
  const lobes = new THREE.Group()
  lobes.name = 'cloud-lobes'
  body.add(lobes)
  const puffGeometry = cloudPuff()
  const cloudLobes = [
    [-1.62, 0.34, 0, 0.64, 0.44, 0.51],
    [-0.97, 0.68, 0.03, 0.74, 0.5, 0.71],
    [-0.22, 0.84, -0.06, 0.82, 0.48, 0.87],
    [0.65, 0.84, 0.02, 0.82, 0.47, 0.89],
    [1.4, 0.65, -0.03, 0.73, 0.46, 0.78],
    [1.95, 0.35, 0, 0.53, 0.41, 0.58],
    [-0.8, -0.55, 0.03, 0.85, 0.38, 0.65],
    [0.16, -0.66, 0, 0.98, 0.38, 0.83],
    [1.08, -0.61, 0, 0.85, 0.34, 0.76],
  ]
  for (const side of [-1, 1]) {
    cloudLobes.push(
      [-1.15, 0.06, side * 0.62, 0.62, 0.51, 0.39],
      [-0.43, 0.18, side * 0.86, 0.72, 0.61, 0.4],
      [0.4, 0.38, side * 0.87, 0.7, 0.57, 0.39],
      [1.18, 0.5, side * 0.69, 0.6, 0.42, 0.42],
    )
  }
  cloudLobes.forEach(([x, y, z, sx, sy, sz], i) => {
    const lobe = add(lobes, `cloud-lobe-${i}`, puffGeometry)
    lobe.position.set(x, y, z)
    lobe.scale.set(sx, sy, sz)
    lobe.userData.explodeWithParent = true
  })
  const tail = new THREE.Group()
  tail.name = 'tail-pivot'
  tail.position.set(-1.7, 0.05, 0)
  body.add(tail)
  add(tail, 'tail', paddle([[0, 0, 0], [-0.55, -0.03, 0], [-1.12, 0.17, 0], [-1.61, 0.74, 0]], 0.37, 0.31, 26, 16))
  for (const [x, y, sx, sy] of [[-0.42, 0.05, 0.45, 0.32], [-0.98, 0.25, 0.38, 0.29]]) {
    const lobe = add(tail, `tail-cloud-${x}`, puffGeometry)
    lobe.position.set(x, y, 0)
    lobe.scale.set(sx, sy, 0.3)
    lobe.userData.explodeWithParent = true
  }
  const flukes = new THREE.Group()
  flukes.name = 'flukes'
  flukes.position.set(-1.5, 0.66, 0)
  tail.add(flukes)
  const fins = []
  const finGroup = new THREE.Group()
  finGroup.name = 'fins'
  body.add(finGroup)
  for (const side of [-1, 1]) {
    add(flukes, `fluke-${side}`, paddle([[0.12, -0.12, 0], [-0.12, 0.08, side * 0.35], [-0.32, 0.3, side * 0.73], [-0.27, 0.55, side * 1.02]], 0.42, 0.2))
    const fin = new THREE.Group()
    fin.name = `fin-pivot-${side}`
    fin.position.set(0.05, -0.4, side * 0.94)
    finGroup.add(fin)
    add(fin, `fin-${side}`, paddle([[0.15, 0.06, -side * 0.14], [-0.12, -0.13, side * 0.18], [-0.4, -0.3, side * 0.46], [-0.68, -0.33, side * 0.57]], 0.31, 0.12))
    fins.push(fin)
  }
  const face = new THREE.Group()
  face.name = 'face'
  body.add(face)
  const eyeMat = material({ color: '#334f69', roughness: 0.22, metalness: 0 })
  const glintMat = material({ color: '#ffffff', roughness: 0.35 })
  const smileMat = material({ color: '#66849c', roughness: 0.95 })
  const blushMat = material({ color: '#ffffff', vertexColors: true, transparent: true, depthWrite: false, roughness: 1 })
  const eyeGeometry = new THREE.SphereGeometry(1, 14, 10)
  const glintGeometry = new THREE.SphereGeometry(1, 8, 6)
  const eyes = []
  const zAxis = new THREE.Vector3(0, 0, 1)
  for (const side of [-1, 1]) {
    const eye = new THREE.Group()
    eye.name = `eye-${side}`
    const center = skinPoint(1.63, 0.12, side, 0.04)
    const tangentX = skinPoint(1.64, 0.12, side).sub(skinPoint(1.62, 0.12, side))
    const tangentY = skinPoint(1.63, 0.13, side).sub(skinPoint(1.63, 0.11, side))
    const normal = tangentX.cross(tangentY).normalize().multiplyScalar(side)
    eye.position.copy(center)
    eye.quaternion.setFromUnitVectors(zAxis, normal)
    face.add(eye)
    add(eye, `eye-ink-${side}`, eyeGeometry, eyeMat).scale.set(0.115, 0.142, 0.055)
    const glint = add(eye, `eye-glint-${side}`, glintGeometry, glintMat)
    glint.position.set(-0.028, 0.045, 0.049)
    glint.scale.setScalar(0.032)
    const small = add(eye, `eye-glint-small-${side}`, glintGeometry, glintMat)
    small.position.set(0.039, -0.04, 0.052)
    small.scale.setScalar(0.013)
    eyes.push(eye)
    const cheekGeometry = new THREE.BufferGeometry()
    const positions = []
    const colors = []
    const indices = []
    const pink = new THREE.Color('#f1aec4')
    for (let ring = 0; ring <= 5; ring++) {
      const r = ring / 5
      for (let i = 0; i <= 24; i++) {
        const a = i / 24 * TAU
        const p = skinPoint(1.29 + Math.cos(a) * r * 0.26, -0.16 + Math.sin(a) * r * 0.125, side, 0.02)
        positions.push(p.x, p.y, p.z)
        colors.push(pink.r, pink.g, pink.b, 0.72 * (1 - r * r) ** 1.7)
        if (ring < 5 && i < 24) {
          const v = ring * 25 + i
          if (side > 0) indices.push(v, v + 25, v + 1, v + 1, v + 25, v + 26)
          else indices.push(v, v + 1, v + 25, v + 1, v + 26, v + 25)
        }
      }
    }
    cheekGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    cheekGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
    cheekGeometry.setIndex(indices)
    cheekGeometry.computeVertexNormals()
    add(face, `blush-${side}`, cheekGeometry, blushMat)
    const smile = new THREE.CatmullRomCurve3([
      skinPoint(2.0, -0.05, side, 0.02),
      skinPoint(2.12, -0.12, side, 0.022),
      skinPoint(2.24, -0.1, side, 0.02),
      skinPoint(2.31, -0.025, side, 0.02),
    ])
    add(face, `smile-${side}`, new THREE.TubeGeometry(smile, 16, 0.018, 6, false), smileMat)
  }
  const pleats = new THREE.Group()
  pleats.name = 'belly-pleats'
  body.add(pleats)
  const pleatMat = material({ color: '#d0e7ec', roughness: 1 })
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const points = []
      for (let j = 0; j <= 8; j++) {
        const u = j / 8
        points.push(skinPoint(0.05 + i * 0.47 + u * 0.85, -0.89 + u * 0.36 + i * 0.025, side, 0.014))
      }
      add(pleats, `belly-pleat-${side}-${i}`, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, 0.013, 5, false), pleatMat)
    }
  }
  const spout = new THREE.Group()
  spout.name = 'spout'
  spout.position.set(0.83, 1.33, 0)
  body.add(spout)
  const openingMat = material({ color: '#a8c7db', roughness: 1 })
  const opening = add(spout, 'blowhole', new THREE.SphereGeometry(1, 12, 8), openingMat)
  opening.scale.set(0.105, 0.022, 0.073)
  const mistMat = new THREE.MeshBasicMaterial({ color: '#edf7ff', transparent: true, opacity: 0.38, depthWrite: false })
  ownedMaterials.push(mistMat)
  const mistDay = new THREE.Color('#edf7ff')
  const mistNight = new THREE.Color('#8394bc')
  const mistGeometry = new THREE.SphereGeometry(1, 12, 8)
  const mist = []
  for (let i = 0; i < 7; i++) {
    const puff = add(spout, `mist-${i}`, mistGeometry, mistMat)
    puff.position.set(Math.cos(i * 2.4) * 0.17, 0.18 + i * 0.12, Math.sin(i * 2.4) * 0.14)
    puff.scale.setScalar(0.1 + i * 0.025)
    mist.push(puff)
  }
  group.userData.ownedMaterials = ownedMaterials
  const nodes = { body, tail, flukes, fins, lobes, face, eyes, pleats, spout }
  const sockets = {}
  for (const [name, parent, position] of [
    ['tail-root', body, [-1.7, 0.05, 0]],
    ['spout', body, [0.83, 1.33, 0]],
    ['fin-front', body, [0.05, -0.4, 0.94]],
    ['fin-back', body, [0.05, -0.4, -0.94]],
  ]) {
    const socket = new THREE.Object3D()
    socket.name = name
    socket.position.set(...position)
    parent.add(socket)
    sockets[name] = socket
  }
  group.userData.sculptRuntime = {
    nodes,
    sockets,
    parts: { body, tail, flukes, fins: finGroup, 'cloud-lobes': lobes, face, 'belly-pleats': pleats, spout },
    collider: { type: 'ellipsoid', radii: [2.5, 1.2, 1.2], sensor: true },
    destruction: { breakable: false },
  }
  group.userData.ownedTextures = []
  const painted = new Set()
  group.traverse(o => {
    if (!o.isMesh || o.material !== cloud || painted.has(o.geometry)) return
    cloudColors(o.geometry)
    painted.add(o.geometry)
  })
  // 只移動內部節點，根群組交由外層繞島。
  group.userData.anim = (t = 0, dt = 0, night = 0) => {
    const time = Number.isFinite(t) ? Math.max(0, t) : 0
    const darkness = Number.isFinite(night) ? THREE.MathUtils.clamp(night, 0, 1) : 0
    body.position.y = Math.sin(time * 0.55) * 0.065
    body.rotation.z = Math.sin(time * 0.4) * 0.012
    tail.rotation.z = Math.sin(time * 0.95) * 0.095
    flukes.rotation.z = Math.sin(time * 0.95 - 0.6) * 0.055
    fins.forEach((fin, i) => {
      const side = i === 0 ? -1 : 1
      fin.rotation.x = side * (0.08 + Math.sin(time * 1.1 + 0.35) * 0.14)
      fin.rotation.z = Math.sin(time * 1.1 + 0.8) * 0.045
    })
    const blinkPhase = time % 6.7
    const blink = 1 - 0.96 * Math.exp(-(((blinkPhase - 6.05) / 0.075) ** 2))
    for (const eye of eyes) eye.scale.y = blink
    cloud.emissiveIntensity = 0.012 + darkness * 0.013
    const cycle = time % 24
    const active = cycle > 0 && cycle < 3.8
    const fade = smooth(0, 0.35, cycle) * (1 - smooth(1.45, 3.8, cycle))
    mistMat.opacity = active ? 0.38 * fade : 0
    mistMat.color.lerpColors(mistDay, mistNight, darkness)
    mist.forEach((puff, i) => {
      puff.visible = active
      if (!active) {
        puff.position.set(0, 0, 0)
        puff.scale.setScalar(0.00001)
        return
      }
      const u = THREE.MathUtils.clamp((cycle - i * 0.075) / 2.9, 0, 1)
      const angle = i * 2.4 + u * 0.6
      const spread = (0.025 + u * 0.22) * (i ? 1 : 0.35)
      puff.position.set(Math.cos(angle) * spread, 0.1 + u * (0.7 + i * 0.055) + i * 0.045 * smooth(0, 0.4, cycle), Math.sin(angle) * spread)
      puff.scale.setScalar((0.07 + u * (0.19 + i * 0.014)) * smooth(0, 0.18, cycle))
    })
  }
  group.userData.anim(0, 0, 0)
  return group
}
