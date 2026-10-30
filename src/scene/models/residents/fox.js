import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// +X 是角色左側，所有動作從自然關節重新計算。
export function buildFox() {
  const root = new THREE.Group()
  root.name = 'Kon'
  const ownedMaterials = []
  const material = (color, roughness = 0.84) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
    ownedMaterials.push(result)
    return result
  }
  const orange = material('#e78334')
  const cream = material('#fff0d6', 0.89)
  const pink = material('#e89a9b', 0.9)
  const brown = material('#765039', 0.92)
  const navy = material('#304361', 0.83)
  const dark = material('#372820', 0.38)
  const gold = material('#d9b568', 0.52)
  const group = (name, parent, x, y, z) => {
    const result = new THREE.Group()
    result.name = name
    result.position.set(x, y, z)
    parent.add(result)
    return result
  }
  const mesh = (name, parent, geometry, surface, position = [0, 0, 0]) => {
    const result = new THREE.Mesh(geometry, surface)
    result.name = name
    result.position.set(...position)
    result.castShadow = true
    result.receiveShadow = true
    parent.add(result)
    return result
  }
  const oval = (scale, position = [0, 0, 0], width = 12, height = 8) => {
    const geometry = new THREE.SphereGeometry(1, width, height)
    geometry.scale(...scale)
    geometry.translate(...position)
    return geometry
  }
  const joined = geometries => {
    const result = mergeGeometries(geometries, true)
    geometries.forEach(geometry => geometry.dispose())
    return result
  }
  const profile = (points, depth, bevel = 0) => {
    const shape = new THREE.Shape()
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
    shape.closePath()
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: depth - bevel * 2,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      steps: 1,
      curveSegments: 1
    })
    geometry.translate(0, 0, -depth / 2 + bevel)
    return geometry
  }
  const rounded = (width, height, depth, radius = 0.018) => {
    const shape = new THREE.Shape()
    const x = width / 2
    const y = height / 2
    shape.moveTo(-x + radius, -y)
    shape.lineTo(x - radius, -y)
    shape.quadraticCurveTo(x, -y, x, -y + radius)
    shape.lineTo(x, y - radius)
    shape.quadraticCurveTo(x, y, x - radius, y)
    shape.lineTo(-x + radius, y)
    shape.quadraticCurveTo(-x, y, -x, y - radius)
    shape.lineTo(-x, -y + radius)
    shape.quadraticCurveTo(-x, -y, -x + radius, -y)
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: depth - 0.008,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 1,
      steps: 1,
      curveSegments: 2
    })
    geometry.translate(0, 0, -depth / 2 + 0.004)
    return geometry
  }
  const tube = (points, radius, segments = 10) => new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point))),
    segments, radius, 5, false
  )

  const body = group('body', root, 0, 0.33, 0)
  mesh('orange-fur-body', body, oval([0.185, 0.245, 0.137]), orange)
  const head = group('head', body, 0, 0.21, 0)
  // 頰毛由頭部同一個封閉體延伸，白色區域沿真正的幾何邊界分材質。
  const headRings = [
    [-0.005, 0.13, 0.085], [0.025, 0.225, 0.145], [0.075, 0.29, 0.18],
    [0.115, 0.32, 0.19], [0.18, 0.285, 0.195], [0.25, 0.25, 0.165],
    [0.31, 0.19, 0.12], [0.355, 0.105, 0.065], [0.37, 0, 0]
  ]
  const headPositions = []
  const orangeHeadIndices = []
  const creamHeadIndices = []
  headRings.forEach(([y, width, depth], row) => {
    for (let j = 0; j <= 16; j++) {
      const angle = j / 16 * Math.PI * 2
      const contour = row === 3 ? 0.014 * Math.abs(Math.cos(angle)) : 0
      headPositions.push(Math.cos(angle) * width, y + contour, Math.sin(angle) * depth)
    }
  })
  const chinCenter = headPositions.length / 3
  headPositions.push(0, -0.005, 0)
  const headGeometry = new THREE.BufferGeometry()
  headGeometry.setAttribute('position', new THREE.Float32BufferAttribute(headPositions, 3))
  for (let i = 0; i < headRings.length - 1; i++) {
    for (let j = 0; j < 16; j++) {
      const a = i * 17 + j
      const b = a + 17
      const front = Math.sin((j + 0.5) / 16 * Math.PI * 2) > -0.3
      const indices = i < 3 && front ? creamHeadIndices : orangeHeadIndices
      indices.push(a, b, a + 1)
      if (i < headRings.length - 2) indices.push(b, b + 1, a + 1)
    }
  }
  for (let j = 0; j < 16; j++) creamHeadIndices.push(chinCenter, j, j + 1)
  headGeometry.setIndex([...orangeHeadIndices, ...creamHeadIndices])
  headGeometry.addGroup(0, orangeHeadIndices.length, 0)
  headGeometry.addGroup(orangeHeadIndices.length, creamHeadIndices.length, 1)
  headGeometry.computeVertexNormals()
  mesh('fox-head-cheek-mask', head, headGeometry, [orange, cream])
  const ears = [1, -1].map(sign => {
    const ear = group(sign > 0 ? 'earL' : 'earR', head, sign * 0.205, 0.32, -0.015)
    const points = [[sign * -0.09, -0.035], [sign * 0.085, -0.015], [sign * 0.055, 0.218]]
    const inner = profile([[sign * -0.052, 0.002], [sign * 0.056, 0.012], [sign * 0.05, 0.17]], 0.008)
    inner.translate(0, 0, 0.035)
    const tip = profile([[sign * 0.014, 0.145], [sign * 0.065, 0.145], [sign * 0.055, 0.218]], 0.067)
    mesh('pointed-ear-pink-interior', ear, joined([profile(points, 0.065), inner, tip]), [orange, pink, brown])
    return ear
  })
  const arms = [1, -1].map(sign => {
    const arm = group(sign > 0 ? 'armL' : 'armR', body, sign * 0.16, 0.11, 0)
    mesh('foreleg-paw', arm, joined([
      oval([0.061, 0.112, 0.064], [sign * 0.018, -0.075, 0]),
      oval([0.059, 0.066, 0.062], [sign * 0.03, -0.17, 0.01])
    ]), [orange, brown])
    arm.rotation.z = sign * 0.24
    return arm
  })
  const legs = [1, -1].map(sign => {
    const leg = group(sign > 0 ? 'legL' : 'legR', root, sign * 0.09, 0.17, 0)
    mesh('hindleg-foot', leg, joined([
      oval([0.068, 0.093, 0.067], [0, -0.055, 0]),
      oval([0.067, 0.043, 0.088], [0, -0.127, 0.025])
    ]), [orange, brown])
    return leg
  })

  // 橘尾與白尾尖共用連續掃掠幾何，根部藏入臀部。
  const tail = group('tail', body, 0.08, -0.1, -0.09)
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.12, -0.02, -0.06),
    new THREE.Vector3(0.25, 0.04, -0.075),
    new THREE.Vector3(0.32, 0.16, -0.06),
    new THREE.Vector3(0.32, 0.30, -0.03)
  ])
  const tailGeometry = new THREE.TubeGeometry(tailCurve, 16, 1, 10, false)
  const frames = tailCurve.computeFrenetFrames(16, false)
  const positions = tailGeometry.attributes.position
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const center = tailCurve.getPointAt(t)
    const radius = 0.033 * (1 - t) + 0.115 * Math.pow(Math.sin(Math.PI * t), 0.9) + 0.002
    for (let j = 0; j <= 10; j++) {
      const angle = j / 10 * Math.PI * 2
      const point = center.clone()
        .addScaledVector(frames.normals[i], -Math.cos(angle) * radius)
        .addScaledVector(frames.binormals[i], Math.sin(angle) * radius)
      positions.setXYZ(i * 11 + j, point.x, point.y, point.z)
    }
  }
  tailGeometry.clearGroups()
  tailGeometry.addGroup(0, 11 * 10 * 6, 0)
  tailGeometry.addGroup(11 * 10 * 6, 5 * 10 * 6, 1)
  tailGeometry.computeVertexNormals()
  mesh('sweeping-tail-white-tip', tail, tailGeometry, [orange, cream])

  const cap = group('postal-cap', head, 0, 0.38, 0.008)
  mesh('navy-cap-crown', cap, oval([0.16, 0.066, 0.13], [0, 0, 0], 14, 8), navy)
  mesh('navy-cap-peak', cap, oval([0.166, 0.014, 0.10], [0, -0.04, 0.105]), navy)
  const band = new THREE.CylinderGeometry(0.145, 0.145, 0.03, 14)
  band.scale(1, 1, 0.83)
  mesh('cap-band', cap, band, navy, [0, -0.035, 0])
  mesh('cream-envelope-badge', cap, rounded(0.095, 0.057, 0.015, 0.005), cream, [0, -0.001, 0.127])
  mesh('envelope-flap-seam', cap, joined([
    tube([[-0.044, 0.021, 0.137], [0, -0.008, 0.138], [0.044, 0.021, 0.137]], 0.0017, 8),
    tube([[-0.044, -0.022, 0.137], [-0.017, -0.003, 0.138]], 0.0012, 3),
    tube([[0.044, -0.022, 0.137], [0.017, -0.003, 0.138]], 0.0012, 3)
  ]), brown)

  mesh('white-chest-tuft', body, profile([
    [-0.075, 0.07], [0.075, 0.07], [0.057, -0.025], [0.035, -0.012],
    [0.015, -0.065], [-0.008, -0.035], [-0.036, -0.067], [-0.05, -0.02]
  ], 0.036, 0.006), cream, [0, 0.16, 0.124])
  mesh('white-belly', body, oval([0.108, 0.135, 0.025], [0, -0.035, 0.125]), cream)

  const eyes = [1, -1].map(sign => mesh(
    sign > 0 ? 'gentle-eye-l' : 'gentle-eye-r', head,
    oval([0.026, 0.037, 0.018]), dark, [sign * 0.117, 0.158, 0.177]
  ))
  const eyeGlints = mesh('eye-catchlights', head, joined([1, -1].map(sign => oval(
    [0.006, 0.008, 0.003], [sign * 0.117 - 0.007, 0.011, 0.193], 6, 4
  ))), cream, [0, 0.158, 0])
  mesh('soft-triangular-nose', head, profile([[-0.022, 0.012], [0.022, 0.012], [0, -0.014]], 0.025), dark, [0, 0.119, 0.198])
  mesh('gentle-smile', head, joined([
    tube([[0, 0.108, 0.202], [0, 0.092, 0.202]], 0.0028, 3),
    tube([[0, 0.092, 0.202], [-0.012, 0.079, 0.199], [-0.027, 0.08, 0.196], [-0.04, 0.092, 0.191]], 0.0028, 9),
    tube([[0, 0.092, 0.202], [0.012, 0.079, 0.199], [0.027, 0.08, 0.196], [0.04, 0.092, 0.191]], 0.0028, 9)
  ]), dark)

  const strapPanels = []
  for (const side of [1, -1]) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.13, 0.195, side * 0.074),
      new THREE.Vector3(-0.09, 0.11, side * 0.132),
      new THREE.Vector3(0.035, -0.012, side * 0.15),
      new THREE.Vector3(0.165, -0.095, side * 0.10)
    ])
    const vertices = []
    const indices = []
    for (let i = 0; i <= 24; i++) {
      const center = path.getPoint(i / 24)
      const tangent = path.getTangent(i / 24)
      const lateral = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize().multiplyScalar(0.0215)
      for (const [across, thickness] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        const vertex = center.clone().addScaledVector(lateral, across)
        vertices.push(vertex.x, vertex.y, vertex.z + thickness * 0.007)
      }
      if (i < 24) {
        for (let j = 0; j < 4; j++) {
          const a = i * 4 + j
          const b = i * 4 + (j + 1) % 4
          indices.push(a, b, a + 4, b, b + 4, a + 4)
        }
      }
    }
    indices.push(0, 3, 1, 1, 3, 2, 96, 97, 99, 97, 98, 99)
    const ribbon = new THREE.BufferGeometry()
    ribbon.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    ribbon.setIndex(indices)
    ribbon.computeVertexNormals()
    strapPanels.push(ribbon)
  }
  mesh('crossbody-postal-strap', body, joined(strapPanels), brown)
  const satchel = group('postal-satchel', body, 0.177, -0.09, 0.12)
  mesh('satchel-body', satchel, rounded(0.19, 0.18, 0.095), brown)
  mesh('satchel-rounded-flap', satchel, rounded(0.20, 0.09, 0.025), brown, [0, 0.048, 0.055])
  mesh('satchel-brass-closure', satchel, oval([0.014, 0.014, 0.009], [0, 0.022, 0.075], 8, 6), gold)

  root.userData.joints = {
    body,
    head,
    armL: arms[0],
    armR: arms[1],
    legL: legs[0],
    legR: legs[1],
    earL: ears[0],
    earR: ears[1],
    tail
  }
  root.userData.headTop = new THREE.Vector3(0, 1.06, 0)
  root.userData.ownedMaterials = ownedMaterials
  root.userData.ownedTextures = []
  const amount = value => Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0
  root.userData.anim = (t, dt, { walk = 0, wave = 0, talk = 0, night = 0 } = {}) => {
    const time = Number.isFinite(t) ? t : 0
    const walking = amount(walk)
    const waving = amount(wave)
    const talking = amount(talk)
    const sleepy = amount(night)
    const stride = Math.sin(time * 8)
    const breath = Math.sin(time * 2.15)
    const sway = Math.sin(time * 3.2)
    body.position.y = 0.33 + breath * 0.0015 + walking * Math.abs(stride) * 0.006
    body.scale.y = 1 + breath * 0.005
    body.rotation.z = Math.sin(time * 1.1) * 0.004 + talking * sway * 0.007
    head.rotation.x = Math.sin(time * 1.4) * 0.008 + talking * Math.sin(time * 6) * 0.012 - sleepy * 0.012
    head.rotation.y = talking * Math.sin(time * 2.7) * 0.04
    head.rotation.z = talking * sway * 0.022
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? 1 : -1
      const swing = sign * stride * walking * 0.38
      const cosine = Math.cos(swing)
      const sine = Math.sin(swing)
      legs[i].rotation.x = swing
      legs[i].position.y = 0.127 * cosine + 0.025 * sine
        + Math.hypot(0.043 * cosine, 0.088 * sine)
        + Math.max(0, sign * stride) * walking * 0.025
      arms[i].rotation.x = -sign * stride * walking * 0.31
      arms[i].rotation.y = 0
      arms[i].rotation.z = sign * 0.24
      ears[i].rotation.z = sign * (Math.sin(time * 1.6) * 0.012 + Math.pow(Math.max(0, Math.sin(time * 0.9)), 28) * 0.035)
      ears[i].rotation.x = Math.sin(time * 1.3 + i) * 0.012
    }
    // 右手位於 -X，抬手時保留肩膀原本的位置。
    arms[1].rotation.z = -0.24 + waving * (-2.06 + Math.sin(time * 7) * 0.22)
    arms[1].rotation.x = arms[1].rotation.x * (1 - waving) - waving * 0.22
    tail.rotation.y = Math.sin(time * 1.65) * 0.10 + walking * stride * 0.055
    tail.rotation.z = Math.sin(time * 1.2) * 0.025
    satchel.rotation.z = walking * stride * 0.025
    const blinkPhase = ((time % 4.6) + 4.6) % 4.6
    const blink = Math.max(0, 1 - Math.abs(blinkPhase - 0.12) / 0.075)
    const eyeOpen = Math.max(0.055, (1 - blink * 0.95) * (1 - sleepy * 0.55))
    eyes.forEach(eye => { eye.scale.y = eyeOpen })
    eyeGlints.scale.y = eyeOpen
    eyeGlints.visible = eyeOpen > 0.15
  }
  return root
}
