import * as THREE from 'three'

const TAU = Math.PI * 2
const PAGE_INTERVALS = [19, 22, 17, 24]

// 同材質在零件內合併，動畫樞紐保留獨立
function batch(parent, name, material) {
  const positions = []
  const normals = []
  const colors = []
  const pose = new THREE.Object3D()
  const normalMatrix = new THREE.Matrix3()
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  return {
    add(geometry, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], color = '#ffffff') {
      pose.position.fromArray(p)
      pose.scale.fromArray(s)
      pose.rotation.set(...r)
      pose.updateMatrix()
      normalMatrix.getNormalMatrix(pose.matrix)
      const tint = new THREE.Color(color)
      const source = geometry.index ? geometry.toNonIndexed() : geometry
      for (let i = 0; i < source.attributes.position.count; i++) {
        point.fromBufferAttribute(source.attributes.position, i).applyMatrix4(pose.matrix)
        normal.fromBufferAttribute(source.attributes.normal, i).applyMatrix3(normalMatrix).normalize()
        positions.push(point.x, point.y, point.z)
        normals.push(normal.x, normal.y, normal.z)
        colors.push(tint.r, tint.g, tint.b)
      }
      if (source !== geometry) source.dispose()
      geometry.dispose()
    },
    finish(cast = true) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = name
      mesh.castShadow = cast
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    },
  }
}

function box(b, x, y, z, w, h, d, color, r = [0, 0, 0]) {
  b.add(new THREE.BoxGeometry(w, h, d), [x, y, z], [1, 1, 1], r, color)
}

function beam(b, a, c, width, color, depth = width) {
  const start = new THREE.Vector3(...a)
  const end = new THREE.Vector3(...c)
  const delta = end.clone().sub(start)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize())
  const r = new THREE.Euler().setFromQuaternion(q)
  b.add(new THREE.BoxGeometry(width, delta.length(), depth), start.add(end).multiplyScalar(0.5).toArray(), [1, 1, 1], [r.x, r.y, r.z], color)
}

function rounded(w, h, d, r = 0.035) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  const a = Math.min(r, w / 3, h / 3)
  s.moveTo(x + a, y)
  s.lineTo(x + w - a, y)
  s.quadraticCurveTo(x + w, y, x + w, y + a)
  s.lineTo(x + w, y + h - a)
  s.quadraticCurveTo(x + w, y + h, x + w - a, y + h)
  s.lineTo(x + a, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - a)
  s.lineTo(x, y + a)
  s.quadraticCurveTo(x, y, x + a, y)
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 4 })
  g.translate(0, 0, -d / 2)
  return g
}

function tube(points, radius = 0.012, segments = 24) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), segments, radius, 5, false)
}

