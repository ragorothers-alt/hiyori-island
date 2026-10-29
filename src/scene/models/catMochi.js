import * as THREE from 'three'

// 座標採角色自身左右：左為 +x，正面為 +z。
export function buildCatMochi() {
  const group = new THREE.Group()
  group.name = 'catMochi'
  const ownedMaterials = []
  const ownedTextures = []
  const material = (color, options = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.84, ...options })
    ownedMaterials.push(value)
    return value
  }
  const skin = material('#FFE0CC')
  const hair = material('#F9ECD8')
  const cream = material('#FFF4DF', { flatShading: true })
  const dressCream = material('#FFF0CC', { flatShading: true })
  const pink = material('#F19BB2', { flatShading: true })
  const blue = material('#78B6E0')
  const white = material('#FFFAF2')
  const innerPink = material('#F6B7BA')
  const petal = material('#F4A3B7', { flatShading: true })
  const mesh = (parent, name, geometry, mat) => {
    const value = new THREE.Mesh(geometry, mat)
    value.name = name
    value.castShadow = true
    value.receiveShadow = true
    parent.add(value)
    return value
  }
  const pivot = (parent, name, x, y, z) => {
    const value = new THREE.Object3D()
    value.name = name
    value.position.set(x, y, z)
    parent.add(value)
    return value
  }
  const ellipsoid = (x, y, z, rx, ry, rz, segments = 16, rings = 10) => {
    return new THREE.SphereGeometry(1, segments, rings).scale(rx, ry, rz).translate(x, y, z)
  }
  const combine = (parts) => {
    const positions = []
    const normals = []
    const uvs = []
    for (const part of parts) {
      const geometry = part.index ? part.toNonIndexed() : part
      positions.push(...geometry.attributes.position.array)
      normals.push(...geometry.attributes.normal.array)
      uvs.push(...geometry.attributes.uv.array)
      if (geometry !== part) geometry.dispose()
      part.dispose()
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    return geometry
  }
  // 封口橢圓放樣；裙襬與髮束保留寬大的低多邊形切面。
  const loft = (rows, sides = 12, pleats = 0) => {
    const positions = []
    const uvs = []
    const indices = []
    rows.forEach(([x, y, z, rx, rz], row) => {
      for (let i = 0; i <= sides; i++) {
        const angle = i / sides * Math.PI * 2
        const fold = 1 + pleats * Math.cos(angle * 8)
        positions.push(x + Math.cos(angle) * rx * fold, y, z + Math.sin(angle) * rz * fold)
        uvs.push(i / sides, row / (rows.length - 1))
        if (row && i < sides) {
          const a = (row - 1) * (sides + 1) + i
          const b = row * (sides + 1) + i
          indices.push(a, b, a + 1, b, b + 1, a + 1)
        }
      }
    })
    for (const row of [0, rows.length - 1]) {
      const center = positions.length / 3
      positions.push(...rows[row].slice(0, 3))
      uvs.push(0.5, 0.5)
      for (let i = 0; i < sides; i++) {
        const a = row * (sides + 1) + i
        if (row === 0) indices.push(center, a, a + 1)
        else indices.push(center, a + 1, a)
      }
    }
    if (rows[0][1] > rows[rows.length - 1][1]) {
      for (let i = 0; i < indices.length; i += 3) {
        const swap = indices[i]
        indices[i] = indices[i + 1]
        indices[i + 1] = swap
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    return geometry
  }
  // 連續鮑伯髮殼：大束縱向起伏，髮尾向內收。
  const bobShell = () => {
    const profile = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.648, 0.001, 0.001), new THREE.Vector3(0.60, 0.22, 0.16),
      new THREE.Vector3(0.43, 0.385, 0.278), new THREE.Vector3(0.18, 0.398, 0.276),
      new THREE.Vector3(0.02, 0.332, 0.211)
    ])
    const positions = []
    const uvs = []
    const indices = []
    const sides = 40
    const rows = 12
    for (let row = 0; row <= rows; row++) {
      const t = row / rows
      const section = profile.getPoint(t)
      for (let i = 0; i <= sides; i++) {
        const angle = i / sides * Math.PI * 2
        const front = Math.max(0, Math.cos(angle)) ** 6
        const ridge = Math.cos(angle * 7 + (1 - t) * 0.4)
        const radius = 1 + 0.055 * ridge * t
        const frontY = 0.648 - 0.288 * (1 - Math.cos(t * Math.PI / 2))
        const y = THREE.MathUtils.lerp(section.x, frontY, front) + 0.025 * (1 + ridge) * t ** 3
        positions.push(Math.sin(angle) * section.y * radius, y, -0.055 + Math.cos(angle) * section.z * radius)
        uvs.push(i / sides, t)
        if (row && i < sides) {
          const a = (row - 1) * (sides + 1) + i
          const b = row * (sides + 1) + i
          indices.push(a, b, a + 1, b, b + 1, a + 1)
        }
      }
    }
    for (const row of [0, rows]) {
      const center = positions.length / 3
      positions.push(0, row ? 0.15 : 0.648, -0.055)
      uvs.push(0.5, row ? 1 : 0)
      for (let i = 0; i < sides; i++) {
        const a = row * (sides + 1) + i
        if (row) indices.push(center, a + 1, a)
        else indices.push(center, a, a + 1)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const normals = geometry.attributes.normal
    for (let row = 0; row <= rows; row++) {
      const a = row * (sides + 1)
      const normal = new THREE.Vector3().fromBufferAttribute(normals, a)
        .add(new THREE.Vector3().fromBufferAttribute(normals, a + sides)).normalize()
      normals.setXYZ(a, ...normal.toArray())
      normals.setXYZ(a + sides, ...normal.toArray())
    }
    return geometry
  }
  const hips = pivot(group, 'hips', 0, 0.30, 0)
  const torso = pivot(hips, 'torso', 0, 0.19, 0)
  const head = pivot(torso, 'head', 0, 0.12, 0)
  mesh(head, 'head-volume', ellipsoid(0, 0.285, 0.062, 0.313, 0.275, 0.242, 24, 16), skin)
  mesh(torso, 'neck-volume', ellipsoid(0, 0.105, 0, 0.065, 0.065, 0.064), skin)
  mesh(head, 'hair-shell', bobShell(), hair)
  mesh(torso, 'dress-bodice', loft([[0, -0.09, 0, 0.15, 0.115], [0, 0.06, 0, 0.14, 0.11], [0, 0.115, 0, 0.07, 0.06]]), dressCream)
  mesh(hips, 'dress-skirt', loft([[0, -0.105, -0.015, 0.275, 0.24], [0, -0.08, -0.015, 0.28, 0.24], [0, 0.015, 0, 0.224, 0.224], [0, 0.14, 0, 0.145, 0.115]], 32, 0.025), dressCream)
  const armL = pivot(torso, 'armL', 0.34, 0.03, 0)
  const armR = pivot(torso, 'armR', -0.34, 0.03, 0)
  for (const [arm, sign] of [[armL, 1], [armR, -1]]) {
    const side = sign === 1 ? 'left' : 'right'
    mesh(arm, `sleeve-${side}`, loft([[sign * 0.025, -0.222, 0, 0.076, 0.079], [sign * 0.008, -0.10, 0, 0.068, 0.073], [-sign * 0.08, 0.012, 0, 0.09, 0.06]]), pink)
    mesh(arm, `sleeve-cuff-${side}`, new THREE.TorusGeometry(0.074, 0.006, 4, 16).rotateX(Math.PI / 2).scale(1, 1, 1.04).translate(sign * 0.025, -0.217, 0), innerPink)
    mesh(arm, `hand-${side}`, ellipsoid(sign * 0.023, -0.253, 0.008, 0.049, 0.044, 0.048), skin)
  }
  const legL = pivot(hips, 'legL', 0.08, 0, 0.15)
  const legR = pivot(hips, 'legR', -0.08, 0, 0.15)
  for (const [leg, sign] of [[legL, 1], [legR, -1]]) {
    const side = sign === 1 ? 'left' : 'right'
    mesh(leg, `leg-${side}`, ellipsoid(0, -0.116, 0, 0.055, 0.12, 0.054), skin)
    mesh(leg, `sock-${side}`, ellipsoid(0, -0.216, 0, 0.058, 0.052, 0.057), white)
    mesh(leg, `shoe-${side}`, ellipsoid(0, -0.257, 0.035, 0.078, 0.043, 0.065), cream)
  }
  // 沿用四個樞紐，以連續蒙皮消除硬管接縫。
  const tail = []
  const tailSteps = [[0, 0.08, -0.13], [0.13, -0.005, -0.14], [0.16, 0.095, -0.14], [0.13, 0.14, -0.075]]
  tailSteps.forEach((point, i) => {
    const joint = pivot(i ? tail[i - 1] : hips, `tail${i}`, ...point)
    tail.push(joint)
  })
  const tailBones = tail.map((joint, i) => {
    const bone = new THREE.Bone()
    bone.name = `tail-fur-bone-${i}`
    joint.add(bone)
    return bone
  })
  const tailPoints = []
  const tailPoint = new THREE.Vector3()
  for (const step of tailSteps) {
    tailPoint.add(new THREE.Vector3(...step))
    tailPoints.push(tailPoint.clone())
  }
  tailPoints.push(tailPoint.clone().add(new THREE.Vector3(0.025, 0.135, 0.035)))
  const tailCurve = new THREE.CatmullRomCurve3(tailPoints)
  const tailGeometry = new THREE.TubeGeometry(tailCurve, 32, 1, 12, false)
  const tailPositions = tailGeometry.attributes.position
  const tailIndices = Array.from(tailGeometry.index.array)
  const skinIndices = []
  const skinWeights = []
  const tailRadii = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.026, 0, 0), new THREE.Vector3(0.052, 0, 0),
    new THREE.Vector3(0.082, 0, 0), new THREE.Vector3(0.112, 0, 0),
    new THREE.Vector3(0.002, 0, 0)
  ])
  for (let row = 0; row <= 32; row++) {
    const u = row / 32
    const t = tailCurve.getUtoTmapping(u)
    const center = tailCurve.getPointAt(u)
    const radius = t <= 0.75 ? tailRadii.getPoint(t).x :
      Math.max(0.002, 0.112 * Math.sqrt(1 - ((t - 0.75) / 0.25) ** 2))
    const boneT = Math.min(3, t * 4)
    const bone = Math.min(2, Math.floor(boneT))
    const weight = boneT - bone
    for (let i = 0; i <= 12; i++) {
      const vertex = row * 13 + i
      const point = new THREE.Vector3().fromBufferAttribute(tailPositions, vertex)
      point.sub(center).multiplyScalar(radius).add(center)
      tailPositions.setXYZ(vertex, ...point.toArray())
      skinIndices.push(bone, bone + 1, 0, 0)
      skinWeights.push(1 - weight, weight, 0, 0)
    }
  }
  // 端面封口；周向共用法線，保留圓胖尾端。
  for (let i = 1; i < 11; i++) {
    tailIndices.push(0, i + 1, i)
    tailIndices.push(416, 416 + i, 417 + i)
  }
  tailGeometry.setIndex(tailIndices)
  tailGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
  tailGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))
  tailGeometry.computeVertexNormals()
  for (let row = 0; row <= 32; row++) {
    const a = row * 13
    const normal = new THREE.Vector3().fromBufferAttribute(tailGeometry.attributes.normal, a)
      .add(new THREE.Vector3().fromBufferAttribute(tailGeometry.attributes.normal, a + 12)).normalize()
    tailGeometry.attributes.normal.setXYZ(a, ...normal.toArray())
    tailGeometry.attributes.normal.setXYZ(a + 12, ...normal.toArray())
  }
  const tailFur = new THREE.SkinnedMesh(tailGeometry, hair)
  tailFur.name = 'tail-fur'
  tailFur.castShadow = true
  tailFur.receiveShadow = true
  tailFur.frustumCulled = false
  hips.add(tailFur)
  group.updateMatrixWorld(true)
  tailFur.bind(new THREE.Skeleton(tailBones))
  tailFur.skeleton.computeBoneTexture()
  ownedTextures.push(tailFur.skeleton.boneTexture)
  const earL = pivot(head, 'earL', 0.24, 0.53, -0.025)
  const earR = pivot(head, 'earR', -0.24, 0.53, -0.025)
  for (const [ear, sign] of [[earL, 1], [earR, -1]]) {
    const side = sign === 1 ? 'left' : 'right'
    const outline = new THREE.Shape()
    outline.moveTo(-0.105, -0.035)
    outline.quadraticCurveTo(-0.08, 0.08, sign * 0.085, 0.21)
    outline.quadraticCurveTo(0.12, 0.09, 0.105, -0.035)
    outline.closePath()
    const geometry = new THREE.ExtrudeGeometry(outline, { depth: 0.07, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.008, bevelThickness: 0.008, curveSegments: 3 })
    geometry.translate(0, 0, -0.035)
    mesh(ear, `ear-outer-${side}`, geometry, hair)
    const inset = new THREE.Shape()
    inset.moveTo(-0.071, -0.006)
    inset.lineTo(sign * 0.073, 0.167)
    inset.lineTo(0.071, -0.006)
    inset.closePath()
    mesh(ear, `ear-inner-${side}`, new THREE.ShapeGeometry(inset).translate(0, 0, 0.044), innerPink)
  }
  const hairLoft = (rows, sides) => {
    const centers = new THREE.CatmullRomCurve3(rows.map((row) => new THREE.Vector3(...row.slice(0, 3))))
    const radii = new THREE.CatmullRomCurve3(rows.map((row) => new THREE.Vector3(row[3], row[4], 0)))
    const geometry = loft(Array.from({ length: 8 }, (_, i) => {
      const t = i / 7
      const radius = radii.getPoint(t)
      return [...centers.getPoint(t).toArray(), Math.max(0.003, radius.x), Math.max(0.004, radius.y)]
    }), sides)
    // 合併環縫法線，大片髮束不出現格狀明暗。
    const normals = geometry.attributes.normal
    for (let row = 0; row < 8; row++) {
      const a = row * (sides + 1)
      const normal = new THREE.Vector3().fromBufferAttribute(normals, a)
        .add(new THREE.Vector3().fromBufferAttribute(normals, a + sides)).normalize()
      normals.setXYZ(a, ...normal.toArray())
      normals.setXYZ(a + sides, ...normal.toArray())
    }
    return geometry
  }
  const locks = []
  locks.push(hairLoft([[0, 0.595, -0.005, 0.055, 0.065], [0, 0.49, 0.22, 0.118, 0.086], [0.018, 0.375, 0.291, 0.075, 0.055], [0.035, 0.315, 0.31, 0.003, 0.004]], 8))
  for (const sign of [-1, 1]) {
    locks.push(hairLoft([[sign * 0.105, 0.575, 0.005, 0.055, 0.06], [sign * 0.17, 0.47, 0.22, 0.095, 0.07], [sign * 0.23, 0.325, 0.262, 0.067, 0.055], [sign * 0.275, 0.255, 0.235, 0.003, 0.004]], 8))
  }
  mesh(head, 'bob-locks', combine(locks), hair)
  const jacket = new THREE.CylinderGeometry(0.172, 0.205, 0.255, 24, 1, true, 0.51, Math.PI * 2 - 1.02)
  jacket.scale(1, 1, 0.76).translate(0, -0.013, 0)
  // 羽織內側也有布面，前襟保留開口。
  const jacketInner = jacket.clone()
  const jacketIndex = jacketInner.index.array
  for (let i = 0; i < jacketIndex.length; i += 3) {
    const swap = jacketIndex[i]
    jacketIndex[i] = jacketIndex[i + 1]
    jacketIndex[i + 1] = swap
  }
  jacketInner.scale(0.985, 1, 0.985)
  jacketInner.computeVertexNormals()
  mesh(torso, 'haori', combine([jacket, jacketInner]), pink)
  const collars = [-1, 1].map((sign) => {
    const shape = new THREE.Shape()
    shape.moveTo(sign * 0.017, 0.108)
    shape.lineTo(sign * 0.067, 0.10)
    shape.lineTo(sign * 0.124, -0.139)
    shape.lineTo(sign * 0.084, -0.145)
    shape.closePath()
    return new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false }).translate(0, 0, 0.111)
  })
  mesh(torso, 'haori-lapels', combine(collars), pink)
  mesh(torso, 'obi', new THREE.CylinderGeometry(0.199, 0.206, 0.074, 24).scale(1, 1, 0.8).translate(0, -0.045, 0), blue)
  const bowLoops = [-1, 1].map((sign) => {
    const shape = new THREE.Shape()
    shape.moveTo(sign * 0.012, 0)
    shape.quadraticCurveTo(sign * 0.045, 0.031, sign * 0.079, 0.028)
    shape.quadraticCurveTo(sign * 0.089, 0, sign * 0.079, -0.028)
    shape.quadraticCurveTo(sign * 0.045, -0.031, sign * 0.012, 0)
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 4 })
    const positions = geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      const t = THREE.MathUtils.clamp((Math.abs(positions.getX(i)) - 0.012) / 0.071, 0, 1)
      positions.setZ(i, positions.getZ(i) + 0.012 * Math.sin(t * Math.PI))
    }
    geometry.computeVertexNormals()
    return geometry.translate(0, -0.045, 0.163)
  })
  mesh(torso, 'obi-bow', combine([...bowLoops, ellipsoid(0, -0.045, 0.184, 0.02, 0.022, 0.015, 10, 6)]), blue)
  const pouch = pivot(hips, 'pouch', -0.173, 0.015, 0.205)
  mesh(pouch, 'mochi-pouch', ellipsoid(0, 0, 0, 0.065, 0.065, 0.033), cream)
  const cordCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.12, 0.14, 0.12), new THREE.Vector3(-0.19, 0.087, 0.17), new THREE.Vector3(-0.173, 0.067, 0.205)
  ])
  mesh(hips, 'pouch-cord', combine([
    new THREE.TubeGeometry(cordCurve, 12, 0.005, 4, false),
    ...[-1, 0, 1].map((s) => ellipsoid(-0.173 + s * 0.019, 0.075, 0.205, 0.013, 0.021, 0.015, 8, 6))
  ]), pink)
  for (const [leg, sign] of [[legL, 1], [legR, -1]]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.07, -0.248, 0.043), new THREE.Vector3(-0.04, -0.222, 0.051),
      new THREE.Vector3(0.04, -0.222, 0.051), new THREE.Vector3(0.07, -0.248, 0.043)
    ])
    mesh(leg, `shoe-strap-${sign === 1 ? 'left' : 'right'}`, new THREE.TubeGeometry(curve, 10, 0.011, 5, false), pink)
  }
  const clip = pivot(head, 'sakura', 0.335, 0.435, 0.198)
  clip.rotation.y = 0.35
  const petals = []
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * Math.PI * 2
    const geometry = ellipsoid(0, 0.033, 0, 0.027, 0.038, 0.012, 10, 6)
    geometry.rotateZ(angle)
    petals.push(geometry)
  }
  mesh(clip, 'sakura-petals', combine(petals), petal)
  const stamens = [ellipsoid(0, 0, 0.014, 0.012, 0.012, 0.009, 8, 6)]
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * Math.PI * 2
    const stem = new THREE.CylinderGeometry(0.0022, 0.0022, 0.029, 4)
    stem.translate(0, 0.0145, 0.014).rotateZ(angle)
    stamens.push(stem, ellipsoid(-Math.sin(angle) * 0.029, Math.cos(angle) * 0.029, 0.014, 0.004, 0.004, 0.004, 6, 4))
  }
  mesh(clip, 'sakura-stamens', combine(stamens), white)
  const scarf = new THREE.Group()
  scarf.name = 'winter-scarf'
  scarf.position.set(0, 0.105, 0)
  torso.add(scarf)
  const scarfMaterial = material('#E991AA')
  mesh(scarf, 'scarf-collar', new THREE.TorusGeometry(0.072, 0.02, 6, 20).rotateX(Math.PI / 2).scale(1.2, 1, 1), scarfMaterial)
  mesh(scarf, 'scarf-end', ellipsoid(-0.07, -0.059, 0.096, 0.025, 0.073, 0.012, 10, 6).rotateZ(-0.14), scarfMaterial)
  scarf.visible = false
  // 無 DOM 時仍可建立模型與檢查關節；瀏覽器才繪製內建表情。
  const makeTexture = (size) => {
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') :
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : null
    let texture
    let context = null
    if (canvas) {
      canvas.width = size
      canvas.height = size
      context = canvas.getContext('2d')
    }
    if (context) texture = new THREE.CanvasTexture(canvas)
    else {
      texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
      texture.needsUpdate = true
    }
    texture.colorSpace = THREE.SRGBColorSpace
    ownedTextures.push(texture)
    return { texture, context }
  }
  const decalMaterial = (texture) => {
    const value = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    ownedMaterials.push(value)
    return value
  }
  const faceTexture = makeTexture(1024)
  const faceGeometry = new THREE.PlaneGeometry(0.56, 0.35, 20, 14)
  const facePositions = faceGeometry.attributes.position
  for (let i = 0; i < facePositions.count; i++) {
    const x = facePositions.getX(i)
    const y = facePositions.getY(i) + 0.255
    const q = 1 - (x / 0.313) ** 2 - ((y - 0.285) / 0.275) ** 2
    facePositions.setXYZ(i, x, y, 0.062 + 0.242 * Math.sqrt(Math.max(0.003, q)) + 0.0025)
  }
  faceGeometry.computeVertexNormals()
  const faceMesh = mesh(head, 'face-markings', faceGeometry, decalMaterial(faceTexture.texture))
  faceMesh.castShadow = false
  faceMesh.receiveShadow = false
  faceMesh.renderOrder = 1
  let faceName = 'open'
  let mouthName = 'cat'
  let blush = 0.4
  const drawFace = () => {
    const ctx = faceTexture.context
    if (!ctx) return
    ctx.clearRect(0, 0, 1024, 1024)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const oval = (x, y, rx, ry, color) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    const ink = '#694733'
    const cy = 440
    for (const [cx, sign] of [[270, -1], [754, 1]]) {
      ctx.strokeStyle = '#BD8E6D'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(cx - 65, 210)
      ctx.quadraticCurveTo(cx, 174, cx + 61, 214)
      ctx.stroke()
      if (faceName === 'open' || faceName === 'half') {
        ctx.save()
        if (faceName === 'half') {
          ctx.beginPath()
          ctx.rect(cx - 115, cy + 16, 230, 190)
          ctx.clip()
        }
        oval(cx, cy, 103, 179, ink)
        oval(cx, cy + 12, 95, 165, '#FFFBF1')
        ctx.save()
        ctx.beginPath()
        ctx.ellipse(cx, cy + 12, 95, 165, 0, 0, Math.PI * 2)
        ctx.clip()
        const down = faceName === 'half' ? 46 : 8
        const gradient = ctx.createLinearGradient(0, cy - 145 + down, 0, cy + 165 + down)
        gradient.addColorStop(0, '#725035')
        gradient.addColorStop(0.45, '#C58B45')
        gradient.addColorStop(1, '#F6CF73')
        oval(cx + 4, cy + down, 74, 150, gradient)
        oval(cx + 4, cy + 9 + down, 29, 83, '#65452B')
        oval(cx - 25, cy - 73 + down, 18, 24, '#FFFFFF')
        oval(cx + 30, cy + 82 + down, 9, 12, '#FFF5CC')
        ctx.restore()
        ctx.restore()
        ctx.strokeStyle = ink
        ctx.lineWidth = 16
        ctx.beginPath()
        if (faceName === 'half') {
          ctx.moveTo(cx - 100, cy + 8)
          ctx.quadraticCurveTo(cx, cy + 23, cx + 100, cy + 14)
        } else {
          ctx.moveTo(cx - 99, cy - 40)
          ctx.bezierCurveTo(cx - 80, cy - 204, cx + 78, cy - 207, cx + 99, cy - 40)
        }
        ctx.stroke()
        ctx.lineWidth = 12
        ctx.beginPath()
        ctx.moveTo(cx + sign * 88, faceName === 'half' ? cy + 14 : cy - 85)
        ctx.lineTo(cx + sign * 119, faceName === 'half' ? cy - 2 : cy - 103)
        ctx.stroke()
      } else {
        ctx.strokeStyle = ink
        ctx.lineWidth = faceName === 'happy' ? 19 : 14
        ctx.beginPath()
        if (faceName === 'happy') {
          ctx.moveTo(cx - 87, cy + 30)
          ctx.quadraticCurveTo(cx, cy - 128, cx + 87, cy + 30)
        } else {
          ctx.moveTo(cx - 88, cy + 4)
          ctx.quadraticCurveTo(cx, cy + 63, cx + 88, cy + 4)
        }
        ctx.stroke()
      }
    }
    const redness = Math.max(blush, faceName === 'shy' ? 0.9 : 0)
    for (const x of [153, 871]) {
      ctx.save()
      ctx.translate(x, 713)
      ctx.scale(1, 0.64)
      const gradient = ctx.createRadialGradient(0, 0, 4, 0, 0, 117)
      gradient.addColorStop(0, `rgba(245, 134, 151, ${redness * 0.66})`)
      gradient.addColorStop(1, 'rgba(245, 134, 151, 0)')
      ctx.fillStyle = gradient
      ctx.fillRect(-118, -118, 236, 236)
      ctx.restore()
      if (faceName === 'shy') {
        ctx.strokeStyle = '#E89EAA'
        ctx.lineWidth = 5
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath()
          ctx.moveTo(x + i * 21 - 5, 716)
          ctx.lineTo(x + i * 21 + 4, 690)
          ctx.stroke()
        }
      }
    }
    oval(512, 684, 8, 6, '#E5AD94')
    if (mouthName === 'open') {
      oval(512, 811, 36, 57, '#B87065')
      oval(512, 834, 26, 25, '#F3A294')
    } else {
      ctx.strokeStyle = '#AB714D'
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.moveTo(469, 797)
      ctx.bezierCurveTo(470, 827, 496, 834, 512, 811)
      ctx.bezierCurveTo(528, 834, 554, 827, 555, 797)
      ctx.stroke()
    }
    faceTexture.texture.needsUpdate = true
  }
  const pouchTexture = makeTexture(128)
  if (pouchTexture.context) {
    const ctx = pouchTexture.context
    ctx.fillStyle = '#805B41'
    for (const x of [38, 90]) {
      ctx.beginPath()
      ctx.ellipse(x, 53, 5, 8, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#F2B4AD'
    for (const x of [24, 104]) {
      ctx.beginPath()
      ctx.ellipse(x, 71, 9, 5, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = '#805B41'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(53, 72)
    ctx.bezierCurveTo(54, 83, 61, 83, 64, 76)
    ctx.bezierCurveTo(67, 83, 74, 83, 75, 72)
    ctx.stroke()
    pouchTexture.texture.needsUpdate = true
  }
  const pouchGeometry = new THREE.PlaneGeometry(0.105, 0.08, 8, 6)
  const pouchPositions = pouchGeometry.attributes.position
  for (let i = 0; i < pouchPositions.count; i++) {
    const x = pouchPositions.getX(i)
    const y = pouchPositions.getY(i)
    pouchPositions.setZ(i, 0.033 * Math.sqrt(Math.max(0.002, 1 - (x / 0.065) ** 2 - (y / 0.065) ** 2)) + 0.001)
  }
  const pouchFace = mesh(pouch, 'pouch-face', pouchGeometry, decalMaterial(pouchTexture.texture))
  pouchFace.castShadow = false
  pouchFace.renderOrder = 1
  const clamp = (value) => Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0
  group.userData.setFace = (name) => {
    faceName = ['open', 'happy', 'closed', 'half', 'shy'].includes(name) ? name : 'open'
    drawFace()
  }
  group.userData.setBlush = (k) => {
    blush = clamp(k)
    drawFace()
  }
  group.userData.setMouth = (name) => {
    mouthName = name === 'open' ? 'open' : 'cat'
    drawFace()
  }
  group.userData.setClip = (color) => petal.color.set(color)
  group.userData.setClipVisible = (on) => { clip.visible = !!on }
  group.userData.setNight = (n) => {
    skin.emissive.copy(skin.color)
    hair.emissive.copy(hair.color)
    skin.emissiveIntensity = clamp(n) * 0.035
    hair.emissiveIntensity = clamp(n) * 0.018
  }
  drawFace()
  group.userData.setNight(0)
  group.userData.joints = { hips, torso, head, earL, earR, armL, armR, legL, legR, tail }
  group.userData.anchors = {
    headTop: pivot(head, 'headTop', 0, 0.653, -0.02),
    forehead: pivot(head, 'forehead', 0, 0.46, 0.29),
    face: pivot(head, 'face', 0, 0.27, 0.31),
    hairR: pivot(head, 'hairR', -0.365, 0.30, 0.075),
    neck: pivot(torso, 'neck', 0, 0.105, 0),
    handR: pivot(armR, 'handR', -0.023, -0.253, 0.018),
    handL: pivot(armL, 'handL', 0.023, -0.253, 0.018)
  }
  group.userData.scarf = scarf
  group.userData.ownedMaterials = ownedMaterials
  group.userData.ownedTextures = ownedTextures
  return group
}
