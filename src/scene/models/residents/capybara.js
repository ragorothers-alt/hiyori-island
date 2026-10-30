import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// 圓角量體保留水豚寬鼻、低重心的剪影
function roundedVolume(width, height, depth, power = 0.72, segments = 16, rings = 10) {
  const geometry = new THREE.SphereGeometry(1, segments, rings)
  const positions = geometry.attributes.position
  const round = value => Math.sign(value) * Math.pow(Math.abs(value), power)
  for (let i = 0; i < positions.count; i++) {
    positions.setXYZ(i,
      round(positions.getX(i)) * width,
      round(positions.getY(i)) * height,
      round(positions.getZ(i)) * depth
    )
  }
  geometry.computeVertexNormals()
  return geometry
}

function combine(geometries) {
  geometries.forEach(geometry => geometry.deleteAttribute('uv'))
  const result = mergeGeometries(geometries)
  geometries.forEach(geometry => geometry.dispose())
  return result
}

function solidRibbon(points, thickness = 0.009) {
  const area = points.reduce((sum, [x, y], i) => {
    const next = points[(i + 1) % points.length]
    return sum + x * next[1] - next[0] * y
  }, 0)
  const ordered = area < 0 ? [...points].reverse() : points
  const positions = []
  for (const offset of [0, -thickness]) {
    ordered.forEach(([x, y, z]) => positions.push(x, y, z + offset))
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3, 6, 5, 4, 7, 6, 4,
    4, 5, 1, 4, 1, 0, 5, 6, 2, 5, 2, 1,
    6, 7, 3, 6, 3, 2, 7, 4, 0, 7, 0, 3])
  geometry.computeVertexNormals()
  return geometry
}

function stroke(points, radius = 0.005, segments = 8) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point))), segments, radius, 5, false)
}

