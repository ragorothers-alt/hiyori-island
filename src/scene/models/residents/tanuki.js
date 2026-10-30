import * as THREE from 'three'

export function buildTanuki() {
  const root = new THREE.Group()
  root.name = 'poko-tanuki'
  const clay = new THREE.MeshStandardMaterial({ color: 0xb98765, roughness: 0.9, flatShading: true })
  const dark = new THREE.MeshStandardMaterial({ color: 0x684a36, roughness: 0.9, flatShading: true })
  const sage = new THREE.MeshStandardMaterial({ color: 0x91ab70, roughness: 0.94, flatShading: true })
  const add = (name, pos, scale, material = clay, parent = root) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material)
    mesh.name = name
    mesh.position.set(...pos)
    mesh.scale.set(...scale)
    mesh.castShadow = true
    parent.add(mesh)
    return mesh
  }
  add('body', [0, 0.29, 0], [0.20, 0.22, 0.15])
  const head = add('head', [0, 0.62, 0.015], [0.325, 0.25, 0.235])
  const hp = head.geometry.attributes.position
  for (let i = 0; i < hp.count; i++) hp.setX(i, hp.getX(i) * (1 - 0.16 * hp.getY(i)))
  head.geometry.computeVertexNormals()
  add('ear-l', [0.21, 0.80, -0.015], [0.09, 0.105, 0.06], dark)
  add('ear-r', [-0.21, 0.80, -0.015], [0.09, 0.105, 0.06], dark)
  const al = add('arm-l', [0.205, 0.355, 0.01], [0.065, 0.12, 0.068])
  const ar = add('arm-r', [-0.205, 0.355, 0.01], [0.065, 0.12, 0.068])
  al.rotation.z = 0.5
  ar.rotation.z = -0.5
  add('leg-l', [0.095, 0.05, 0.025], [0.055, 0.05, 0.075], dark)
  add('leg-r', [-0.095, 0.05, 0.025], [0.055, 0.05, 0.075], dark)
  const tail = add('tail', [0.215, 0.175, -0.20], [0.15, 0.105, 0.20], clay)
  tail.rotation.x = -0.3
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.205, 0.32, 16), sage)
  apron.name = 'apron'
  apron.position.set(0, 0.26, 0.02)
  apron.scale.z = 0.82
  apron.castShadow = true
  root.add(apron)
  const leaf = add('leaf', [0.085, 0.892, 0.045], [0.175, 0.055, 0.075], sage)
  leaf.rotation.z = -0.42
  const headPose = new THREE.Group()
  headPose.position.y = 0.62
  root.add(headPose)
  for (const name of ['head', 'ear-l', 'ear-r', 'leaf']) {
    const part = root.getObjectByName(name)
    part.position.y -= 0.62
    headPose.add(part)
  }
  headPose.rotation.z = 0
  headPose.position.x = 0
  root.updateMatrixWorld(true)
  const joints = {}
  const makePivot = (key, pos, objects) => {
    const group = new THREE.Group()
    group.name = key + '-pivot'
    group.position.set(...pos)
    root.add(group)
    root.updateMatrixWorld(true)
    for (const object of objects) group.attach(object)
    joints[key] = group
    return group
  }
  makePivot('armL', [0.19, 0.435, 0], [root.getObjectByName('arm-l')])
  makePivot('armR', [-0.19, 0.435, 0], [root.getObjectByName('arm-r')])
  makePivot('legL', [0.095, 0.14, 0], [root.getObjectByName('leg-l')])
  makePivot('legR', [-0.095, 0.14, 0], [root.getObjectByName('leg-r')])
  makePivot('earL', [0.21, 0.76, -0.015], [root.getObjectByName('ear-l')])
  makePivot('earR', [-0.21, 0.76, -0.015], [root.getObjectByName('ear-r')])
  makePivot('tail', [0.13, 0.19, -0.115], [root.getObjectByName('tail')])
  makePivot('head', [0, 0.44, 0], [headPose, joints.earL, joints.earR])
  makePivot('body', [0, 0.16, 0], root.children.slice())
  root.userData.joints = joints
  root.userData.ownedMaterials = [clay, dark, sage]
  root.userData.ownedTextures = []
  root.userData.headTop = new THREE.Vector3(0, 1.06, 0)
  const cream = new THREE.MeshStandardMaterial({ color: 0xf2dab5, roughness: 0.85, flatShading: true })
  const pink = new THREE.MeshStandardMaterial({ color: 0xed9b9c, roughness: 0.85, flatShading: true })
  const green = new THREE.MeshStandardMaterial({ color: 0x79a047, roughness: 0.9, flatShading: true })
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf3cf70, roughness: 0.7 })
  const gloss = new THREE.MeshStandardMaterial({ color: 0x281c17, roughness: 0.2 })
  const white = new THREE.MeshStandardMaterial({ color: 0xfff8e8, roughness: 0.4 })
  const painted = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: true })
  root.userData.ownedMaterials.push(cream, pink, green, yellow, gloss, white, painted)
  const colors = {
    fur: new THREE.Color(0xb98765), dark: new THREE.Color(0x684a36), cream: new THREE.Color(0xf2dab5)
  }
  // 沿色塊邊界切開三角形，保留乾淨的眼罩與尾巴環紋
  const paint = (geometry, base, layers) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    geometry.dispose()
    const pos = source.attributes.position
    const normal = source.attributes.normal
    const positions = []
    const normals = []
    const rgb = []
    const split = (polygon, field, inside) => {
      const output = []
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]
        const b = polygon[(i + 1) % polygon.length]
        const fa = field(...a)
        const fb = field(...b)
        const aInside = inside ? fa >= 0 : fa <= 0
        const bInside = inside ? fb >= 0 : fb <= 0
        if (aInside) output.push(a)
        if (aInside !== bInside) {
          let lo = 0
          let hi = 1
          for (let j = 0; j < 18; j++) {
            const t = (lo + hi) / 2
            const mid = a.map((n, k) => n + (b[k] - n) * t)
            if ((field(...mid) >= 0) === (fa >= 0)) lo = t
            else hi = t
          }
          const t = (lo + hi) / 2
          output.push(a.map((n, k) => n + (b[k] - n) * t))
        }
      }
      return output
    }
    for (let i = 0; i < pos.count; i += 3) {
      let polygons = [{ color: base, vertices: [0, 1, 2].map(j => [pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j), normal.getX(i + j), normal.getY(i + j), normal.getZ(i + j)]) }]
      for (const layer of layers) {
        const next = []
        for (const polygon of polygons) {
          const inside = split(polygon.vertices, layer.field, true)
          const outside = split(polygon.vertices, layer.field, false)
          if (inside.length >= 3) next.push({ color: layer.color, vertices: inside })
          if (outside.length >= 3) next.push({ color: polygon.color, vertices: outside })
        }
        polygons = next
      }
      for (const polygon of polygons) {
        const c = colors[polygon.color]
        for (let j = 1; j < polygon.vertices.length - 1; j++) {
          const tri = [polygon.vertices[0], polygon.vertices[j], polygon.vertices[j + 1]]
          const a = new THREE.Vector3(...tri[0])
          const b = new THREE.Vector3(...tri[1])
          const d = new THREE.Vector3(...tri[2])
          if (b.sub(a).cross(d.sub(a)).lengthSq() < 1e-16) continue
          for (const vertex of tri) {
            positions.push(...vertex.slice(0, 3))
            normals.push(...vertex.slice(3, 6))
            rgb.push(c.r, c.g, c.b)
          }
        }
      }
    }
    source.dispose()
    const result = new THREE.BufferGeometry()
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    result.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3))
    return result
  }
  const headMesh = root.getObjectByName('head')
  headMesh.geometry.dispose()
  const headGeo = new THREE.SphereGeometry(1, 32, 20)
  const headPos = headGeo.attributes.position
  for (let i = 0; i < headPos.count; i++) headPos.setX(i, headPos.getX(i) * (1 - 0.16 * headPos.getY(i)))
  headGeo.computeVertexNormals()
  headMesh.geometry = paint(headGeo, 'fur', [
    { color: 'cream', field: (x, y, z) => Math.min(z - 0.14, 1 - (x / 0.97) ** 2 - ((y + 0.24) / 0.83) ** 2) },
    { color: 'dark', field: (x, y, z) => Math.min(z - 0.4, 1 - ((Math.abs(x) - 0.40) / 0.29) ** 2 - ((y - 0.015) / 0.49) ** 2) }
  ])
  headMesh.material = painted
  for (const [name, w, h] of [['body', 16, 10], ['arm-l', 12, 8], ['arm-r', 12, 8], ['leg-l', 12, 6], ['leg-r', 12, 6], ['ear-l', 12, 8], ['ear-r', 12, 8], ['tail', 16, 12]]) {
    const mesh = root.getObjectByName(name)
    mesh.geometry.dispose()
    const geometry = new THREE.SphereGeometry(1, w, h)
    if (name.startsWith('ear')) {
      mesh.geometry = paint(geometry, 'dark', [{ color: 'cream', field: (x, y, z) => Math.min(z - 0.4, 0.53 - x * x - y * y) }])
      mesh.material = painted
    } else if (name.startsWith('arm')) {
      mesh.geometry = paint(geometry, 'fur', [{ color: 'dark', field: (x, y) => -y - 0.48 }])
      mesh.material = painted
    } else if (name === 'tail') {
      mesh.geometry = paint(geometry, 'fur', [[-1, -0.6], [-0.2, 0.2], [0.6, 1.01]].map(([lo, hi]) => ({ color: 'dark', field: (x, y, z) => Math.min(z - lo, hi - z) })))
      mesh.material = painted
    } else mesh.geometry = geometry
  }
  const solid = (name, geometry, material, pos = [0, 0, 0], parent = root) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.position.set(...pos)
    mesh.castShadow = true
    parent.add(mesh)
    return mesh
  }
  const ellipsoid = (name, pos, scale, material, w = 10, h = 7) => {
    const mesh = solid(name, new THREE.SphereGeometry(1, w, h), material, pos)
    mesh.scale.set(...scale)
    return mesh
  }
  const merged = geometries => {
    const positions = []
    const normals = []
    for (let geometry of geometries) {
      if (geometry.index) {
        const indexed = geometry
        geometry = indexed.toNonIndexed()
        indexed.dispose()
      }
      positions.push(...geometry.attributes.position.array)
      normals.push(...geometry.attributes.normal.array)
      geometry.dispose()
    }
    const result = new THREE.BufferGeometry()
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    return result
  }
  const blobGeo = (pos, scale, w = 8, h = 6) => {
    const geometry = new THREE.SphereGeometry(1, w, h)
    geometry.scale(...scale)
    geometry.translate(...pos)
    return geometry
  }
  const eyeL = ellipsoid('eye-l', [0.122, 0.63, 0.232], [0.045, 0.061, 0.027], gloss)
  const eyeR = ellipsoid('eye-r', [-0.122, 0.63, 0.232], [0.045, 0.061, 0.027], gloss)
  solid('eye-catchlights', merged([blobGeo([0.111, 0.648, 0.256], [0.009, 0.011, 0.006]), blobGeo([-0.133, 0.648, 0.256], [0.009, 0.011, 0.006])]), white)
  ellipsoid('muzzle', [0, 0.555, 0.229], [0.092, 0.054, 0.038], cream)
  ellipsoid('nose', [0, 0.58, 0.265], [0.024, 0.015, 0.015], gloss, 8, 6)
  ellipsoid('mouth', [0, 0.531, 0.264], [0.037, 0.027, 0.007], dark, 8, 6)
  ellipsoid('tongue', [0, 0.524, 0.271], [0.024, 0.016, 0.004], pink, 8, 6)
  const smilePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.054, 0.55, 0.265), new THREE.Vector3(-0.039, 0.538, 0.272),
    new THREE.Vector3(-0.018, 0.54, 0.276), new THREE.Vector3(0, 0.55, 0.278),
    new THREE.Vector3(0.018, 0.54, 0.276), new THREE.Vector3(0.039, 0.538, 0.272), new THREE.Vector3(0.054, 0.55, 0.265)
  ])
  solid('smile', new THREE.TubeGeometry(smilePath, 16, 0.0037, 4, false), dark)
  solid('cheeks', merged([blobGeo([0.185, 0.575, 0.204], [0.035, 0.019, 0.008]), blobGeo([-0.185, 0.575, 0.204], [0.035, 0.019, 0.008])]), pink)
  root.updateMatrixWorld(true)
  for (const name of ['eye-l', 'eye-r', 'eye-catchlights', 'muzzle', 'nose', 'mouth', 'tongue', 'smile', 'cheeks']) joints.head.attach(root.getObjectByName(name))

  // 圍裙沿腹部彎曲，前袋與花朵共用身體支點
  apron.geometry.dispose()
  root.getObjectByName('body').scale.x = 0.17
  const apronGeo = new THREE.CylinderGeometry(0.165, 0.205, 0.32, 20, 3)
  const ap = apronGeo.attributes.position
  for (let i = 0; i < ap.count; i++) {
    const y = ap.getY(i)
    const pinch = 1 - 0.1 * Math.exp(-(((y + 0.14) / 0.025) ** 2))
    ap.setX(i, ap.getX(i) * pinch)
  }
  apronGeo.computeVertexNormals()
  apron.geometry = apronGeo
  const straps = []
  for (const sign of [-1, 1]) {
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(sign * 0.105, 0.40, 0.13), new THREE.Vector3(sign * 0.11, 0.47, 0.045), new THREE.Vector3(sign * 0.105, 0.43, -0.115), new THREE.Vector3(sign * 0.10, 0.33, -0.13)])
    straps.push(new THREE.TubeGeometry(path, 9, 0.017, 4, false))
  }
  solid('straps', merged(straps), sage)
  const pocketShape = new THREE.Shape()
  pocketShape.moveTo(-0.10, 0.055)
  pocketShape.lineTo(0.10, 0.055)
  pocketShape.lineTo(0.09, -0.035)
  pocketShape.quadraticCurveTo(0, -0.07, -0.09, -0.035)
  pocketShape.closePath()
  const pocketGeo = new THREE.ExtrudeGeometry(pocketShape, { depth: 0.009, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 1, curveSegments: 5, steps: 1 })
  const pocketPos = pocketGeo.attributes.position
  for (let i = 0; i < pocketPos.count; i++) {
    const x = pocketPos.getX(i)
    const y = pocketPos.getY(i) + 0.25
    const radius = 0.165 + (0.42 - y) / 0.32 * 0.04
    pocketPos.setZ(i, pocketPos.getZ(i) + Math.sqrt(radius * radius - x * x) * 0.82 + 0.025)
  }
  pocketGeo.computeVertexNormals()
  solid('pocket', pocketGeo, sage, [0, 0.25, 0])
  const petals = []
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5
    const geometry = blobGeo([0, 0.022, 0], [0.013, 0.023, 0.007])
    geometry.rotateZ(a)
    geometry.translate(-0.067, 0.337, 0.205)
    petals.push(geometry)
  }
  solid('flower', merged(petals), pink)
  ellipsoid('flower-center', [-0.067, 0.337, 0.215], [0.012, 0.012, 0.009], yellow, 8, 6)
  solid('flower-leaves', merged([blobGeo([-0.043, 0.311, 0.205], [0.025, 0.01, 0.006]), blobGeo([-0.089, 0.314, 0.202], [0.025, 0.01, 0.006]), blobGeo([-0.065, 0.30, 0.20], [0.004, 0.034, 0.004])]), green)
  root.updateMatrixWorld(true)
  for (const name of ['straps', 'pocket', 'flower', 'flower-center', 'flower-leaves']) joints.body.attach(root.getObjectByName(name))

  const leafMesh = root.getObjectByName('leaf')
  leafMesh.geometry.dispose()
  const leafShape = new THREE.Shape()
  leafShape.moveTo(-1, 0)
  leafShape.bezierCurveTo(-0.65, 1, 0.32, 0.9, 1, 0)
  leafShape.bezierCurveTo(0.1, -0.8, -0.7, -0.8, -1, 0)
  const leafGeo = new THREE.ExtrudeGeometry(leafShape, { depth: 0.045, bevelEnabled: false, curveSegments: 7, steps: 1 })
  leafGeo.scale(1, 0.68, 1)
  leafMesh.geometry = leafGeo
  leafMesh.material = green
  leafMesh.scale.set(0.175, 0.11, 0.07)
  leafMesh.rotation.set(-0.75, 0, -0.42)
  const ribPath = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.085, 0.925, 0.06), new THREE.Vector3(-0.055, 0.895, 0.07), new THREE.Vector3(0.08, 0.875, 0.09), new THREE.Vector3(0.20, 0.84, 0.10)])
  const rib = solid('leaf-vein-stem', new THREE.TubeGeometry(ribPath, 9, 0.004, 4, false), green)
  root.updateMatrixWorld(true)
  joints.head.attach(rib)
  root.userData.eyes = [eyeL, eyeR]
  root.userData.headTop.set(0, 1.02, 0)

  // 眼睛和高光一起眨眼，避免高光懸在眼皮外
  const eyeBlink = new THREE.Group()
  eyeBlink.name = 'eyes'
  eyeBlink.position.set(0, 0.63 - 0.44, 0)
  joints.head.add(eyeBlink)
  root.updateMatrixWorld(true)
  for (const name of ['eye-l', 'eye-r', 'eye-catchlights']) eyeBlink.attach(root.getObjectByName(name))

  const poses = Object.values(joints).map(joint => ({
    joint,
    position: joint.position.clone(),
    rotation: joint.rotation.clone(),
    scale: joint.scale.clone()
  }))
  const parts = []
  root.traverse(part => {
    if (part.isMesh) parts.push(part)
  })
  root.userData.sculptRuntime = {
    parts,
    joints,
    sockets: { headTop: root.userData.headTop },
    colliders: [
      { name: 'body', type: 'capsule', joint: 'body', radius: 0.17, height: 0.4 },
      { name: 'head', type: 'sphere', joint: 'head', radius: 0.25 }
    ]
  }
  const amount = value => THREE.MathUtils.clamp(Number(value) || 0, 0, 1)
  root.userData.anim = (t, dt, state = {}) => {
    const time = Number.isFinite(t) ? t : 0
    const walk = amount(state.walk)
    const wave = amount(state.wave)
    const talk = amount(state.talk)
    const night = amount(state.night)
    const phase = time * 7.2
    const stride = Math.sin(phase)
    const breathing = Math.sin(time * (2.1 - night * 0.55)) * 0.004
    // 每幀回到基準，只改支點，外層移動由場景控制
    for (const pose of poses) {
      pose.joint.position.copy(pose.position)
      pose.joint.rotation.copy(pose.rotation)
      pose.joint.scale.copy(pose.scale)
    }
    joints.body.scale.set(1 + breathing, 1, 1 + breathing)
    joints.body.position.y += Math.abs(stride) * walk * 0.008
    joints.body.rotation.z = stride * walk * 0.012 + Math.sin(time * 3.3) * talk * 0.008
    joints.body.position.y += Math.abs(Math.sin(joints.body.rotation.z)) * 0.16
    joints.head.position.y += breathing * 0.35
    joints.head.rotation.set(
      night * 0.035 + Math.sin(time * 1.6) * 0.008 + Math.sin(time * 9.4) * talk * 0.018,
      Math.sin(time * 0.8) * 0.012 + Math.sin(time * 3.2) * talk * 0.035,
      Math.sin(time * 1.2) * 0.007 + Math.sin(time * 4.2) * talk * 0.026
    )
    joints.legL.rotation.x = stride * walk * 0.38
    joints.legR.rotation.x = -stride * walk * 0.38
    joints.legL.position.y += Math.abs(stride) * walk * 0.013 + Math.max(0, stride) * walk * 0.006
    joints.legR.position.y += Math.abs(stride) * walk * 0.013 + Math.max(0, -stride) * walk * 0.006
    joints.armL.rotation.x = -stride * walk * 0.28
    joints.armR.rotation.x = stride * walk * 0.28 * (1 - wave)
    joints.armR.rotation.y = wave * (0.12 + Math.sin(time * 6.5) * 0.12)
    joints.armR.rotation.z = wave * (-2.1 + Math.sin(time * 7.2) * 0.18)
    const twitchL = Math.pow(Math.max(0, Math.sin(time * 1.35)), 20)
    const twitchR = Math.pow(Math.max(0, Math.sin(time * 1.35 + 1.8)), 20)
    joints.earL.rotation.set(twitchL * 0.07, 0, twitchL * 0.06)
    joints.earR.rotation.set(twitchR * 0.07, 0, -twitchR * 0.06)
    const swish = Math.pow(Math.max(0, Math.sin(time * 0.9)), 8)
    joints.tail.rotation.set(
      Math.sin(time * 1.7) * 0.025,
      Math.sin(time * 1.8) * (0.035 + swish * 0.07),
      Math.sin(time * 1.1) * 0.018
    )
    const blinkPhase = ((time % 4.8) + 4.8) % 4.8
    const blink = Math.max(0, 1 - Math.abs(blinkPhase - 4.52) / 0.105)
    eyeBlink.scale.set(1, 1 - blink * 0.94 - night * 0.04, 1)
  }

  return root
}
