import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export function buildOwl() {
  const root = new THREE.Group()
  root.name = 'Housuke'
  const ownedMaterials = []
  const material = (color, roughness = 0.86) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, flatShading: true })
    ownedMaterials.push(m)
    return m
  }
  const tan = material(0xd5a879)
  const cream = material(0xffefce)
  const amber = material(0xd78b38, 0.66)
  const blue = material(0x52758a, 0.8)
  const rim = material(0x765039, 0.48)
  const iris = material(0x493022, 0.25)
  const ink = material(0x160f0b, 0.2)
  const ivory = material(0xfffaf0, 0.35)
  const blush = material(0xe6a184, 0.93)
  const marking = material(0xc18b55, 0.88)
  const trim = material(0x8aafbd, 0.74)
  const sphere = new THREE.SphereGeometry(1, 12, 8)
  const tinySphere = new THREE.SphereGeometry(1, 10, 6)
  const pivot = (parent, name, x, y, z) => {
    const g = new THREE.Group()
    g.name = name
    g.position.set(x, y, z)
    parent.add(g)
    return g
  }
  const mesh = (parent, name, geometry, mat) => {
    const m = new THREE.Mesh(geometry, mat)
    m.name = name
    m.castShadow = true
    m.receiveShadow = true
    parent.add(m)
    return m
  }
  const ellipsoid = (x, y, z, sx, sy, sz, template = sphere) => {
    const g = template.clone()
    g.scale(sx, sy, sz)
    g.translate(x, y, z)
    return g
  }
  const feather = (length, width, depth, x, y, z, angle) => {
    const g = new THREE.SphereGeometry(1, 8, 6)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const u = (p.getY(i) + 1) / 2
      const taper = 1.25 - u * 0.5
      p.setXYZ(i, p.getX(i) * width * taper, u * length, p.getZ(i) * depth * taper)
    }
    g.rotateZ(angle)
    g.translate(x, y, z)
    g.computeVertexNormals()
    return g
  }
  const merge = geometries => {
    const g = mergeGeometries(geometries)
    geometries.forEach(item => item.dispose())
    return g
  }
  const body = pivot(root, 'body', 0, 0.24, 0)
  mesh(body, 'body-volume', ellipsoid(0, 0.025, 0, 0.245, 0.195, 0.19), tan)
  mesh(body, 'breast', ellipsoid(0, 0.025, 0.145, 0.192, 0.16, 0.058), cream)
  const chestMarks = [-1, 0, 1].map((x, i) => feather(0.055, 0.018, 0.006, x * 0.074, i === 1 ? 0.08 : 0.095, 0.196, Math.PI))
  for (const g of chestMarks) {
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const q = Math.pow(p.getX(i) / 0.192, 2) + Math.pow((p.getY(i) - 0.025) / 0.16, 2)
      p.setZ(i, p.getZ(i) - 0.196 + 0.145 + 0.058 * Math.sqrt(Math.max(0, 1 - q)) + 0.004)
    }
    g.computeVertexNormals()
  }
  mesh(body, 'breast-markings', merge(chestMarks), marking)
  const head = pivot(body, 'head', 0, 0.23, 0)
  const headGeometry = new THREE.SphereGeometry(1, 16, 12)
  const positions = headGeometry.attributes.position
  for (let i = 0; i < positions.count; i++) {
    const power = v => Math.sign(v) * Math.pow(Math.abs(v), 0.87)
    positions.setXYZ(i, power(positions.getX(i)) * 0.36, power(positions.getY(i)) * 0.255 + 0.175, power(positions.getZ(i)) * 0.25)
  }
  headGeometry.computeVertexNormals()
  mesh(head, 'head-volume', headGeometry, tan)
  const skullFront = (x, y) => {
    const q = Math.pow(Math.abs(x / 0.36), 2 / 0.87) + Math.pow(Math.abs((y - 0.175) / 0.255), 2 / 0.87)
    return 0.25 * Math.pow(Math.max(0, 1 - q), 0.87 / 2)
  }
  // 臉盤與鏡框沿頭部曲面貼合
  const faceDisks = [-1, 1].map(sign => {
    const g = new THREE.SphereGeometry(1, 20, 14)
    g.scale(0.158, 0.177, 0.022)
    g.translate(sign * 0.145, 0.17, 0)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + skullFront(p.getX(i), p.getY(i)) + 0.004)
    g.computeVertexNormals()
    return g
  })
  mesh(head, 'facial-disks', merge(faceDisks), cream)
  const eyes = [-1, 1].map(sign => {
    const eye = pivot(head, sign === 1 ? 'eye-left' : 'eye-right', sign * 0.145, 0.18, skullFront(sign * 0.145, 0.18) + 0.035)
    mesh(eye, sign === 1 ? 'iris-left' : 'iris-right', ellipsoid(0, 0, 0, 0.061, 0.075, 0.016, tinySphere), iris)
    mesh(eye, sign === 1 ? 'pupil-left' : 'pupil-right', ellipsoid(0, -0.003, 0.015, 0.034, 0.05, 0.008, tinySphere), ink)
    mesh(eye, sign === 1 ? 'catchlight-left' : 'catchlight-right', ellipsoid(-0.017, 0.03, 0.024, 0.014, 0.017, 0.005, tinySphere), ivory)
    return eye
  })
  const rings = [-1, 1].map(sign => {
    const g = new THREE.TorusGeometry(0.109, 0.008, 5, 28)
    g.scale(1, 1.06, 1)
    g.translate(sign * 0.145, 0.18, 0)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + skullFront(p.getX(i), p.getY(i)) + 0.05)
    g.computeVertexNormals()
    return g
  })
  const bridge = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.039, 0.19, 0.293), new THREE.Vector3(0, 0.224, 0.305), new THREE.Vector3(0.039, 0.19, 0.293))
  rings.push(new THREE.TubeGeometry(bridge, 8, 0.0075, 5, false))
  for (const sign of [-1, 1]) {
    const temple = new THREE.BoxGeometry(0.035, 0.015, 0.035)
    temple.translate(sign * 0.265, 0.18, skullFront(sign * 0.265, 0.18) + 0.035)
    rings.push(temple)
  }
  mesh(head, 'round-glasses', merge(rings), rim)
  const cheeks = [-1, 1].map(sign => {
    const g = ellipsoid(sign * 0.20, 0.074, 0, 0.047, 0.023, 0.006, tinySphere)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + skullFront(p.getX(i), p.getY(i)) + 0.028)
    g.computeVertexNormals()
    return g
  })
  mesh(head, 'cheek-blush', merge(cheeks), blush)
  const beak = new THREE.ConeGeometry(0.044, 0.075, 5)
  beak.rotateX(Math.PI / 2)
  beak.scale(1, 0.8, 1)
  beak.translate(0, 0.087, 0.281)
  mesh(head, 'upper-beak', beak, amber)
  const jaw = pivot(head, 'beak-hinge', 0, 0.068, 0.261)
  const lowerBeak = new THREE.ConeGeometry(0.026, 0.05, 5)
  lowerBeak.rotateX(2.5)
  lowerBeak.translate(0, -0.012, 0.018)
  mesh(jaw, 'lower-beak', lowerBeak, amber)
  const armL = pivot(body, 'armL', 0.215, 0.19, 0)
  const armR = pivot(body, 'armR', -0.215, 0.19, 0)
  for (const [arm, sign] of [[armL, 1], [armR, -1]]) {
    mesh(arm, sign === 1 ? 'wing-left' : 'wing-right', merge([
      feather(0.25, 0.065, 0.058, 0, 0.02, 0.02, Math.PI + sign * 0.25),
      feather(0.22, 0.056, 0.052, sign * 0.025, sign === 1 ? -0.035 : 0.005, -0.035, Math.PI + sign * 0.44),
      feather(0.18, 0.048, 0.046, sign * 0.035, sign === 1 ? -0.065 : 0.015, -0.07, Math.PI + sign * (sign === 1 ? 0.62 : 1.2)),
      ...(sign === 1 ? [feather(0.11, 0.044, 0.028, 0.085, -0.045, 0.145, Math.PI - 0.12)] : [])
    ]), tan)
  }
  const legL = pivot(body, 'legL', 0.095, -0.11, 0)
  const legR = pivot(body, 'legR', -0.095, -0.11, 0)
  for (const [leg, sign] of [[legL, 1], [legR, -1]]) {
    mesh(leg, sign === 1 ? 'foot-left' : 'foot-right', merge([
      ellipsoid(0, -0.052, 0, 0.038, 0.06, 0.038),
      ...[-1, 0, 1].map((x, i) => ellipsoid(x * 0.031, -0.103, 0.035 + (i === 1 ? 0.014 : 0), 0.026, 0.026, 0.056))
    ]), amber)
  }
  const earL = pivot(head, 'earL', 0.215, 0.345, 0)
  const earR = pivot(head, 'earR', -0.215, 0.345, 0)
  for (const [ear, sign] of [[earL, 1], [earR, -1]]) {
    mesh(ear, sign === 1 ? 'tuft-left' : 'tuft-right', merge([
      feather(0.16, 0.04, 0.035, 0, 0, 0, -sign * 0.45),
      feather(0.11, 0.035, 0.03, sign * 0.022, -0.006, 0.018, -sign * 0.8),
      feather(0.09, 0.028, 0.026, -sign * 0.012, -0.005, 0.02, sign * 0.04)
    ]), tan)
  }
  const book = pivot(armL, 'book', 0.045, -0.115, 0.125)
  const covers = [-1, 1].map(sign => {
    const g = new THREE.BoxGeometry(0.12, 0.19, 0.006)
    g.translate(0, 0, sign * 0.025)
    return g
  })
  const spine = new THREE.BoxGeometry(0.009, 0.19, 0.05)
  spine.translate(0.056, 0, 0)
  covers.push(spine)
  mesh(book, 'book-cover', merge(covers), blue)
  mesh(book, 'book-pages', new THREE.BoxGeometry(0.105, 0.175, 0.042), cream)
  const border = []
  for (const sign of [-1, 1]) {
    const a = new THREE.BoxGeometry(0.0025, 0.165, 0.002)
    a.translate(sign * 0.048, 0, 0.029)
    const b = new THREE.BoxGeometry(0.098, 0.0025, 0.002)
    b.translate(0, sign * 0.081, 0.029)
    border.push(a, b)
  }
  mesh(book, 'book-cover-border', merge(border), trim)
  root.userData.joints = { body, head, armL, armR, legL, legR, earL, earR, tail: null }
  root.userData.headTop = new THREE.Vector3(0, 1.05, 0)
  root.userData.ownedMaterials = ownedMaterials
  root.userData.ownedTextures = []
  const neutralState = {}
  const amount = value => THREE.MathUtils.clamp(Number(value) || 0, 0, 1)
  root.userData.anim = (t, dt, state = neutralState) => {
    const time = Number.isFinite(t) ? t : 0
    const walk = amount(state.walk)
    const wave = amount(state.wave)
    const talk = amount(state.talk)
    const phase = time * 8.5
    const stride = Math.sin(phase)
    const lift = Math.max(0, stride) * walk
    const breath = 1 + Math.sin(time * 2.1) * 0.003
    const sway = Math.sin(time * 2.5) * (0.003 + talk * 0.012)
    const pitch = -stride * walk * 0.012

    // 小跳步與呼吸從絕對時間計算，外層 root 由場景控制
    body.position.set(0, 0.24 + lift * 0.018 + Math.abs(sway) * 0.17 + Math.abs(pitch) * 0.13, 0)
    body.scale.set(1, breath, 1)
    body.rotation.set(pitch, 0, sway)
    head.rotation.set(Math.sin(time * 3.2) * talk * 0.018, Math.sin(time * 2.1) * talk * 0.025, Math.sin(time * 2.8) * talk * 0.045)
    legL.position.set(0.095, -0.11 + lift * 0.004, 0)
    legR.position.set(-0.095, -0.11 + lift * 0.004, 0)
    legL.rotation.set(stride * walk * 0.045, 0, 0)
    legR.rotation.set(stride * walk * 0.045, 0, 0)
    armL.rotation.set(-stride * walk * 0.04, 0, -stride * walk * 0.025)
    armR.rotation.set(stride * walk * 0.06 * (1 - wave), 0, wave * (-1.9 + Math.sin(time * 9) * 0.16) + stride * walk * 0.04 * (1 - wave))

    // 眼珠與高光一起壓扁，鏡框維持原形
    const blinkPhase = ((time % 4.7) + 4.7) % 4.7
    const blink = 1 - 0.94 * Math.max(0, 1 - Math.abs(blinkPhase - 4.12) / 0.11)
    eyes[0].scale.set(1, blink, 1)
    eyes[1].scale.set(1, blink, 1)
    const twitchPhase = ((time % 6.4) + 6.4) % 6.4
    const twitch = Math.exp(-(((twitchPhase - 5.65) * 7) ** 2)) * Math.sin(time * 31)
    earL.rotation.set(Math.sin(time * 2.2) * 0.012, 0, twitch * 0.07)
    earR.rotation.set(Math.sin(time * 2.5) * 0.012, 0, -twitch * 0.065)
    jaw.rotation.set(Math.max(0, Math.sin(time * 15)) * talk * 0.18, 0, 0)
  }
  sphere.dispose()
  tinySphere.dispose()
  return root
}