export function buildCabinRoom() {
  const group = new THREE.Group()
  group.name = 'mochi-cabin-room'
  const ownedMaterials = []
  const ownedTextures = []
  const material = (options = {}) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, ...options })
    ownedMaterials.push(m)
    return m
  }
  const wood = material()
  const cloth = material({ roughness: 0.98 })
  const paper = material({ roughness: 0.95 })
  const iron = material({ roughness: 0.72, metalness: 0.18 })
  const enamel = material({ roughness: 0.35, metalness: 0.06 })
  const leaf = material({ roughness: 0.88, side: THREE.DoubleSide })
  const makeGroup = (name, parent = group, position = [0, 0, 0]) => {
    const g = new THREE.Group()
    g.name = name
    g.position.fromArray(position)
    parent.add(g)
    return g
  }
  const floor = batch(group, 'floor', wood)
  floor.add(rounded(6.18, 4.18, 0.23, 0.13), [0, -0.135, 0], [1, 1, 1], [-Math.PI / 2, 0, 0], '#c8a17b')
  for (let i = 0; i < 18; i++) {
    const z = -1.99 + i * 0.233
    const c = ['#e4c49a', '#e9cba5', '#dfbd91', '#e7c79e'][i % 4]
    for (let j = 0; j < 3; j++) {
      const lo = Math.max(-3, -4 + j * 2.35 + (i % 2) * 0.8)
      const hi = Math.min(3, -4 + (j + 1) * 2.35 + (i % 2) * 0.8)
      if (hi > lo) box(floor, (lo + hi) / 2, -0.013, z, hi - lo - 0.008, 0.026, 0.226, c)
    }
  }
  floor.finish(false)
  const walls = batch(group, 'walls', wood)
  const log = (a, b, y, side, axis, color) => {
    if (b <= a) return
    walls.add(new THREE.CylinderGeometry(0.134, 0.134, b - a, 10), axis === 'x' ? [(a + b) / 2, y, side] : [side, y, (a + b) / 2], [1, 1, 1], axis === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0], color)
  }
  for (let i = 0; i < 11; i++) {
    const y = 0.13 + i * 0.235
    const c = ['#d8b184', '#e0ba8c', '#dcb587'][i % 3]
    if (y > 1.07 && y < 2.4) {
      log(-3.08, -2.08, y, -2, 'x', c)
      log(-0.32, 3.08, y, -2, 'x', c)
    } else log(-3.08, 3.08, y, -2, 'x', c)
    for (const side of [-1, 1]) log(-2.05, 1.97, y, side * 3.0, 'z', c)
  }
  box(walls, -1.2, 1.73, -2.065, 1.76, 1.42, 0.045, '#b9d6df')
  walls.finish(false)
  const roof = batch(group, 'roof', wood)
  const gable = new THREE.Shape()
  gable.moveTo(-3.12, 2.57)
  gable.lineTo(3.12, 2.57)
  gable.lineTo(0, 3.8)
  gable.closePath()
  roof.add(new THREE.ExtrudeGeometry(gable, { depth: 0.12, bevelEnabled: false }), [0, 0, -2.12], [1, 1, 1], [0, 0, 0], '#d8af80')
  // 前半屋頂留空，保留斜上方的視線
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const x = side * (i + 0.5) * 0.35
      box(roof, x, 3.8 - Math.abs(x) * 0.4, -1.72, 0.38, 0.075, 0.78, ['#d9b78b', '#e1c298'][i % 2], [0, 0, -side * Math.atan(0.4)])
    }
  }
  roof.finish()
  const desk = batch(group, 'study', wood)
  desk.add(rounded(2.8, 1.22, 0.105, 0.13), [0, 0.395, 0.5], [1, 1, 1], [-Math.PI / 2, 0, 0], '#d4a573')
  for (const x of [-1.11, 1.11]) {
    for (const z of [0.06, 0.94]) desk.add(new THREE.CylinderGeometry(0.09, 0.105, 0.34, 10), [x, 0.17, z], [1, 1, 1], [0, 0, 0], '#bd8c60')
  }
  desk.finish()
  const cushion = batch(group, 'cushion', cloth)
  cushion.add(new THREE.SphereGeometry(1, 32, 14), [0, 0.125, -0.94], [0.92, 0.125, 0.69], [0, 0, 0], '#acb18c')
  cushion.finish()
  // 木樑、窗框與家具結構
  const beams = batch(group, 'beams', wood)
  beam(beams, [0, 3.77, -2.08], [0, 3.77, 1.52], 0.15, '#e9cba1', 0.18)
  for (const z of [-1.88, -0.6]) {
    for (const side of [-1, 1]) beam(beams, [0, 3.78, z], [side * 3.09, 2.54, z], 0.13, '#edcfaa', 0.15)
  }
  for (const side of [-1, 1]) beam(beams, [side * 3.02, 2.61, -2.1], [side * 3.02, 2.61, 1.97], 0.15, '#ebcba0')
  beams.finish()
  const frame = batch(group, 'window-frame', wood)
  for (const x of [-2.1, -0.3]) box(frame, x, 1.72, -1.82, 0.09, 1.5, 0.19, '#f0d2a5')
  for (const y of [1.0, 2.44]) box(frame, -1.2, y, -1.8, 1.9, 0.09, 0.2, '#edc99a')
  box(frame, -1.2, 0.97, -1.69, 2.02, 0.08, 0.4, '#e9c89b')
  for (const x of [-1.65, -1.2, -0.75]) box(frame, x, 1.72, -1.775, 0.028, 1.38, 0.045, '#d4ab7d')
  for (const y of [1.47, 1.94]) box(frame, -1.2, y, -1.77, 1.73, 0.028, 0.05, '#d4ab7d')
  frame.finish()
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color('#9ac9e2') }, bottom: { value: new THREE.Color('#eef1d7') } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec2 vUv; void main(){gl_FragColor=vec4(mix(bottom,top,smoothstep(0.0,1.0,vUv.y)),1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  })
  ownedMaterials.push(skyMaterial)
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(1.76, 1.4), skyMaterial)
  sky.name = 'window-sky'
  sky.position.set(-1.2, 1.73, -1.94)
  group.add(sky)
  const shelf = batch(group, 'shelf', wood)
  box(shelf, 1.02, 1.84, -1.7, 1.84, 0.09, 0.38, '#c99f71')
  for (const x of [0.37, 1.68]) beam(shelf, [x, 1.55, -1.87], [x, 1.8, -1.55], 0.065, '#c29a70')
  shelf.finish()
  const clock = batch(group, 'clock', wood)
  clock.add(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 36), [1.12, 2.42, -1.8], [1, 1, 1], [Math.PI / 2, 0, 0], '#af8565')
  clock.add(new THREE.CylinderGeometry(0.281, 0.281, 0.015, 36), [1.12, 2.42, -1.748], [1, 1, 1], [Math.PI / 2, 0, 0], '#f0dfbb')
  clock.finish()
  const bookcase = batch(group, 'bookcase', wood)
  box(bookcase, -2.35, 0.59, -0.7, 0.92, 1.18, 0.085, '#b99270')
  for (const x of [-2.81, -1.89]) box(bookcase, x, 0.59, -0.4, 0.09, 1.18, 0.65, '#cfaa80')
  for (const y of [0.065, 0.59, 1.16]) box(bookcase, -2.35, y, -0.4, 1.01, 0.09, 0.72, '#dcba90')
  bookcase.finish()
  const rug = batch(group, 'rug', cloth)
  rug.add(new THREE.CylinderGeometry(1, 1, 0.045, 64), [0, 0.025, 0.25], [1.86, 1, 1.55], [0, 0, 0], '#ddc8a3')
  rug.finish(false)
  const stoveGroup = makeGroup('hearth', group, [2.19, 0, -0.95])
  const stove = batch(stoveGroup, 'stove', iron)
  box(stove, 0, 0.075, 0, 1.2, 0.15, 1.03, '#a19a92')
  for (const x of [-0.405, 0.405]) box(stove, x, 0.73, 0, 0.08, 0.78, 0.66, '#49484b')
  box(stove, 0, 0.73, -0.29, 0.88, 0.78, 0.08, '#49484b')
  box(stove, 0, 0.38, 0, 0.88, 0.08, 0.66, '#49484b')
  box(stove, 0, 1.16, 0, 1.01, 0.09, 0.79, '#575153')
  for (const x of [-0.32, 0.32]) {
    for (const z of [-0.24, 0.24]) beam(stove, [x, 0.4, z], [x * 1.15, 0.15, z * 1.2], 0.085, '#49464a')
  }
  box(stove, 0, 0.48, 0.354, 0.75, 0.06, 0.055, '#76655b')
  stove.finish()
  const pipe = batch(stoveGroup, 'pipe', iron)
  pipe.add(new THREE.CylinderGeometry(0.095, 0.095, 1.71, 16), [0.21, 2.02, -0.15], [1, 1, 1], [0, 0, 0], '#48474d')
  for (const y of [1.35, 2.16, 2.82]) pipe.add(new THREE.CylinderGeometry(0.111, 0.111, 0.055, 16), [0.21, y, -0.15], [1, 1, 1], [0, 0, 0], '#60575b')
  pipe.finish()
  // 布簾由上緣吊掛，保留柔軟的折痕
  const curtains = []
  const curtainGroup = makeGroup('curtains')
  for (const side of [-1, 1]) {
    const pivot = makeGroup(`curtain-${side}`, curtainGroup, [-1.2 + side * 0.92, 2.49, -1.64])
    const g = new THREE.PlaneGeometry(0.4, 1.54, 16, 20)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / 0.4 + 0.5
      const v = 0.5 - p.getY(i) / 1.54
      const tie = Math.exp(-(((v - 0.67) / 0.18) ** 2))
      p.setXYZ(i, (u - 0.5) * (0.44 - tie * 0.19) + side * tie * 0.06, -v * 1.54, Math.sin(u * TAU * 4) * 0.028 + Math.sin(v * 3.6) * 0.025)
    }
    g.computeVertexNormals()
    const b = batch(pivot, `curtain-cloth-${side}`, leaf)
    b.add(g, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#eee2cb')
    b.finish(false)
    const band = batch(pivot, `curtain-tie-${side}`, cloth)
    box(band, side * 0.05, -1.03, 0.045, 0.25, 0.055, 0.055, '#d8bd94', [0, 0, side * 0.12])
    band.finish(false)
    curtains.push(pivot)
  }
  const rod = batch(group, 'curtain-rod', wood)
  beam(rod, [-2.42, 2.5, -1.64], [0.02, 2.5, -1.64], 0.035, '#b78d68')
  for (const x of [-2.42, 0.02]) rod.add(new THREE.SphereGeometry(0.057, 10, 7), [x, 2.5, -1.64], [1, 1, 1], [0, 0, 0], '#bf966e')
  rod.finish()
  const bookColors = ['#b9bfa5', '#d1ac98', '#dbc79f', '#91a9ac', '#d8cbb2', '#bd9b91']
  const books = (parent, name, points) => {
    const b = batch(parent, name, paper)
    points.forEach(([x, y, z, w, h], i) => {
      box(b, x, y + h / 2, z, w, h, 0.23, bookColors[i % bookColors.length])
      box(b, x, y + h * 0.8, z + 0.119, w * 0.7, 0.009, 0.006, '#efe2c5')
      box(b, x, y + h * 0.18, z + 0.119, w * 0.7, 0.008, 0.006, '#e8d5b6')
    })
    b.finish()
  }
  books(group, 'case-books', Array.from({ length: 13 }, (_, i) => [-2.72 + (i % 7) * 0.116, i < 7 ? 0.11 : 0.64, -0.19, 0.092, 0.32 + (i % 3) * 0.055]))
  books(group, 'shelf-books', Array.from({ length: 6 }, (_, i) => [0.3 + i * 0.105, 1.89, -1.65, 0.083, 0.29 + (i % 3) * 0.025]))
  const jars = batch(group, 'shelf-jars', enamel)
  for (let i = 0; i < 3; i++) {
    const h = 0.22 + (i % 2) * 0.09
    jars.add(new THREE.LatheGeometry([[0, 0], [0.09, 0], [0.095, h * 0.7], [0.065, h], [0, h]].map(p => new THREE.Vector2(...p)), 16), [1.08 + i * 0.25, 1.89, -1.64], [1, 1, 1], [0, 0, 0], ['#9da58b', '#e6caa1', '#cdb9a3'][i])
    jars.add(new THREE.CylinderGeometry(0.073, 0.073, 0.028, 16), [1.08 + i * 0.25, 1.89 + h, -1.64], [1, 1, 1], [0, 0, 0], '#b29a7c')
  }
  jars.finish()
  const plant = batch(group, 'plant', leaf)
  const plantX = -2.33
  const plantZ = 0.91
  plant.add(new THREE.LatheGeometry([[0, 0], [0.19, 0], [0.25, 0.37], [0.265, 0.39], [0.265, 0.43], [0.23, 0.43], [0.22, 0.38], [0, 0.38]].map(p => new THREE.Vector2(...p)), 20), [plantX, 0, plantZ], [1, 1, 1], [0, 0, 0], '#c7927c')
  plant.add(new THREE.CylinderGeometry(0.225, 0.225, 0.01, 20), [plantX, 0.385, plantZ], [1, 1, 1], [0, 0, 0], '#7d705c')
  for (let i = 0; i < 8; i++) {
    const a = i * 2.399
    const h = 0.71 + (i % 3) * 0.16
    const end = [plantX + Math.sin(a) * 0.31, h, plantZ + Math.cos(a) * 0.31]
    plant.add(tube([[plantX, 0.39, plantZ], [plantX + Math.sin(a) * 0.08, h * 0.88, plantZ + Math.cos(a) * 0.08], end], 0.012, 8), [0, 0, 0], [1, 1, 1], [0, 0, 0], '#83936a')
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    shape.bezierCurveTo(-0.23, 0.12, -0.2, 0.39, 0, 0.46)
    shape.bezierCurveTo(0.2, 0.39, 0.23, 0.12, 0, 0)
    const g = new THREE.ShapeGeometry(shape, 7)
    const p = g.attributes.position
    for (let j = 0; j < p.count; j++) p.setZ(j, 0.06 * Math.sin(p.getY(j) / 0.46 * Math.PI) - Math.abs(p.getX(j)) * 0.2)
    g.computeVertexNormals()
    plant.add(g, end, [1, 1, 1], [-0.55, a, 0.2 * Math.sin(i)], i % 2 ? '#9aad7b' : '#7f996d')
  }
  plant.finish()
  const book = batch(group, 'open-book', paper)
  for (const side of [-1, 1]) {
    book.add(rounded(0.43, 0.55, 0.025, 0.015), [-0.34 + side * 0.215, 0.478, 0.44], [1, 1, 1], [-Math.PI / 2, side * 0.07, 0], '#a77e66')
    for (let i = 0; i < 4; i++) {
      box(book, -0.34 + side * 0.209, 0.5 + i * 0.008, 0.44, 0.405, 0.007, 0.521, i % 2 ? '#f2e7cd' : '#e9dbb9', [0, 0, side * 0.06])
    }
  }
  book.finish()
  const pagePivot = makeGroup('page-hinge', group, [-0.34, 0.54, 0.44])
  const page = batch(pagePivot, 'turning-page', leaf)
  const pageGeometry = new THREE.PlaneGeometry(0.4, 0.52, 12, 1)
  pageGeometry.rotateX(-Math.PI / 2)
  pageGeometry.translate(0.2, 0, 0)
  const pagePositions = pageGeometry.attributes.position
  for (let i = 0; i < pagePositions.count; i++) pagePositions.setY(i, Math.sin(pagePositions.getX(i) / 0.4 * Math.PI) * 0.028)
  pageGeometry.computeVertexNormals()
  page.add(pageGeometry, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#f8edd7')
  page.finish(false)
  const notebook = batch(group, 'notebook', paper)
  notebook.add(rounded(0.46, 0.56, 0.018, 0.02), [0.44, 0.476, 0.61], [1, 1, 1], [-Math.PI / 2, 0, -0.1], '#acb2a0')
  box(notebook, 0.44, 0.496, 0.61, 0.42, 0.025, 0.52, '#eee1c5', [0, 0.1, 0])
  beam(notebook, [0.29, 0.526, 0.42], [0.61, 0.526, 0.65], 0.023, '#c59b67')
  notebook.add(new THREE.ConeGeometry(0.018, 0.06, 6), [0.634, 0.526, 0.668], [1, 1, 1], [Math.PI / 2, 0, -0.95], '#786853')
  notebook.finish()
  const practical = material({ emissive: '#ffd59a', emissiveIntensity: 0.35, roughness: 0.55 })
  const lamp = batch(group, 'lamp', enamel)
  lamp.add(new THREE.CylinderGeometry(0.18, 0.19, 0.055, 24), [-1.06, 0.485, 0.51], [1, 1, 1], [0, 0, 0], '#c9a269')
  lamp.add(new THREE.CylinderGeometry(0.022, 0.025, 0.4, 12), [-1.06, 0.71, 0.51], [1, 1, 1], [0, 0, 0], '#c6a06b')
  lamp.add(new THREE.LatheGeometry([[0.225, 0], [0.22, 0.05], [0.16, 0.16], [0.07, 0.205], [0, 0.21]].map(p => new THREE.Vector2(...p)), 24), [-1.06, 0.9, 0.51], [1, 1, 1], [0, 0, 0], '#e8cca0')
  lamp.finish()
  const bulb = batch(group, 'lamp-bulb', practical)
  bulb.add(new THREE.SphereGeometry(0.065, 16, 10), [-1.06, 0.902, 0.51], [1, 0.7, 1], [0, 0, 0], '#ffe0a8')
  bulb.finish(false)
  const tea = batch(group, 'tea', enamel)
  tea.add(new THREE.CylinderGeometry(0.17, 0.17, 0.025, 24), [0.95, 0.475, 0.31], [1, 1, 1], [0, 0, 0], '#b98c65')
  tea.add(new THREE.LatheGeometry([[0, 0], [0.09, 0], [0.12, 0.19], [0.105, 0.2], [0.092, 0.18], [0.075, 0.035], [0, 0.035]].map(p => new THREE.Vector2(...p)), 24), [0.95, 0.49, 0.31], [1, 1, 1], [0, 0, 0], '#ead5b4')
  tea.add(new THREE.TorusGeometry(0.064, 0.017, 6, 16), [1.085, 0.602, 0.31], [1, 1, 1], [0, 0, 0], '#ead5b4')
  tea.add(new THREE.CylinderGeometry(0.097, 0.097, 0.006, 24), [0.95, 0.66, 0.31], [1, 1, 1], [0, 0, 0], '#96744c')
  tea.finish()
  const timerPivot = makeGroup('timer-pivot', group, [1.04, 0.46, 0.87])
  const timer = batch(timerPivot, 'timer', enamel)
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU
    timer.add(new THREE.SphereGeometry(1, 12, 8), [Math.cos(a) * 0.025, 0.105, Math.sin(a) * 0.025], [0.105, 0.103, 0.105], [0, 0, 0], '#c87868')
  }
  timer.add(new THREE.TorusGeometry(0.122, 0.007, 5, 24), [0, 0.09, 0], [1, 1, 1], [Math.PI / 2, 0, 0], '#975e52')
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU
    timer.add(new THREE.SphereGeometry(1, 6, 4), [Math.cos(a) * 0.035, 0.207, Math.sin(a) * 0.035], [0.055, 0.009, 0.022], [0, -a, 0], '#82906a')
  }
  box(timer, 0, 0.228, 0, 0.016, 0.044, 0.018, '#7e8c62', [0, 0, -0.25])
  timer.finish()
  const kettle = batch(stoveGroup, 'kettle', enamel)
  kettle.add(new THREE.LatheGeometry([[0, 0], [0.16, 0], [0.205, 0.08], [0.18, 0.23], [0.105, 0.28], [0, 0.28]].map(p => new THREE.Vector2(...p)), 24), [-0.08, 1.205, 0.02], [1, 1, 1], [0, 0, 0], '#9aa57d')
  kettle.add(tube([[-0.22, 1.29, 0.02], [-0.34, 1.34, 0.02], [-0.38, 1.44, 0.02]], 0.045, 10), [0, 0, 0], [1, 1, 1], [0, 0, 0], '#9aa57d')
  kettle.add(new THREE.CylinderGeometry(0.12, 0.13, 0.025, 20), [-0.08, 1.49, 0.02], [1, 1, 1], [0, 0, 0], '#8c9873')
  kettle.add(new THREE.SphereGeometry(0.036, 12, 8), [-0.08, 1.531, 0.02], [1, 0.7, 1], [0, 0, 0], '#a78864')
  kettle.add(new THREE.TorusGeometry(0.19, 0.021, 6, 24, Math.PI), [-0.08, 1.43, 0.02], [1, 1, 1], [0, 0, 0], '#b2946d')
  kettle.finish()
  const firewood = batch(group, 'firewood', wood)
  for (let i = 0; i < 6; i++) {
    const x = 2.5 + (i % 2) * 0.23
    const y = 0.12 + Math.floor(i / 2) * 0.19
    firewood.add(new THREE.CylinderGeometry(0.105, 0.11, 0.53, 9), [x, y, 0.38], [1, 1, 1], [Math.PI / 2, 0, 0], '#a58160')
    firewood.add(new THREE.CircleGeometry(0.087, 12), [x, y, 0.65], [1, 1, 1], [0, 0, 0], '#dfbc8b')
  }
  firewood.finish()
  const fireTrim = batch(stoveGroup, 'stove-door', iron)
  for (const x of [-0.335, 0.335]) box(fireTrim, x, 0.76, 0.35, 0.07, 0.53, 0.05, '#76645a')
  fireTrim.add(new THREE.TorusGeometry(0.3, 0.035, 6, 24, Math.PI), [0, 0.9, 0.35], [1, 0.6, 1], [0, 0, 0], '#76645a')
  box(fireTrim, 0, 0.98, 0.35, 0.85, 0.2, 0.035, '#4e494b')
  box(fireTrim, 0.38, 0.72, 0.395, 0.035, 0.16, 0.04, '#b59b79')
  for (const x of [-0.2, -0.1, 0, 0.1, 0.2]) box(fireTrim, x, 0.54, 0.37, 0.014, 0.16, 0.025, '#4f4542')
  fireTrim.finish()
  // 小面積暖色自發光，夜間仍保留明暗層次
  const fireMaterial = material({ color: '#171108', emissive: '#f6a04b', emissiveIntensity: 0.72, roughness: 0.9 })
  const fire = batch(stoveGroup, 'fire', fireMaterial)
  for (let i = 0; i < 5; i++) {
    const shape = new THREE.Shape()
    shape.moveTo(-0.058, 0)
    shape.bezierCurveTo(-0.11, 0.12, 0.03, 0.15, 0.01, 0.31)
    shape.bezierCurveTo(0.13, 0.19, 0.12, 0.06, 0.058, 0)
    shape.closePath()
    fire.add(new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: false, curveSegments: 6 }), [-0.2 + i * 0.1, 0.51, 0.25 + (i % 2) * 0.012], [0.8, 0.8 + (i % 3) * 0.23, 1], [0, 0, (i - 2) * 0.09], i % 2 ? '#ed9c4d' : '#f6cb70')
  }
  const fireMesh = fire.finish(false)
  const embers = batch(stoveGroup, 'ember-logs', wood)
  for (const side of [-1, 1]) beam(embers, [-0.24, 0.48, side * 0.05], [0.23, 0.48, -side * 0.06], 0.07, '#8d5642')
  embers.finish()
  const wire = batch(group, 'fairy-wire', iron)
  const wirePoints = [[-2.72, 2.63, -0.86], [-2.08, 2.7, -0.86], [-1.35, 2.99, -0.86], [0, 3.33, -0.86], [1.35, 2.99, -0.86], [2.08, 2.7, -0.86], [2.72, 2.63, -0.86]]
  wire.add(tube(wirePoints, 0.009, 50), [0, 0, 0], [1, 1, 1], [0, 0, 0], '#837360')
  const fairy = batch(group, 'fairy-bulbs', practical)
  for (let i = 0; i < 13; i++) {
    const x = -2.55 + i * 0.425
    const y = 3.31 - Math.abs(x) * 0.265
    beam(wire, [x, y, -0.86], [x, y - 0.13, -0.86], 0.014, '#837360')
    fairy.add(new THREE.SphereGeometry(0.038, 10, 7), [x, y - 0.155, -0.86], [1, 1.2, 1], [0, 0, 0], '#f5d09b')
  }
  wire.finish(false)
  fairy.finish(false)
  const cloudMaterial = new THREE.MeshBasicMaterial({ color: '#f5f3e8', transparent: true, depthWrite: false })
  ownedMaterials.push(cloudMaterial)
  const clouds = []
  for (let i = 0; i < 3; i++) {
    const pivot = makeGroup(`cloud-${i}`, group, [-1.71 + i * 0.51, 1.37 + (i % 2) * 0.59, -1.908])
    const cloud = batch(pivot, `cloud-puffs-${i}`, cloudMaterial)
    for (let j = 0; j < 3; j++) cloud.add(new THREE.SphereGeometry(1, 12, 8), [(j - 1) * 0.075, j === 1 ? 0.033 : 0, 0], [0.095, j === 1 ? 0.068 : 0.041, 0.012], [0, 0, 0], '#ffffff')
    const mesh = cloud.finish(false)
    mesh.renderOrder = 1
    clouds.push(pivot)
  }
  const stars = []
  for (let k = 0; k < 3; k++) {
    const m = new THREE.MeshBasicMaterial({ color: '#f3deb0', transparent: true, depthWrite: false })
    ownedMaterials.push(m)
    stars.push(m)
    const star = batch(group, `stars-${k}`, m)
    for (let i = 0; i < 4; i++) star.add(new THREE.SphereGeometry(0.012, 6, 4), [-1.94 + ((i * 0.39 + k * 0.23) % 1.45), 1.19 + ((i * 0.31 + k * 0.17) % 1.13), -1.9], [1, 1.2, 0.25], [0, 0, 0], '#ffffff')
    star.finish(false).renderOrder = 2
  }
  const moonMaterial = new THREE.MeshBasicMaterial({ color: '#ead9b5', transparent: true, depthWrite: false })
  ownedMaterials.push(moonMaterial)
  const moonShape = new THREE.Shape()
  moonShape.moveTo(0.045, 0.13)
  moonShape.bezierCurveTo(-0.15, 0.13, -0.16, -0.14, 0.045, -0.13)
  moonShape.bezierCurveTo(-0.035, -0.075, -0.035, 0.075, 0.045, 0.13)
  const moon = new THREE.Mesh(new THREE.ShapeGeometry(moonShape, 20), moonMaterial)
  moon.name = 'window-moon'
  moon.position.set(-1.75, 2.05, -1.89)
  moon.renderOrder = 2
  group.add(moon)
  // 切面年輪、編織與紙張線條以幾何表現
  const endgrain = batch(group, 'endgrain', wood)
  for (let i = 0; i < 11; i++) {
    for (const x of [-3, 3]) {
      for (const r of [0.047, 0.087, 0.115]) endgrain.add(new THREE.TorusGeometry(r, 0.0026, 3, 16), [x, 0.13 + i * 0.235, 1.976], [1, 0.95, 1], [0, 0, i * 0.7], '#bd966b')
    }
  }
  endgrain.finish(false)
  const grain = batch(group, 'timber-grain', wood)
  for (let i = 0; i < 11; i++) {
    const y = 0.14 + i * 0.235
    for (let j = 0; j < 6; j++) {
      const x = -2.78 + j * 0.95
      if (y > 1.03 && y < 2.43 && x > -2.4 && x < -0.25) continue
      box(grain, x, y + Math.sin(i * 4 + j) * 0.037, -1.863, 0.2 + (j % 3) * 0.14, 0.004, 0.004, '#c8a173')
    }
  }
  for (let i = 0; i < 48; i++) {
    const x = -2.8 + ((i * 1.71) % 5.6)
    const z = -1.9 + ((i * 0.73) % 3.8)
    box(grain, x, 0.001, z, 0.12 + (i % 4) * 0.07, 0.002, 0.003, '#d1ad81')
  }
  grain.finish(false)
  const weave = batch(group, 'rug-weave', cloth)
  for (let i = 0; i < 23; i++) {
    const r = 0.15 + i * 0.075
    const g = new THREE.TorusGeometry(r, 0.015, 3, 72)
    const p = g.attributes.position
    for (let j = 0; j < p.count; j++) {
      const a = Math.atan2(p.getY(j), p.getX(j))
      p.setZ(j, p.getZ(j) + Math.sin(a * 70 + i * Math.PI) * 0.004)
    }
    g.computeVertexNormals()
    weave.add(g, [0, 0.069, 0.25], [1, 0.833, 1], [-Math.PI / 2, 0, 0], i % 2 ? '#e5d1af' : '#cfb78e')
  }
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * TAU
    weave.add(new THREE.SphereGeometry(1, 5, 3), [Math.cos(a) * 1.8, 0.062, 0.25 + Math.sin(a) * 1.5], [0.026, 0.016, 0.035], [0, -a, 0], '#e7d3af')
  }
  weave.finish(false)
  const welt = batch(group, 'cushion-welt', cloth)
  welt.add(new THREE.TorusGeometry(0.9, 0.012, 5, 64), [0, 0.13, -0.94], [1, 0.748, 1], [-Math.PI / 2, 0, 0], '#c1c5a1')
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU
    welt.add(new THREE.SphereGeometry(0.017, 8, 5), [Math.cos(a) * 0.58, 0.217, -0.94 + Math.sin(a) * 0.4], [1, 0.3, 1], [0, 0, 0], '#929f7c')
  }
  welt.finish(false)
  const marks = batch(group, 'page-ink', paper)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      box(marks, -0.34 + side * 0.215, 0.549, 0.25 + i * 0.056, i % 3 === 2 ? 0.2 : 0.29, 0.002, 0.004, '#c6bca4', [0, 0, side * 0.045])
    }
  }
  for (let i = 0; i < 7; i++) box(marks, 0.44, 0.511, 0.39 + i * 0.064, 0.32, 0.002, 0.002, '#c9c9b7', [0, 0.1, 0])
  marks.finish(false)
  const coil = batch(group, 'notebook-coil', iron)
  for (let i = 0; i < 8; i++) coil.add(new THREE.TorusGeometry(0.018, 0.004, 4, 8), [0.225, 0.51, 0.4 + i * 0.06], [1, 1, 1], [Math.PI / 2, 0, 0], '#a59b83')
  coil.finish(false)
  const clockInk = batch(group, 'clock-hands', iron)
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU
    box(clockInk, 1.12 + Math.sin(a) * 0.242, 2.42 + Math.cos(a) * 0.242, -1.735, 0.009, i % 3 ? 0.025 : 0.038, 0.006, '#796e5c', [0, 0, -a])
  }
  beam(clockInk, [1.12, 2.42, -1.729], [0.97, 2.51, -1.729], 0.014, '#75654f', 0.008)
  beam(clockInk, [1.12, 2.42, -1.725], [1.25, 2.26, -1.725], 0.01, '#75654f', 0.008)
  clockInk.add(new THREE.SphereGeometry(0.023, 10, 6), [1.12, 2.42, -1.718], [1, 1, 0.3], [0, 0, 0], '#9d8262')
  clockInk.finish(false)
  const timerTicks = batch(timerPivot, 'timer-ticks', paper)
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * TAU
    box(timerTicks, Math.sin(a) * 0.124, 0.059, Math.cos(a) * 0.124, 0.004, i % 5 ? 0.012 : 0.023, 0.004, '#f0d5b5', [0, a, 0])
  }
  timerTicks.finish(false)
  const tileEdge = batch(group, 'roof-cut-trim', wood)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const x = side * (i + 0.5) * 0.35
      box(tileEdge, x, 3.87 - Math.abs(x) * 0.4, -2.03, 0.36, 0.055, 0.24, ['#bb7e86', '#c58b8b', '#b77c81'][i % 3], [0, 0, -side * Math.atan(0.4)])
    }
  }
  tileEdge.finish()
  const hemi = new THREE.HemisphereLight('#fff0d9', '#a396a3', 2.15)
  hemi.name = 'room-fill'
  group.add(hemi)
  const sun = new THREE.DirectionalLight('#fff0d7', 1.15)
  sun.name = 'window-key'
  sun.position.set(-1.8, 5.6, -4)
  sun.target.position.set(0, 0.3, -0.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 0.5, far: 16 })
  sun.shadow.normalBias = 0.035
  sun.shadow.bias = -0.0003
  group.add(sun, sun.target)
  const lampLight = new THREE.PointLight('#ffce92', 0.18, 4.5, 2)
  lampLight.name = 'desk-lamp-light'
  lampLight.position.set(-1.06, 0.88, 0.51)
  group.add(lampLight)
  const fireLight = new THREE.PointLight('#ffb477', 0.65, 4.5, 2)
  fireLight.name = 'hearth-light'
  fireLight.position.set(2.19, 0.77, -0.51)
  group.add(fireLight)
  const dayTop = new THREE.Color('#9ac9e2')
  const dayBottom = new THREE.Color('#eef1d7')
  const nightTop = new THREE.Color('#152440')
  const nightBottom = new THREE.Color('#3a4b6c')
  const fillDay = new THREE.Color('#fff0d9')
  const fillNight = new THREE.Color('#e6d9ca')
  const steam = []
  const steamGeometry = new THREE.SphereGeometry(1, 14, 10)
  for (let i = 0; i < 3; i++) {
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { opacity: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){vec4 p=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=-p.xyz; gl_Position=projectionMatrix*p;}',
      fragmentShader: 'uniform float opacity; varying vec3 vN; varying vec3 vV; void main(){float edge=max(0.0,dot(normalize(vN),normalize(vV))); gl_FragColor=vec4(vec3(0.92,0.9,0.84),opacity*pow(edge,1.9));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    })
    ownedMaterials.push(m)
    const puff = new THREE.Mesh(steamGeometry, m)
    puff.name = `tea-steam-${i}`
    puff.position.set(0.95, 0.7, 0.31)
    puff.scale.set(0.025, 0.055, 0.025)
    puff.renderOrder = 4
    group.add(puff)
    steam.push(puff)
  }
  group.userData.seat = { position: new THREE.Vector3(0, 0.25, -0.94), facing: 0 }
  group.userData.view = { target: new THREE.Vector3(0, 1.55, 0), dir: new THREE.Vector3(0.035, 0.36, 1).normalize(), radius: 3.6 }
  group.userData.background = { day: '#f4eadc', night: '#292d46' }
  group.userData.anim = (t, dt, state = {}) => {
    const time = Number.isFinite(t) ? Math.max(0, t) : 0
    const n = THREE.MathUtils.clamp(Number.isFinite(state.night) ? state.night : 0, 0, 1)
    hemi.intensity = 2.15 - n * 1.05
    hemi.color.copy(fillDay).lerp(fillNight, n)
    sun.intensity = 1.15 - n * 1.02
    skyMaterial.uniforms.top.value.copy(state.skyTop?.isColor ? state.skyTop : dayTop).lerp(nightTop, n)
    skyMaterial.uniforms.bottom.value.copy(state.skyBottom?.isColor ? state.skyBottom : dayBottom).lerp(nightBottom, n)
    practical.emissiveIntensity = 0.35 + n * 0.8
    lampLight.intensity = 0.18 + n * 0.97
    const flicker = 1 + 0.045 * Math.sin(time * 3.7) + 0.025 * Math.sin(time * 7.1 + 0.6)
    fireLight.intensity = (0.5 + n * 0.55) * flicker
    fireMaterial.emissiveIntensity = (0.67 + n * 0.1) * flicker
    fireMesh.scale.y = 1 + Math.sin(time * 2.9) * 0.025
    cloudMaterial.opacity = 0.86 * (1 - n)
    stars.forEach((m, i) => { m.opacity = n * (0.55 + 0.2 * Math.sin(time * 0.65 + i * 2)) })
    moonMaterial.opacity = n * 0.85
    for (let i = 0; i < clouds.length; i++) clouds[i].position.x = -1.71 + i * 0.51 + Math.sin(time * 0.07 + i * 2) * 0.1
    for (let i = 0; i < curtains.length; i++) curtains[i].rotation.z = Math.sin(time * 0.6 + i * 1.5) * 0.012
    for (let i = 0; i < steam.length; i++) {
      const phase = (time * 0.22 + i / 3) % 1
      const puff = steam[i]
      puff.position.set(0.95 + Math.sin(time * 0.6 + i) * phase * 0.045, 0.69 + phase * 0.54, 0.31 - phase * 0.025)
      const size = 0.023 + phase * 0.039
      puff.scale.set(size, size * 2.1, size)
      puff.material.uniforms.opacity.value = Math.sin(phase * Math.PI) * (0.17 + n * 0.045)
    }
    // 19、22、17、24 秒交替，每次只翻一張
    let elapsed = time % 82
    let interval = 19
    for (const length of PAGE_INTERVALS) {
      interval = length
      if (elapsed < length) break
      elapsed -= length
    }
    const flip = THREE.MathUtils.clamp((elapsed - interval + 1.8) / 1.8, 0, 1)
    pagePivot.visible = flip > 0 && flip < 1
    pagePivot.rotation.z = (flip * flip * (3 - 2 * flip)) * Math.PI
    const timerPhase = time % 28
    const timerEnvelope = timerPhase > 23 && timerPhase < 24.8 ? Math.sin((timerPhase - 23) / 1.8 * Math.PI) ** 2 : 0
    timerPivot.rotation.z = Math.sin(time * 8) * timerEnvelope * 0.035
  }
  const nodes = {}
  const meshes = {}
  group.traverse(object => {
    if (object.name) nodes[object.name] = object
    if (object.isMesh) meshes[object.name] = object
  })
  const seatSocket = new THREE.Object3D()
  seatSocket.name = 'seat-socket'
  seatSocket.position.copy(group.userData.seat.position)
  group.add(seatSocket)
  group.userData.sculptRuntime = {
    nodes,
    meshes,
    sockets: { seat: seatSocket },
    colliders: [
      { id: 'floor', type: 'box', center: [0, -0.125, 0], size: [6.2, 0.25, 4.2] },
      { id: 'desk', type: 'box', center: [0, 0.225, 0.5], size: [2.8, 0.45, 1.22] },
      { id: 'hearth', type: 'box', center: [2.19, 0.6, -0.95], size: [1.2, 1.2, 1.03] },
    ],
    destructionGroups: { shell: ['floor', 'walls', 'roof', 'beams'], study: ['study', 'cushion', 'open-book', 'notebook', 'lamp', 'tea', 'timer'], hearth: ['stove', 'pipe', 'kettle', 'firewood'] },
  }
  group.userData.ownedMaterials = ownedMaterials
  group.userData.ownedTextures = ownedTextures
  group.userData.anim(0, 0, {})
  return group
}