export function buildCapybara() {
  const root = new THREE.Group()
  root.name = 'Yuzu'
  const ownedMaterials = []
  const material = (name, color, roughness = 0.9) => {
    const value = new THREE.MeshStandardMaterial({ name, color, roughness, metalness: 0 })
    ownedMaterials.push(value)
    return value
  }
  const fur = material('yuzu-fur', 0xce8c50, 0.86)
  const muzzleMaterial = material('yuzu-muzzle', 0x996849)
  const robe = material('yuzu-yukata', 0x8bb5cf, 0.96)
  const robeTrim = material('yuzu-yukata-trim', 0xb5d4e0, 0.96)
  const sashMaterial = material('yuzu-sash', 0x405a79, 0.96)
  const towelMaterial = material('yuzu-towel', 0xfff2de, 0.98)
  const citrusMaterial = material('yuzu-citrus', 0xf7bc36, 0.76)
  const dark = material('yuzu-face-lines', 0x4f3527, 0.86)
  const earMaterial = material('yuzu-inner-ear', 0xb0744a)
  const leafMaterial = material('yuzu-leaf', 0x6e853f)
  const mesh = (name, geometry, surface, parent, x = 0, y = 0, z = 0) => {
    const part = new THREE.Mesh(geometry, surface)
    part.name = name
    part.position.set(x, y, z)
    part.castShadow = true
    part.receiveShadow = true
    parent.add(part)
    return part
  }
  const pivot = (name, parent, x, y, z) => {
    const group = new THREE.Group()
    group.name = name
    group.position.set(x, y, z)
    parent.add(group)
    return group
  }

  const body = pivot('body', root, 0, 0.28, 0)
  const head = pivot('head', body, 0, 0.21, 0)
  mesh('head-volume', roundedVolume(0.305, 0.24, 0.235, 0.78, 20, 12), fur, head, 0, 0.175, 0)
  mesh('muzzle', roundedVolume(0.137, 0.125, 0.075, 0.48, 14, 10), muzzleMaterial, head, 0, 0.105, 0.234)
  const coatPoints = [
    [0, -0.125], [0.185, -0.125], [0.205, -0.105],
    [0.19, 0.055], [0.15, 0.17], [0, 0.17]
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const coat = new THREE.LatheGeometry(coatPoints, 16)
  coat.scale(1, 1, 0.76)
  mesh('yukata-coat', coat, robe, body)
  const collarPanels = [
    [[0.125, 0.17, 0.145], [0.083, 0.17, 0.15], [-0.046, 0.048, 0.163], [-0.006, 0.024, 0.168]],
    [[-0.083, 0.17, 0.153], [-0.125, 0.17, 0.148], [0.006, 0.024, 0.172], [0.046, 0.048, 0.168]]
  ]
  mesh('crossed-ivory-collar', combine(collarPanels.map(points => solidRibbon(points))), towelMaterial, body)
  const sash = new THREE.LatheGeometry([
    new THREE.Vector2(0.192, -0.034), new THREE.Vector2(0.202, -0.025),
    new THREE.Vector2(0.202, 0.025), new THREE.Vector2(0.192, 0.034)
  ], 16)
  sash.scale(1, 1, 0.775)
  mesh('waist-sash', sash, sashMaterial, body, 0, -0.018, 0)
  const knotParts = [
    roundedVolume(0.025, 0.025, 0.016, 0.6, 8, 6).translate(0, -0.018, 0.172),
    roundedVolume(0.04, 0.023, 0.014, 0.6, 8, 6).rotateZ(-0.18).translate(0.043, -0.018, 0.166),
    roundedVolume(0.04, 0.023, 0.014, 0.6, 8, 6).rotateZ(0.18).translate(-0.043, -0.018, 0.166),
    solidRibbon([[0.006, -0.024, 0.17], [0.032, -0.029, 0.17], [0.052, -0.085, 0.16], [0.019, -0.079, 0.16]]),
    solidRibbon([[-0.032, -0.029, 0.17], [-0.006, -0.024, 0.17], [-0.019, -0.079, 0.16], [-0.052, -0.085, 0.16]])
  ]
  // 合併同材質小配件，保留可辨認的腰帶結
  const knotGeometries = knotParts.map(geometry => geometry.toNonIndexed())
  knotParts.forEach(geometry => geometry.dispose())
  mesh('sash-bow', combine(knotGeometries), sashMaterial, body)

  const ears = []
  const arms = []
  const legs = []
  for (const side of [1, -1]) {
    const suffix = side === 1 ? 'L' : 'R'
    const ear = pivot(`ear${suffix}`, head, side * 0.235, 0.36, 0)
    mesh(`ear-${suffix}`, roundedVolume(0.052, 0.061, 0.034, 1, 12, 8), fur, ear, side * 0.009, 0.024, 0)
    mesh(`inner-ear-${suffix}`, roundedVolume(0.03, 0.039, 0.012, 1, 10, 6), earMaterial, ear, side * 0.009, 0.026, 0.027)
    ears.push(ear)
    const arm = pivot(`arm${suffix}`, body, side * 0.156, 0.135, 0)
    arm.rotation.z = side * 0.38
    mesh(`sleeve-${suffix}`, new THREE.CylinderGeometry(0.078, 0.083, 0.165, 12), robe, arm, 0, -0.063, 0)
    mesh(`sleeve-cuff-${suffix}`, new THREE.CylinderGeometry(0.084, 0.085, 0.027, 12), robeTrim, arm, 0, -0.137, 0)
    mesh(`paw-${suffix}`, roundedVolume(0.052, 0.063, 0.057, 0.9, 12, 8), fur, arm, 0, -0.16, 0.006)
    arms.push(arm)
    const leg = pivot(`leg${suffix}`, body, side * 0.101, -0.13, 0)
    mesh(`foot-${suffix}`, roundedVolume(0.067, 0.081, 0.083, 0.62, 12, 8), fur, leg, 0, -0.069, 0.014)
    legs.push(leg)
  }
  const tail = pivot('tail', body, 0, -0.022, -0.14)
  mesh('tail-knob', roundedVolume(0.05, 0.05, 0.049, 1, 10, 8), fur, tail, 0, 0, -0.02)
  mesh('towel-base', roundedVolume(0.16, 0.024, 0.112, 0.38, 12, 8), towelMaterial, head, 0, 0.438, 0)
  mesh('towel-fold', roundedVolume(0.145, 0.013, 0.101, 0.38, 12, 8), towelMaterial, head, 0.004, 0.462, 0.008)
  mesh('yuzu-fruit', roundedVolume(0.059, 0.049, 0.053, 0.92, 12, 8), citrusMaterial, head, 0.012, 0.504, 0)
  const leaf = solidRibbon([[-0.004, 0, 0], [0.037, 0.02, -0.014], [0.083, 0.002, 0.003], [0.037, -0.006, 0.021]], 0.006)
  mesh('yuzu-leaf', leaf, leafMaterial, head, 0.014, 0.548, 0)

  const eyePivots = []
  for (const side of [1, -1]) {
    const eye = pivot(side === 1 ? 'squintL' : 'squintR', head, side * 0.19, 0.233, 0)
    const points = [[-0.04, -0.012], [-0.02, 0.002], [0, 0.007], [0.02, 0.002], [0.04, -0.012]].map(([x, y]) => {
      const globalX = side * 0.19 + x
      const globalY = 0.233 + y
      const surface = 0.235 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(globalX) / 0.305, 2 / 0.78) - Math.pow(Math.abs(globalY - 0.175) / 0.24, 2 / 0.78)), 0.78 / 2)
      return [x, y, surface + 0.005]
    })
    mesh(side === 1 ? 'eye-line-L' : 'eye-line-R', stroke(points, 0.0055), dark, eye)
    eyePivots.push(eye)
  }
  const nostrils = [1, -1].map(side => roundedVolume(0.008, 0.016, 0.005, 1, 8, 6)
    .rotateZ(side * -0.55).translate(side * 0.075, 0.166, 0.307))
  mesh('nostrils', combine(nostrils), dark, head)
  mesh('muzzle-seam', combine([
    stroke([[0, 0.12, 0.311], [0, 0.08, 0.312], [0, 0.025, 0.308]], 0.0025),
    stroke([[-0.034, 0.022, 0.307], [-0.017, 0.017, 0.311], [0, 0.025, 0.308], [0.017, 0.017, 0.311], [0.034, 0.022, 0.307]], 0.0023)
  ]), muzzleMaterial, head)
  const waves = []
  for (const center of [-0.108, 0.108]) {
    for (const radius of [0.047, 0.032, 0.017]) {
      const points = Array.from({ length: 7 }, (_, i) => {
        const angle = i / 6 * Math.PI
        const x = center + Math.cos(angle) * radius
        return [x, -0.109 + Math.sin(angle) * radius, 0.76 * Math.sqrt(0.202 ** 2 - x ** 2) + 0.003]
      })
      waves.push(stroke(points, 0.0027, 6))
    }
  }
  mesh('yukata-wave-motifs', combine(waves), robeTrim, body)

  root.userData.joints = { body, head, armL: arms[0], armR: arms[1], legL: legs[0], legR: legs[1], earL: ears[0], earR: ears[1], tail }
  root.userData.headTop = new THREE.Vector3(0, 1.055, 0)
  root.userData.ownedMaterials = ownedMaterials
  root.userData.ownedTextures = []
  const parts = []
  root.traverse(part => {
    if (part.isMesh) parts.push(part)
  })
  root.userData.sculptRuntime = { parts, joints: root.userData.joints, sockets: { headTop: root.userData.headTop } }
  const amount = value => THREE.MathUtils.clamp(Number(value) || 0, 0, 1)
  root.userData.anim = (t, dt, state = {}) => {
    const time = Number.isFinite(t) ? t : 0
    const walk = amount(state.walk)
    const wave = amount(state.wave)
    const talk = amount(state.talk)
    const night = amount(state.night)
    const phase = time * 7.2
    const stride = Math.sin(phase)
    const breathe = Math.sin(time * (2.1 - night * 0.5)) * 0.004
    // 每幀從基準重設，保留外層角色的移動、旋轉與縮放
    body.position.set(0, 0.28 + Math.abs(stride) * walk * 0.009, 0)
    body.rotation.set(0, 0, stride * walk * 0.018)
    body.scale.set(1 + breathe, 1, 1 + breathe)
    head.position.set(0, 0.21 + Math.sin(time * 2.1) * 0.0015, 0)
    head.rotation.set(
      night * 0.028 + Math.sin(time * 2) * 0.007 + talk * Math.sin(time * 9.4) * 0.018,
      Math.sin(time * 0.8) * 0.016 + talk * Math.sin(time * 3.2) * 0.045,
      Math.sin(time * 1.2) * 0.009
    )
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1
      legs[i].position.set(side * 0.101, -0.13 + Math.max(0, stride * side) * walk * 0.02, 0)
      legs[i].rotation.set(stride * side * walk * 0.42, 0, 0)
      arms[i].position.set(side * 0.156, 0.135, 0)
      arms[i].rotation.set(-stride * side * walk * 0.28, 0, side * 0.38)
      const twitch = Math.pow(Math.max(0, Math.sin(time * 1.4 + i * 1.8)), 18)
      ears[i].rotation.set(twitch * 0.09, 0, side * twitch * 0.08)
    }
    const armR = arms[1]
    armR.position.x -= wave * 0.035
    armR.rotation.x *= 1 - wave
    armR.rotation.y = wave * (0.12 + Math.sin(time * 6.5) * 0.12)
    armR.rotation.z = THREE.MathUtils.lerp(-0.38, -2.12 + Math.sin(time * 7.2) * 0.18, wave)
    const blinkPhase = ((time % 4.8) + 4.8) % 4.8
    const blink = Math.max(0, 1 - Math.abs(blinkPhase - 4.52) / 0.105)
    eyePivots.forEach(eye => eye.scale.set(1, 1 - blink * 0.86 - night * 0.1, 1))
    tail.rotation.set(Math.sin(time * 2.1) * 0.07, Math.sin(time * 1.7) * 0.12, 0)
  }
  return root
}
