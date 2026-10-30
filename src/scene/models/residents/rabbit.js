import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export function buildRabbit() {
  const root = new THREE.Group()
  root.name = 'Shiratama'
  const ownedMaterials = []
  const material = (color, roughness = 0.88) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
    ownedMaterials.push(result)
    return result
  }
  const cream = material('#fff2df')
  const pink = material('#eea0ab')
  const nosePink = material('#eea0ab', 0.53)
  const cocoa = material('#73503d', 0.98)
  const dark = material('#432d23', 0.42)
  const ceramic = material('#fff0d4', 0.38)
  const coffee = material('#633c27', 0.3)
  const cheek = material('#f2c0b5')
  const glint = material('#fff9ec', 0.4)
  const sphere = new THREE.SphereGeometry(1, 12, 8)
  const mesh = (name, geometry, mat, parent, position = [0, 0, 0]) => {
    const part = new THREE.Mesh(geometry, mat)
    part.name = name
    part.position.set(...position)
    part.castShadow = true
    part.receiveShadow = true
    parent.add(part)
    return part
  }
  const oval = (name, parent, position, scale, mat = cream) => {
    const part = mesh(name, sphere, mat, parent, position)
    part.scale.set(...scale)
    return part
  }
  const pivot = (name, parent, position) => {
    const joint = new THREE.Group()
    joint.name = name
    joint.position.set(...position)
    parent.add(joint)
    return joint
  }
  const combine = (parts) => {
    const geometries = parts.map(([geometry, position, scale, rotation = [0, 0, 0]]) => {
      const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone()
      const transform = new THREE.Matrix4().compose(
        new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
        new THREE.Vector3(...scale)
      )
      copy.applyMatrix4(transform)
      return copy
    })
    const merged = mergeGeometries(geometries, false)
    geometries.forEach(geometry => geometry.dispose())
    return merged
  }
  const earGeometry = (droop, inset = false) => {
    const geometry = new THREE.SphereGeometry(1, 12, 10)
    const positions = geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      const sy = positions.getY(i)
      const u = (sy + 1) * 0.5 * (inset ? 0.78 : 1) + (inset ? 0.1 : 0)
      const x = droop ? 0.12 * u : -0.025 * u
      const y = droop ? 0.045 * Math.sin(Math.PI * u) - 0.185 * u * u : 0.22 * u
      const dx = droop ? 0.12 : -0.025
      const dy = droop ? 0.045 * Math.PI * Math.cos(Math.PI * u) - 0.37 * u : 0.22
      const length = Math.hypot(dx, dy)
      const width = positions.getX(i) * (inset ? 0.03 : 0.052)
      positions.setXYZ(i, x + width * dy / length, y - width * dx / length, positions.getZ(i) * (inset ? 0.008 : 0.031) + (inset ? 0.026 : 0))
    }
    geometry.computeVertexNormals()
    return geometry
  }

  const body = pivot('body', root, [0, 0.29, 0])
  oval('cream-body', body, [0, 0.035, 0], [0.18, 0.235, 0.145])
  const head = pivot('head', body, [0, 0.2, 0])
  const headMesh = mesh('cream-head', new THREE.SphereGeometry(1, 20, 14), cream, head, [0, 0.19, 0])
  headMesh.scale.set(0.263, 0.22, 0.205)
  const armL = pivot('armL', body, [0.16, 0.185, 0])
  const armR = pivot('armR', body, [-0.16, 0.185, 0])
  const pawL = oval('left-paw', armL, [0.03, -0.08, 0.035], [0.07, 0.125, 0.065])
  pawL.rotation.z = 0.32
  const pawR = oval('right-serving-paw', armR, [-0.065, -0.075, 0.09], [0.068, 0.13, 0.064])
  pawR.rotation.set(-0.72, 0, -0.65)
  const legL = pivot('legL', body, [0.095, -0.135, 0])
  const legR = pivot('legR', body, [-0.095, -0.135, 0])
  oval('left-foot', legL, [0, -0.055, 0.018], [0.073, 0.1, 0.093])
  oval('right-foot', legR, [0, -0.055, 0.018], [0.073, 0.1, 0.093])
  const earL = pivot('earL', head, [0.175, 0.35, -0.015])
  const earR = pivot('earR', head, [-0.14, 0.36, -0.015])
  mesh('left-drooped-ear', earGeometry(true), cream, earL)
  mesh('right-upright-ear', earGeometry(false), cream, earR)
  mesh('left-pink-inner-ear', earGeometry(true, true), pink, earL)
  mesh('right-pink-inner-ear', earGeometry(false, true), pink, earR)
  const tail = pivot('tail', body, [0, -0.065, -0.145])
  oval('round-tail', tail, [0, 0, -0.04], [0.075, 0.075, 0.075])

  // 有厚度的弧面圍裙，避免平板與肚子穿插
  const apronGeometry = new THREE.BufferGeometry()
  const apronVertices = []
  const apronIndices = []
  const columns = 10
  const rows = 7
  const layerSize = (columns + 1) * (rows + 1)
  for (let layer = 0; layer < 2; layer++) {
    for (let row = 0; row <= rows; row++) {
      const v = row / rows
      for (let column = 0; column <= columns; column++) {
        const u = column / columns * 2 - 1
        const x = u * (0.183 - 0.072 * v)
        const y = -0.145 + v * 0.325 + 0.024 * u * u * (1 - v)
        const z = 0.145 * Math.sqrt(Math.max(0.04, 1 - x * x / 0.04 - (y - 0.035) ** 2 / 0.0676)) + 0.022 + layer * 0.009
        apronVertices.push(x, y, z)
      }
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column
      const b = a + 1
      const c = a + columns + 1
      const d = c + 1
      apronIndices.push(a, c, b, b, c, d, a + layerSize, b + layerSize, c + layerSize, b + layerSize, d + layerSize, c + layerSize)
    }
  }
  const edge = [...Array(columns + 1).keys()]
  for (let row = 1; row <= rows; row++) edge.push(row * (columns + 1) + columns)
  for (let column = columns - 1; column >= 0; column--) edge.push(rows * (columns + 1) + column)
  for (let row = rows - 1; row > 0; row--) edge.push(row * (columns + 1))
  for (let i = 0; i < edge.length; i++) {
    const a = edge[i]
    const b = edge[(i + 1) % edge.length]
    apronIndices.push(a, b, b + layerSize, a, b + layerSize, a + layerSize)
  }
  apronGeometry.setAttribute('position', new THREE.Float32BufferAttribute(apronVertices, 3))
  apronGeometry.setIndex(apronIndices)
  apronGeometry.computeVertexNormals()
  mesh('cocoa-apron', apronGeometry, cocoa, body)
  const strapBox = new THREE.BoxGeometry(1, 1, 1)
  mesh('apron-straps-and-back-tie', combine([
    [strapBox, [-0.08, 0.185, 0.088], [0.027, 0.15, 0.025], [-0.42, 0, -0.2]],
    [strapBox, [0.08, 0.185, 0.088], [0.027, 0.15, 0.025], [-0.42, 0, 0.2]],
    [sphere, [0, 0.01, -0.133], [0.18, 0.022, 0.026]],
    [sphere, [-0.035, 0.01, -0.16], [0.042, 0.025, 0.018], [0, 0, -0.3]],
    [sphere, [0.035, 0.01, -0.16], [0.042, 0.025, 0.018], [0, 0, 0.3]]
  ]), cocoa, body)
  strapBox.dispose()

  // 杯碟跟隨自身右掌，動畫時另行抵消手臂轉角
  const cupCarrier = pivot('right-cup-carrier', armR, [-0.135, -0.06, 0.17])
  oval('right-supporting-palm', armR, [-0.135, -0.08, 0.17], [0.052, 0.022, 0.048])
  mesh('cream-saucer', new THREE.CylinderGeometry(0.076, 0.067, 0.014, 20), ceramic, cupCarrier)
  const cupProfile = [
    new THREE.Vector2(0.027, 0.008), new THREE.Vector2(0.035, 0.016),
    new THREE.Vector2(0.045, 0.066), new THREE.Vector2(0.042, 0.071),
    new THREE.Vector2(0.036, 0.066), new THREE.Vector2(0.03, 0.025),
    new THREE.Vector2(0, 0.022)
  ]
  mesh('cream-coffee-cup', new THREE.LatheGeometry(cupProfile, 18), ceramic, cupCarrier)
  mesh('coffee-surface', new THREE.CylinderGeometry(0.036, 0.036, 0.003, 18), coffee, cupCarrier, [0, 0.06, 0])
  const handle = mesh('cup-handle', new THREE.TorusGeometry(0.019, 0.006, 6, 12), ceramic, cupCarrier, [-0.044, 0.044, 0])
  handle.scale.x = 0.8

  const eyeL = oval('left-eye', head, [0.105, 0.155, 0.187], [0.019, 0.026, 0.014], dark)
  const eyeR = oval('right-eye', head, [-0.105, 0.155, 0.187], [0.019, 0.026, 0.014], dark)
  const catchlights = mesh('eye-catchlights', combine([
    [sphere, [0.1, 0.163, 0.2], [0.004, 0.005, 0.002]],
    [sphere, [-0.11, 0.163, 0.2], [0.004, 0.005, 0.002]]
  ]), glint, head)
  mesh('rosy-cheeks', combine([
    [sphere, [0.163, 0.115, 0.151], [0.032, 0.018, 0.009], [0, 0.45, 0]],
    [sphere, [-0.163, 0.115, 0.151], [0.032, 0.018, 0.009], [0, -0.45, 0]]
  ]), cheek, head)
  const noseShape = new THREE.Shape()
  noseShape.moveTo(-0.019, 0.007)
  noseShape.quadraticCurveTo(0, 0.016, 0.019, 0.007)
  noseShape.quadraticCurveTo(0.015, -0.002, 0, -0.012)
  noseShape.quadraticCurveTo(-0.015, -0.002, -0.019, 0.007)
  mesh('pink-nose', new THREE.ExtrudeGeometry(noseShape, { depth: 0.007, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1, curveSegments: 5 }), nosePink, head, [0, 0.128, 0.198])
  const smilePaths = [
    [[0, 0.119, 0.207], [0, 0.111, 0.205], [0, 0.103, 0.202]],
    [[0, 0.103, 0.202], [-0.012, 0.09, 0.199], [-0.029, 0.103, 0.2]],
    [[0, 0.103, 0.202], [0.012, 0.09, 0.199], [0.029, 0.103, 0.2]]
  ]
  const smileGeometries = smilePaths.map(points => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point))), 8, 0.0024, 4, false))
  mesh('gentle-smile', mergeGeometries(smileGeometries, false), dark, head)
  smileGeometries.forEach(geometry => geometry.dispose())
  const bowLoop = sign => {
    const shape = new THREE.Shape()
    shape.moveTo(sign * 0.012, -0.012)
    shape.lineTo(sign * 0.046, -0.029)
    shape.quadraticCurveTo(sign * 0.061, -0.033, sign * 0.059, -0.014)
    shape.lineTo(sign * 0.056, 0.019)
    shape.quadraticCurveTo(sign * 0.054, 0.032, sign * 0.039, 0.024)
    shape.lineTo(sign * 0.012, 0.012)
    shape.closePath()
    return new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.004, bevelSegments: 1, curveSegments: 4 })
  }
  const bowLeft = bowLoop(-1)
  const bowRight = bowLoop(1)
  const bow = mesh('pink-ear-bow', combine([
    [bowLeft, [0, 0, 0], [1, 1, 1]],
    [bowRight, [0, 0, 0], [1, 1, 1]],
    [sphere, [0, 0, 0.013], [0.016, 0.02, 0.018]]
  ]), pink, head, [0.125, 0.36, 0.112])
  bow.rotation.z = -0.26
  bowLeft.dispose()
  bowRight.dispose()
  const pocketShape = new THREE.Shape()
  pocketShape.moveTo(-0.068, 0.033)
  pocketShape.lineTo(0.068, 0.033)
  pocketShape.lineTo(0.063, -0.009)
  pocketShape.quadraticCurveTo(0.06, -0.042, 0, -0.045)
  pocketShape.quadraticCurveTo(-0.06, -0.042, -0.063, -0.009)
  pocketShape.closePath()
  mesh('cream-apron-pocket', new THREE.ExtrudeGeometry(pocketShape, { depth: 0.009, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 1, curveSegments: 6 }), ceramic, body, [0, -0.055, 0.166])
  const heartShape = new THREE.Shape()
  heartShape.moveTo(0, -0.023)
  heartShape.bezierCurveTo(-0.052, 0.009, -0.019, 0.046, 0, 0.022)
  heartShape.bezierCurveTo(0.019, 0.046, 0.052, 0.009, 0, -0.023)
  mesh('pink-apron-heart', new THREE.ExtrudeGeometry(heartShape, { depth: 0.005, bevelEnabled: false, curveSegments: 6 }), pink, body, [0.089, 0.092, 0.156])

  root.userData.joints = { body, head, armL, armR, legL, legR, earL, earR, tail }
  root.userData.headTop = new THREE.Vector3(0, 1.05, 0)
  root.userData.ownedMaterials = ownedMaterials
  root.userData.ownedTextures = []
  const cupRotation = new THREE.Quaternion()
  const amount = value => THREE.MathUtils.clamp(Number(value) || 0, 0, 1)
  root.userData.anim = (t, dt, state = {}) => {
    const time = Number.isFinite(t) ? t : 0
    const walk = amount(state.walk)
    const wave = amount(state.wave)
    const talk = amount(state.talk)
    const night = amount(state.night)
    const phase = time * 8
    const bounce = Math.sin(phase)
    const breath = 1 + Math.sin(time * (2.3 - night * 0.7)) * 0.003
    const hop = Math.max(0, bounce) * 0.016 * walk

    // 每幀從基準姿勢計算，外層 root 留給場景控制
    body.position.set(0, 0.29 * breath + hop, 0)
    body.scale.set(1, breath, 1)
    body.rotation.set(-0.014 * bounce * walk, 0, Math.sin(time * 2.4) * (0.003 + talk * 0.009))
    body.position.y += Math.abs(body.rotation.z) * 0.18 + Math.max(0, -bounce) * walk * 0.011
    head.rotation.set(Math.sin(time * 3.1) * talk * 0.015, Math.sin(time * 1.8) * talk * 0.025, Math.sin(time * 2.1) * (0.004 + talk * 0.036))
    legL.rotation.set(bounce * walk * 0.16, 0, 0)
    legR.rotation.set(bounce * walk * 0.15, 0, 0)
    armL.rotation.set(-bounce * walk * 0.1, 0, 0.035 * Math.sin(time * 2))
    armR.rotation.set(wave * 0.12, 0, wave * (-1.85 + 0.22 * Math.sin(time * 9)))
    tail.rotation.set(Math.sin(time * 2.8) * 0.04, Math.sin(time * 3.7) * 0.06, 0)
    const twitchPhase = ((time % 6.7) + 6.7) % 6.7
    const twitch = Math.exp(-(((twitchPhase - 5.8) * 7) ** 2)) * Math.sin(time * 32)
    earL.rotation.set(Math.sin(time * 2.3) * 0.018, 0, 0.02 * Math.sin(time * 2) + twitch * 0.08)
    earR.rotation.set(Math.sin(time * 1.9) * 0.015, 0, 0.012 * Math.sin(time * 2.1) - twitch * 0.07)
    const blinkPhase = ((time % 4.3) + 4.3) % 4.3
    const blink = 1 - 0.93 * Math.max(0, 1 - Math.abs(blinkPhase - 3.82) / 0.105)
    eyeL.scale.y = 0.026 * blink * (1 - night * 0.16)
    eyeR.scale.y = 0.026 * blink * (1 - night * 0.16)
    catchlights.visible = blink > 0.6

    // 先收杯再揮右手，杯碟可見時保持相對地面的水平
    const serving = Math.max(0, 1 - wave * 12)
    cupCarrier.visible = serving > 0.001
    cupCarrier.scale.setScalar(serving)
    cupRotation.copy(body.quaternion).multiply(armR.quaternion).invert()
    cupCarrier.quaternion.copy(cupRotation)
  }
  return root
}
