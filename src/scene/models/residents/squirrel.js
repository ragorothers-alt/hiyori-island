import * as THREE from 'three'

export function buildSquirrel() {
  const group = new THREE.Group()
  group.name = 'squirrel'
  const ownedMaterials = []
  const ownedTextures = []
  const mat = (color, options = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.84, flatShading: true, ...options })
    ownedMaterials.push(value)
    return value
  }
  const fur = mat('#BE5B32')
  const cream = mat('#FFE0A8')
  const bark = mat('#674127')
  const pink = mat('#E99583')
  const eyeMat = mat('#2E211A', { roughness: 0.16, flatShading: false })
  const white = mat('#FFFCF2', { roughness: 0.32 })
  const gold = mat('#D8A344', { roughness: 0.29, metalness: 0.15 })
  const dial = mat('#FFF0CF', { roughness: 0.72 })
  const acorn = mat('#BF8F57')
  const add = (parent, name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const pivot = (parent, name, x, y, z) => {
    const value = new THREE.Group()
    value.name = name
    value.position.set(x, y, z)
    parent.add(value)
    return value
  }
  const oval = (parent, name, center, size, material, segments = 12, rings = 8) => {
    return add(parent, name, new THREE.SphereGeometry(1, segments, rings).scale(...size).translate(...center), material)
  }
  const combine = parts => {
    const positions = []
    const normals = []
    for (const part of parts) {
      const geometry = part.index ? part.toNonIndexed() : part
      positions.push(...geometry.attributes.position.array)
      normals.push(...geometry.attributes.normal.array)
      if (geometry !== part) geometry.dispose()
      part.dispose()
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    return geometry
  }
  const tube = (points, radius = 0.004, segments = 10, sides = 5) => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
    const geometry = new THREE.TubeGeometry(curve, segments, radius, sides, false)
    const positions = Array.from(geometry.attributes.position.array)
    const indices = Array.from(geometry.index.array)
    for (const t of [0, 1]) {
      const center = curve.getPoint(t)
      const id = positions.length / 3
      positions.push(...center.toArray())
      const offset = t * segments * (sides + 1)
      const outward = curve.getTangent(t).multiplyScalar(t ? 1 : -1)
      for (let k = 0; k < sides; k++) {
        const a = new THREE.Vector3().fromArray(positions, (offset + k) * 3).sub(center)
        const b = new THREE.Vector3().fromArray(positions, (offset + k + 1) * 3).sub(center)
        if (a.cross(b).dot(outward) > 0) indices.push(id, offset + k, offset + k + 1)
        else indices.push(id, offset + k + 1, offset + k)
      }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.deleteAttribute('uv')
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    return geometry
  }
  const regions = (geometry, predicate) => {
    const source = Array.from(geometry.index.array)
    const position = geometry.attributes.position
    const bins = [[], []]
    for (let i = 0; i < source.length; i += 3) {
      const ids = source.slice(i, i + 3)
      const center = new THREE.Vector3()
      for (const id of ids) center.add(new THREE.Vector3().fromBufferAttribute(position, id))
      center.multiplyScalar(1 / 3)
      bins[predicate(center) ? 1 : 0].push(...ids)
    }
    geometry.setIndex([...bins[0], ...bins[1]])
    geometry.clearGroups()
    geometry.addGroup(0, bins[0].length, 0)
    geometry.addGroup(bins[0].length, bins[1].length, 1)
    return geometry
  }
  const maskedHead = source => {
    const position = source.attributes.position
    const indices = source.index.array
    const parts = [[], []]
    const clip = (polygon, field, inside) => {
      const result = []
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]
        const b = polygon[(i + 1) % polygon.length]
        const fa = field(a)
        const fb = field(b)
        const aIn = inside ? fa <= 0 : fa >= 0
        const bIn = inside ? fb <= 0 : fb >= 0
        if (aIn) result.push(a)
        if (aIn !== bIn) result.push(a.clone().lerp(b, fa / (fa - fb)))
      }
      return result
    }
    const emit = (polygon, material) => {
      for (let i = 1; i < polygon.length - 1; i++) {
        parts[material].push(...polygon[0].toArray(), ...polygon[i].toArray(), ...polygon[i + 1].toArray())
      }
    }
    const front = p => 0.09 - p.z
    const brow = p => p.y - 0.12 - 0.27 * Math.exp(-Math.pow((Math.abs(p.x) - 0.17) / 0.105, 2))
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, indices[i + j]))
      emit(clip(triangle, front, false), 0)
      const face = clip(triangle, front, true)
      emit(clip(face, brow, false), 0)
      emit(clip(face, brow, true), 1)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([...parts[0], ...parts[1]], 3))
    geometry.addGroup(0, parts[0].length / 3, 0)
    geometry.addGroup(parts[0].length / 3, parts[1].length / 3, 1)
    geometry.computeVertexNormals()
    source.dispose()
    return geometry
  }
  const body = pivot(group, 'body', 0, 0.22, 0)
  oval(body, 'torso', [0, 0, 0], [0.22, 0.18, 0.16], fur)
  oval(body, 'belly', [0, -0.015, 0.105], [0.174, 0.155, 0.064], cream)
  const head = pivot(body, 'head', 0, 0.18, 0.015)
  const skull = new THREE.SphereGeometry(1, 24, 18).scale(0.36, 0.28, 0.235).translate(0, 0.24, 0)
  // 奶油色面罩直接分配表面三角形，沒有貼圖與浮空色片。
  add(head, 'skull', maskedHead(skull), [fur, cream])
  oval(head, 'muzzle', [0, 0.12, 0.19], [0.303, 0.135, 0.083], cream)
  const earL = pivot(head, 'ear-l', 0.255, 0.40, -0.015)
  const earR = pivot(head, 'ear-r', -0.255, 0.40, -0.015)
  oval(earL, 'ear-shell-l', [0, 0.07, 0], [0.073, 0.09, 0.047], fur)
  oval(earR, 'ear-shell-r', [0, 0.07, 0], [0.073, 0.09, 0.047], fur)
  oval(earL, 'inner-ear-l', [0, 0.075, 0.039], [0.044, 0.061, 0.014], pink, 10, 6)
  oval(earR, 'inner-ear-r', [0, 0.075, 0.039], [0.044, 0.061, 0.014], pink, 10, 6)
  const eyes = []
  for (const sign of [1, -1]) {
    const eye = oval(head, sign > 0 ? 'eye-l' : 'eye-r', [0, 0, 0], [1, 1, 1], eyeMat, 12, 8)
    eye.position.set(sign * 0.155, 0.225, 0.225)
    eye.scale.set(0.0575, 0.07875, 0.0325)
    oval(eye, 'catchlight-' + sign, [-0.24, 0.32, 0.82], [0.22, 0.18, 0.17], white, 8, 6)
    eyes.push(eye)
  }
  oval(head, 'nose', [0, 0.145, 0.278], [0.027, 0.018, 0.022], bark, 10, 6)
  add(head, 'smile', tube([
    [-0.076, 0.119, 0.274], [-0.058, 0.099, 0.279], [-0.024, 0.099, 0.285],
    [0, 0.126, 0.286], [0.024, 0.099, 0.285], [0.058, 0.099, 0.279], [0.076, 0.119, 0.274]
  ], 0.0035, 18), bark)
  add(head, 'blush', combine([1, -1].map(sign => new THREE.SphereGeometry(1, 10, 6).scale(0.036, 0.029, 0.009).translate(sign * 0.22, 0.11, 0.25))), pink)
  const armL = pivot(body, 'arm-l', 0.19, 0.125, 0.035)
  const armR = pivot(body, 'arm-r', -0.19, 0.125, 0.035)
  oval(armL, 'arm-paw-l', [0.028, -0.073, 0.013], [0.062, 0.118, 0.064], fur)
  oval(armR, 'arm-paw-r', [-0.028, -0.073, 0.013], [0.062, 0.118, 0.064], fur)
  const legL = pivot(body, 'leg-l', 0.105, -0.116, 0)
  const legR = pivot(body, 'leg-r', -0.105, -0.116, 0)
  oval(legL, 'foot-l', [0, -0.052, 0.037], [0.079, 0.052, 0.102], fur)
  oval(legR, 'foot-r', [0, -0.052, 0.037], [0.079, 0.052, 0.102], fur)
  const tail = pivot(body, 'tail', 0, -0.10, -0.10)
  tail.rotation.y = 0
  const points = [
    [0, 0, 0], [0.20, -0.01, -0.02], [0.36, 0.10, -0.03],
    [0.40, 0.30, -0.025], [0.36, 0.49, -0.02],
    [0.18, 0.55, -0.02], [0.04, 0.42, -0.02],
    [0.10, 0.27, -0.02], [0.22, 0.31, -0.02]
  ]
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.4)
  const radii = [0.062, 0.085, 0.10, 0.10, 0.07, 0.065, 0.05, 0.025, 0.008]
  const positions = []
  const indices = []
  const rings = 56
  const sides = 12
  // 單一放樣尾巴保留完整捲曲輪廓。
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    const point = curve.getPoint(t)
    const tangent = curve.getTangent(t).normalize()
    const normal = new THREE.Vector3(tangent.y, -tangent.x, 0).normalize()
    const u = t * (radii.length - 1)
    const j = Math.min(radii.length - 2, Math.floor(u))
    const mix = THREE.MathUtils.smoothstep(u - j, 0, 1)
    const radius = THREE.MathUtils.lerp(radii[j], radii[j + 1], mix)
    for (let k = 0; k < sides; k++) {
      const a = k / sides * Math.PI * 2
      positions.push(point.x + normal.x * Math.cos(a) * radius, point.y + normal.y * Math.cos(a) * radius, point.z + Math.sin(a) * radius)
      if (i < rings) {
        const a = i * sides + k
        const b = i * sides + (k + 1) % sides
        indices.push(a, a + sides, b, b, a + sides, b + sides)
      }
    }
  }
  positions.push(...curve.getPoint(0).toArray(), ...curve.getPoint(1).toArray())
  for (let k = 0; k < sides; k++) {
    indices.push((rings + 1) * sides, k, (k + 1) % sides)
    indices.push((rings + 1) * sides + 1, rings * sides + (k + 1) % sides, rings * sides + k)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const tailIndices = [[], []]
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < sides; k++) {
      const start = (i * sides + k) * 6
      const inner = Math.cos((k + 0.5) / sides * Math.PI * 2) < -0.24
      tailIndices[inner ? 1 : 0].push(...indices.slice(start, start + 6))
    }
  }
  tailIndices[0].push(...indices.slice(rings * sides * 6))
  geometry.setIndex([...tailIndices[0], ...tailIndices[1]])
  geometry.addGroup(0, tailIndices[0].length, 0)
  geometry.addGroup(tailIndices[0].length, tailIndices[1].length, 1)
  add(tail, 'curled-tail', geometry, [fur, cream])
  const cap = pivot(head, 'acorn-cap', 0.04, 0.508, -0.01)
  const capGeometry = new THREE.SphereGeometry(1, 12, 8).scale(0.112, 0.044, 0.091).translate(0, 0.012, 0)
  regions(capGeometry, p => p.y < 0.008)
  add(cap, 'cap-shell', capGeometry, [acorn, bark])
  oval(cap, 'cap-stem', [0.012, 0.065, 0], [0.019, 0.035, 0.019], bark, 8, 6)
  const watch = pivot(body, 'pocket-watch', 0, 0.04, 0.185)
  const caseGeometry = new THREE.CylinderGeometry(0.083, 0.083, 0.023, 24, 1).rotateX(Math.PI / 2)
  add(watch, 'watch-case', caseGeometry, gold)
  add(watch, 'watch-dial', new THREE.CircleGeometry(0.069, 24).translate(0, 0, 0.013), dial)
  add(watch, 'watch-hands', tube([[-0.03, 0.025, 0.016], [0, 0, 0.016], [0.037, 0.033, 0.016]], 0.0033, 8), gold)
  add(body, 'watch-chain', tube([
    [-0.13, 0.16, 0.12], [-0.09, 0.13, 0.168], [0, 0.13, 0.19], [0.09, 0.13, 0.168], [0.13, 0.16, 0.12]
  ], 0.0038, 18), gold)
  add(body, 'watch-bail', new THREE.TorusGeometry(0.012, 0.004, 5, 12).translate(0, 0.129, 0.19), gold)
  group.userData.joints = { body, head, armL, armR, legL, legR, earL, earR, tail }
  group.userData.headTop = new THREE.Vector3(0, 1.07, 0.015)
  group.userData.ownedMaterials = ownedMaterials
  group.userData.ownedTextures = ownedTextures
  const parts = []
  group.traverse(part => {
    if (part.isMesh) parts.push(part)
  })
  group.userData.sculptRuntime = { parts, joints: group.userData.joints, sockets: { headTop: group.userData.headTop } }
  const amount = value => THREE.MathUtils.clamp(Number(value) || 0, 0, 1)
  group.userData.anim = (t, dt, state) => {
    const time = Number.isFinite(t) ? t : 0
    const walk = amount(state?.walk)
    const wave = amount(state?.wave)
    const talk = amount(state?.talk)
    const night = amount(state?.night)
    const stride = Math.sin(time * 7.2)
    const breath = Math.sin(time * (2.1 - night * 0.55)) * 0.003
    const bob = Math.abs(stride) * walk * 0.008
    // 絕對時間決定姿態，保留外層角色的移動與縮放。
    body.position.set(0, 0.22 + bob, 0)
    body.rotation.set(0, Math.sin(time * 1.2) * talk * 0.018, 0)
    body.scale.set(1 + breath, 1, 1 + breath)
    head.position.set(0, 0.18 + Math.sin(time * 2.1) * 0.0015, 0.015)
    head.rotation.set(
      Math.sin(time * 1.6) * 0.008 + talk * Math.sin(time * 8.6) * 0.024 + night * 0.025,
      Math.sin(time * 0.8) * 0.012 + talk * Math.sin(time * 3.1) * 0.045,
      Math.sin(time * 1.1) * 0.008 + talk * Math.sin(time * 4.2) * 0.016
    )
    legL.position.set(0.105, -0.116 + Math.max(0, stride) * walk * 0.035, 0)
    legR.position.set(-0.105, -0.116 + Math.max(0, -stride) * walk * 0.035, 0)
    legL.rotation.set(stride * walk * 0.38, 0, 0)
    legR.rotation.set(-stride * walk * 0.38, 0, 0)
    armL.rotation.set(-stride * walk * 0.30, 0, 0)
    // 右手抬起後仍可與步行混合。
    armR.rotation.set(
      stride * walk * 0.30 * (1 - wave),
      wave * (0.10 + Math.sin(time * 6.5) * 0.10),
      wave * (-2.10 + Math.sin(time * 7.2) * 0.17)
    )
    const twitchL = Math.pow(Math.max(0, Math.sin(time * 1.4)), 18)
    const twitchR = Math.pow(Math.max(0, Math.sin(time * 1.4 + 1.8)), 18)
    earL.rotation.set(twitchL * 0.065, 0, twitchL * 0.065)
    earR.rotation.set(twitchR * 0.065, 0, -twitchR * 0.065)
    tail.rotation.set(
      Math.sin(time * 1.7) * 0.025,
      Math.sin(time * 1.3) * 0.045 + stride * walk * 0.025,
      Math.sin(time * 1.1) * 0.018
    )
    const blinkPhase = ((time % 4.8) + 4.8) % 4.8
    const blinkPulse = Math.max(0, 1 - Math.abs(blinkPhase - 4.52) / 0.105)
    const blink = blinkPulse * blinkPulse * (3 - 2 * blinkPulse)
    const eyeHeight = 0.07875 * (1 - blink * 0.94) * (1 - night * 0.22)
    eyes[0].scale.set(0.0575, eyeHeight, 0.0325)
    eyes[1].scale.set(0.0575, eyeHeight, 0.0325)
  }
  return group
}
