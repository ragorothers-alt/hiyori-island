import * as THREE from 'three'
import { mat } from '../../util.js'

// Reference-driven proportions at base=1.6. Rear elevations are inferred.
const FORMS = {
  machiya: { w: 1.30, d: 1.12, eave: 1.02, peak: 1.34, doorX: .24 },
  shop: { w: 1.34, d: 1.10, eave: 1.15, peak: 1.52, doorX: -.30 },
  workshop: { w: 1.34, d: 1.12, eave: 1.10, peak: 1.43, doorX: -.22 },
  inn: { w: 1.32, d: 1.16, eave: 1.80, peak: 2.13, doorX: 0 },
  teahouse: { w: 1.34, d: 1.06, eave: .86, peak: 1.14, doorX: -.18 },
  watchtower: { w: .88, d: .86, eave: 2.76, peak: 3.10, doorX: 0 },
}
const WOOD = '#a9774e', END = '#c99c6c', DARK = '#77513d'
const CREAM = '#f7ead2', STONE = ['#c9c5bb', '#bdbeb4', '#d6cfc0', '#c4c0b7']

// Bake all static pieces sharing a material into a single mesh. Never retain source geometry.
function batch(parent, name, material) {
  const positions = [], normals = [], colors = []
  const transform = new THREE.Object3D(), nm = new THREE.Matrix3()
  const point = new THREE.Vector3(), normal = new THREE.Vector3()
  return {
    add(geometry, pos = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], color = '#ffffff') {
      transform.position.fromArray(pos); transform.scale.fromArray(scale)
      transform.rotation.set(...rotation); transform.updateMatrix()
      nm.getNormalMatrix(transform.matrix)
      const tint = new THREE.Color(color)
      const g = geometry.index ? geometry.toNonIndexed() : geometry
      for (let i = 0; i < g.attributes.position.count; i++) {
        point.fromBufferAttribute(g.attributes.position, i).applyMatrix4(transform.matrix)
        normal.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(nm).normalize()
        positions.push(point.x, point.y, point.z); normals.push(normal.x, normal.y, normal.z)
        colors.push(tint.r, tint.g, tint.b)
      }
      if (g !== geometry) g.dispose()
      geometry.dispose()
    },
    finish() {
      if (!positions.length) return null
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      g.computeBoundingSphere()
      const mesh = new THREE.Mesh(g, material)
      mesh.name = name; mesh.castShadow = mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    },
  }
}
function box(b, x, y, z, w, h, d, color = WOOD, rotation = [0, 0, 0]) {
  b.add(new THREE.BoxGeometry(w, h, d), [x, y, z], [1, 1, 1], rotation, color)
}
function rod(b, a, end, r, color = WOOD, square = false, segments = 6) {
  const start = new THREE.Vector3(...a), finish = new THREE.Vector3(...end)
  const delta = finish.clone().sub(start)
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()))
  const g = square ? new THREE.BoxGeometry(r * 2, delta.length(), r * 2) : new THREE.CylinderGeometry(r, r, delta.length(), segments)
  b.add(g, start.add(finish).multiplyScalar(.5).toArray(), [1, 1, 1], [rotation.x, rotation.y, rotation.z], color)
}
function cylinder(b, x, y, z, rt, rb, h, color, segments = 8) {
  b.add(new THREE.CylinderGeometry(rt, rb, h, segments), [x, y, z], [1, 1, 1], [0, 0, 0], color)
}
function ball(b, x, y, z, r, color, scale = [1, 1, 1]) {
  b.add(new THREE.IcosahedronGeometry(r, 0), [x, y, z], scale, [0, 0, 0], color)
}

function foundation(b, doorX) {
  box(b, 0, .078, -.025, 1.41, .15, 1.25, STONE[1])
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 6; i++) box(b, -.59 + i * .236, .093, sign * .621 - .025, .224, .172, .063, STONE[(i + (sign + 1)) % 4])
    for (let i = 0; i < 5; i++) box(b, sign * .69, .093, -.525 + i * .25, .063, .172, .238, STONE[(i + 1) % 4])
  }
  box(b, 0, .169, -.025, 1.43, .045, 1.27, STONE[2])
  box(b, doorX, .043, .705, .55, .086, .20, STONE[0])
  box(b, doorX, .108, .641, .53, .062, .14, STONE[2])
}
function plot(b) {
  box(b, 0, .012, 0, 1.37, .024, 1.29, '#d7c8a5')
  for (const x of [-.68, .68]) for (const z of [-.64, .64]) {
    box(b, x, .165, z, .065, .33, .065, END)
    box(b, x, .295, z, .074, .025, .074, WOOD)
  }
  for (const z of [-.64, .64]) {
    rod(b, [-.68, .25, z], [0, .21, z], .009, '#c6ab7e')
    rod(b, [0, .21, z], [.68, .25, z], .009, '#c6ab7e')
  }
  for (const x of [-.68, .68]) {
    rod(b, [x, .25, -.64], [x, .21, 0], .009, '#c6ab7e')
    rod(b, [x, .21, 0], [x, .25, .64], .009, '#c6ab7e')
  }
}
function lumber(b) {
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 3; i++) {
    box(b, -.28, .215 + layer * .055, -.32 + i * .11, .72 - layer * .06, .045, .084, i % 2 ? END : WOOD)
  }
  box(b, .38, .235, .25, .23, .085, .3, END)
}
function frame(b, f, tower) {
  const x = f.w / 2, z = f.d / 2
  if (tower) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      rod(b, [sx * .57, .17, sz * .53], [sx * .40, 2.26, sz * .38], .047, WOOD, true)
    }
    for (const y of [.28, 1.10, 1.95, 2.20]) {
      box(b, 0, y, 0, 1.08 - y * .07, .075, .98 - y * .065, DARK)
    }
    for (const sx of [-1, 1]) {
      rod(b, [sx * .54, .30, -.48], [sx * .43, 1.92, .39], .028, END, true)
      rod(b, [sx * .54, .30, .48], [sx * .43, 1.92, -.39], .028, WOOD, true)
    }
    rod(b, [-.51, .32, -.48], [.42, 1.92, -.39], .026, END, true)
    rod(b, [.51, .32, -.48], [-.42, 1.92, -.39], .026, WOOD, true)
  }
  const floor = tower ? 2.18 : .19
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(b, sx * x, (floor + f.eave) / 2, sz * z, .085, f.eave - floor, .085)
    box(b, sx * x, f.eave - .055, sz * z, .13, .09, .13, END)
  }
  for (const y of [floor + .045, f.eave - .025, ...(f.eave > 1.6 && !tower ? [1.01] : [])]) {
    for (const sz of [-1, 1]) box(b, 0, y, sz * z, f.w + .13, .075, .08)
    for (const sx of [-1, 1]) box(b, sx * x, y, 0, .08, .075, f.d + .13)
  }
  // Exposed trusses remain visible through the walls until the roof is fitted.
  for (const zz of [-z - .10, 0, z + .10]) {
    rod(b, [-x - .13, f.eave - .025, zz], [0, f.peak, zz], .032, END, true)
    rod(b, [0, f.peak, zz], [x + .13, f.eave - .025, zz], .032, END, true)
    if (zz) rod(b, [0, f.eave, zz], [0, f.peak, zz], .027, WOOD, true)
  }
  box(b, 0, f.peak, 0, .065, .065, f.d + .30, WOOD)
  for (const sx of [-1, 1]) box(b, sx * (x + .06), f.eave - .01, 0, .058, .065, f.d + .30, WOOD)
}

// Window surfaces are opaque emissive inserts, so both sides cast consistent shadows.
function windowBay(b, glow, x, y, z, w, h, yaw = 0) {
  // Transform the local window recipe directly into the caller's batches.
  const piece = (target, xx, yy, zz, ww, hh, dd, col) => {
    box(target, x + Math.cos(yaw) * xx + Math.sin(yaw) * zz, y + yy, z - Math.sin(yaw) * xx + Math.cos(yaw) * zz, ww, hh, dd, col, [0, yaw, 0])
  }
  // b and glow are geometry accumulators; no detached objects are added.
  piece(b, 0, 0, 0, w + .055, h + .055, .035, DARK)
  piece(glow, 0, 0, .022, w, h, .016, '#fff2c7')
  for (const sy of [-1, 1]) piece(b, 0, sy * h / 2, .039, w + .09, .033, .06, END)
  for (let i = 0; i <= 4; i++) piece(b, -w / 2 + i * w / 4, 0, .043, .018, h, .026, WOOD)
  piece(b, 0, 0, .044, w, .018, .026, WOOD)
}
function walls(b, glow, f, kind) {
  const tower = kind === 'watchtower', y0 = tower ? 2.23 : .22
  const wallTop = f.eave - .07, height = wallTop - y0
  const z = f.d / 2, x = f.w / 2
  // Rear and side infill, exposed timber overlays their seams.
  box(b, 0, y0 + height / 2, -z, f.w - .06, height, .065, CREAM)
  for (const sx of [-1, 1]) {
    box(b, sx * x, y0 + height / 2, 0, .065, height, f.d - .07, CREAM)
    box(b, sx * (x + .037), y0 + .115, 0, .018, .23, f.d - .08, END)
    windowBay(b, glow, sx * (x + .04), kind === 'inn' ? .67 : y0 + height * .60, -.05, tower ? .36 : .44, tower ? .25 : .34, sx * Math.PI / 2)
    box(b, sx * (x + .045), y0 + height / 2, -.32, .04, height, .045, WOOD)
  }
  // Front infill surrounds a true recessed doorway, rather than covering a wall with a door.
  const dw = kind === 'workshop' ? .60 : kind === 'teahouse' ? .62 : .40
  const dh = Math.min(.81, height - .04), dx = f.doorX
  const left = -x + .04, right = x - .04
  const dl = dx - dw / 2, dr = dx + dw / 2
  if (dl > left) box(b, (left + dl) / 2, y0 + height / 2, z, dl - left, height, .065, CREAM)
  if (dr < right) box(b, (dr + right) / 2, y0 + height / 2, z, right - dr, height, .065, CREAM)
  if (height > dh) box(b, dx, y0 + (dh + height) / 2, z, dw, height - dh, .065, CREAM)
  box(b, dx, y0 + dh / 2, z - .025, dw, dh, .04, DARK)
  box(glow, dx, y0 + dh * .64, z + .002, dw - .055, dh * .52, .012, '#fae8b9')
  for (const sx of [-1, 1]) box(b, dx + sx * dw / 2, y0 + dh / 2, z + .05, .04, dh + .05, .07, END)
  box(b, dx, y0 + dh, z + .05, dw + .10, .055, .09, END)
  for (let i = 0; i < 6; i++) box(b, dx - dw / 2 + .035 + i * (dw - .07) / 5, y0 + dh / 2, z + .035, .016, dh - .025, .025, WOOD)
  box(b, dx, y0 + dh * .30, z + .038, dw, .06, .028, END)
  const wx = dx >= 0 ? -.36 : .35
  if (!tower) windowBay(b, glow, wx, y0 + Math.min(.46, height * .60), z + .04, kind === 'shop' ? .43 : .33, Math.min(.32, height * .43))
  windowBay(b, glow, .12, kind === 'inn' ? .67 : y0 + height * .60, -z - .045, .38, .29, Math.PI)
  // Cream triangular gable infill sits inside the exposed end truss.
  const shape = new THREE.Shape()
  shape.moveTo(-x + .05, f.eave - .025); shape.lineTo(x - .05, f.eave - .025)
  shape.lineTo(0, f.peak - .055); shape.closePath()
  for (const zz of [-z, z]) b.add(new THREE.ExtrudeGeometry(shape, { depth: .045, bevelEnabled: false }), [0, 0, zz - .0225], [1, 1, 1], [0, 0, 0], CREAM)
  if (kind === 'inn') {
    box(b, 0, 1.04, z + .045, f.w, .09, .09, END)
    for (const xx of [-.34, .34]) windowBay(b, glow, xx, 1.46, z + .04, .35, .34)
    for (const xx of [-.34, .34]) windowBay(b, glow, xx, 1.46, -z - .045, .35, .34, Math.PI)
    for (const sx of [-1, 1]) windowBay(b, glow, sx * (x + .04), 1.46, -.05, .44, .34, sx * Math.PI / 2)
    box(b, 0, 1.04, -z - .045, f.w, .07, .07, END)
  }
}

// Sloped solid decks plus geometric tile ribs; no texture, canvas or asset IO.
function roof(b, tile, f, outline = false) {
  const half = f.w / 2 + .14, z = f.d / 2 + .15
  const rise = f.peak - f.eave, angle = Math.atan2(rise, half)
  const length = Math.hypot(half, rise)
  for (const side of [-1, 1]) {
    box(tile, side * half / 2, f.eave + rise / 2 + .018, 0, length, .045, z * 2, '#ffffff', [0, 0, -side * angle])
  }
  if (outline) return
  const columns = Math.round(z * 2 / .15), rows = 3
  // Short raised barrels establish the tile rhythm without a separate draw call per tile.
  for (const side of [-1, 1]) for (let col = 0; col <= columns; col++) {
    const zz = -z + .025 + col * (z * 2 - .05) / columns
    for (let row = 0; row < rows; row++) {
      const a = row / rows, end = (row + .94) / rows
      const tint = new THREE.Color('#ffffff').multiplyScalar(.91 + ((col * 3 + row) % 5) * .023).getHex()
      rod(tile, [side * (a * half + .018), f.peak - a * rise + .048, zz], [side * (end * half + .018), f.peak - end * rise + .048, zz], .026, tint, false, 5)
    }
    // Round eave tile faces remain visible from the street.
    ball(tile, side * (half - .012), f.eave + .045, zz, .034, '#faf8f0', [.65, .65, 1])
  }
  for (let i = 0; i < 7; i++) rod(tile, [0, f.peak + .045, -z + i * z * 2 / 7], [0, f.peak + .045, -z + (i + 1) * z * 2 / 7 - .014], .052, i % 2 ? '#ffffff' : '#ece9e1', false, 5)
}

function chimney(b) {
  box(b, -.39, 1.42, -.27, .22, .36, .23, STONE[1])
  for (let i = 0; i < 4; i++) box(b, -.39, 1.29 + i * .085, -.27, .231, .013, .241, STONE[2])
  box(b, -.39, 1.615, -.27, .28, .055, .29, DARK)
  box(b, -.39, 1.646, -.27, .17, .012, .17, '#554e47')
}
function veranda(b, f, kind) {
  if (kind === 'teahouse') {
    for (let i = 0; i < 7; i++) box(b, -.59 + i * .195, .205, .665, .185, .045, .24, END)
  }
  if (kind === 'inn') {
    box(b, 0, 1.11, .65, 1.29, .065, .23, END)
    for (const xx of [-.58, -.29, 0, .29, .58]) box(b, xx, 1.25, .75, .028, .25, .028, WOOD)
    box(b, 0, 1.39, .75, 1.29, .035, .045, DARK)
  }
  if (kind === 'watchtower') {
    box(b, 0, 2.22, 0, 1.17, .07, 1.10, END)
    for (const sz of [-1, 1]) {
      for (const xx of [-.55, -.27, 0, .27, .55]) box(b, xx, 2.37, sz * .52, .026, .27, .026, WOOD)
      box(b, 0, 2.51, sz * .52, 1.16, .035, .035, DARK)
    }
    for (const sx of [-1, 1]) box(b, sx * .56, 2.51, 0, .035, .035, 1.08, DARK)
    for (const xx of [-.16, .16]) rod(b, [xx, .19, .68], [xx, 2.21, .48], .024, END, true)
    for (let i = 0; i < 12; i++) box(b, 0, .28 + i * .16, .671 - i * .016, .36, .03, .045, WOOD)
  }
}
function planter(b, x, z, flowers = true) {
  cylinder(b, x, .28, z, .095, .065, .18, '#c99873')
  cylinder(b, x, .363, z, .109, .105, .04, '#dbad82')
  cylinder(b, x, .386, z, .084, .084, .012, '#7e6c4f')
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI * 2 / 4, xx = x + Math.cos(a) * .065, zz = z + Math.sin(a) * .065
    rod(b, [x, .38, z], [xx, .48, zz], .009, '#78925a')
    ball(b, xx, .465, zz, .070, i % 2 ? '#95ad6f' : '#7e9b61', [1, .6, 1])
    if (flowers) {
      for (let j = 0; j < 5; j++) ball(b, xx + Math.cos(j * 1.257) * .025, .51, zz + Math.sin(j * 1.257) * .025, .020, '#edc2b9')
      ball(b, xx, .518, zz, .014, '#efcd79')
    }
  }
}
function bench(b, x, z, w = .43) {
  for (const sx of [-1, 1]) box(b, x + sx * w * .34, .24, z, .045, .20, .13, DARK)
  for (const zz of [-.055, .005, .065]) box(b, x, .35, z + zz, w, .037, .05, END)
}
function crest(b, x, y, z, color = '#fff0d5', size = .018) {
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5
    ball(b, x + Math.cos(a) * size, y + Math.sin(a) * size, z, size * .70, color, [1, 1, .24])
  }
  ball(b, x, y, z + .004, size * .5, '#f2d797', [1, 1, .25])
}
function details(b, lantern, f, kind) {
  const z = f.d / 2, y = Math.min(f.eave - .12, 1.06)
  const lx = kind === 'watchtower' ? .49 : f.w / 2 - .07
  const ly = kind === 'watchtower' ? 2.56 : y
  rod(b, [lx - .05, ly + .09, z], [lx + .075, ly + .09, z + .13], .016, DARK)
  cylinder(b, lx + .075, ly + .022, z + .13, .009, .009, .12, DARK, 6)
  const lanternY = ly - .12
  const profile = [[.042, -.14], [.075, -.115], [.084, -.065], [.087, .04], [.075, .10], [.04, .125]].map(([r, h]) => new THREE.Vector2(r, h))
  lantern.add(new THREE.LatheGeometry(profile, 10), [lx + .075, lanternY, z + .13], [1, 1, 1], [0, 0, 0], '#fff0bd')
  for (let i = 0; i < 6; i++) {
    const yy = lanternY - .10 + i * .036
    const radius = i === 0 || i === 5 ? .075 : .088
    cylinder(b, lx + .075, yy, z + .13, radius, radius, .008, '#c69d67', 10)
  }
  for (const sy of [-1, 1]) cylinder(b, lx + .075, lanternY + sy * .135, z + .13, .045, .045, .025, DARK, 8)
  if (kind !== 'watchtower') {
    planter(b, -.57, .70, kind !== 'workshop')
    if (kind === 'machiya') bench(b, .58, .70, .25)
    if (kind === 'teahouse') bench(b, .44, .70, .37)
    if (kind === 'shop') {
      box(b, .34, .42, .70, .42, .40, .18, WOOD)
      box(b, .34, .635, .70, .47, .04, .20, END)
      for (let i = 0; i < 4; i++) ball(b, .19 + i * .09, .68, .70, .045, i % 2 ? '#e6bd76' : '#a9bc7d')
    }
    if (kind === 'workshop') {
      cylinder(b, .53, .31, .70, .085, .075, .23, END, 10)
      for (const yy of [.235, .38]) cylinder(b, .53, yy, .70, .087, .087, .025, '#88857b', 10)
      box(b, .35, .27, .71, .16, .14, .15, WOOD)
      box(b, .35, .35, .71, .15, .03, .14, DARK)
    }
    // Carved hanging sign, geometry-only flower emblem.
    box(b, -.52, y + .01, z + .12, .18, .22, .045, DARK)
    box(b, -.52, y + .01, z + .147, .145, .18, .012, END)
    crest(b, -.52, y + .01, z + .159, '#fff0d5', .032)
  } else {
    // Bell is tucked inside the lookout roof, no floating ornament above the peak.
    rod(b, [0, 2.83, .10], [0, 2.66, .10], .010, DARK)
    cylinder(b, 0, 2.61, .10, .04, .075, .12, '#baa570', 10)
    cylinder(b, 0, 2.54, .10, .08, .08, .025, '#d5c18b', 10)
  }
}

export function createHouse(kind, stage, color, base, outline = false) {
  const f = FORMS[kind], tower = kind === 'watchtower'
  const root = new THREE.Group(); root.name = `project-house-${kind}-${stage}`
  const ownedMaterials = []
  const own = (options) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, ...options })
    ownedMaterials.push(m); return m
  }
  const common = mat('#ffffff', { vertexColors: true })
  const staticParts = batch(root, 'masonry-timber-plaster', common)
  let glow, tile, glowMaterial, lantern, lanternMaterial, curtainPivot
  if (stage >= 3) {
    glowMaterial = own({ color: '#fff1d0', emissive: '#ffc36b', emissiveIntensity: 0 })
    glow = batch(root, 'window-light', glowMaterial)
  }
  if (stage >= 4) {
    const roofColor = new THREE.Color(color).multiplyScalar(.82)
    tile = batch(root, 'ceramic-roof', own({ color: roofColor, roughness: .92 }))
  }
  if (stage === 5) {
    lanternMaterial = own({ color: '#fff3ce', emissive: '#ffad49', emissiveIntensity: 0 })
    lantern = batch(root, 'paper-lantern', lanternMaterial)
  }
  if (stage === 0) plot(staticParts)
  else {
    foundation(staticParts, f.doorX)
    if (stage === 1) {
      lumber(staticParts)
      box(staticParts, -.68, .255, -.59, .055, .17, .055, END)
    }
    if (stage >= 2) frame(staticParts, f, tower)
    if (stage >= 3) walls(staticParts, glow, f, kind)
    if (stage >= 4) {
      roof(staticParts, tile, f, outline)
      if (kind === 'workshop') chimney(staticParts)
    }
    if (stage === 5) {
      veranda(staticParts, f, kind)
      details(staticParts, lantern, f, kind)
      curtainPivot = new THREE.Group(); curtainPivot.name = 'noren-pivot'
      curtainPivot.position.set(f.doorX, tower ? 2.72 : Math.min(f.eave - .11, 1.04), f.d / 2 + .12)
      root.add(curtainPivot)
      const cloth = batch(curtainPivot, 'split-noren', own({ roughness: .97 }))
      const width = kind === 'teahouse' || kind === 'workshop' ? .65 : .58
      const height = tower ? .15 : .22
      box(staticParts, f.doorX, curtainPivot.position.y + .024, curtainPivot.position.z, width + .10, .028, .028, DARK)
      for (let i = 0; i < 3; i++) {
        const xx = (i - 1) * width / 3
        box(cloth, xx, -height / 2, 0, width / 3 - .012, height, .016, color)
        crest(cloth, xx, -height * .54, .011, '#fff3dd', .024)
      }
      cloth.finish()
    }
  }
  staticParts.finish(); glow?.finish(); tile?.finish(); lantern?.finish()
  // Bake footprint sizing so the caller can independently animate root.scale 0→1.
  const scale = base / 1.6
  root.traverse((o) => {
    if (o.isMesh) o.geometry.scale(scale, scale, scale)
    if (o !== root) o.position.multiplyScalar(scale)
  })
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  // A height alone is not an attachment point (the chimney and plot posts
  // are off centre). Keep the highest actual vertex in root coordinates.
  const top = new THREE.Vector3(0, -Infinity, 0), vertex = new THREE.Vector3()
  root.traverse((o) => {
    if (!o.isMesh) return
    const positions = o.geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld)
      if (vertex.y > top.y) top.copy(vertex)
    }
  })
  // Project the chosen mount onto its post, frame or roof, rather than
  // estimating a height that can leave the flag floating over the roof.
  const flag = new THREE.Vector3(stage < 2 ? -.68 : stage < 4 ? f.w / 2 : 0,
    0, stage === 0 ? -.64 : stage === 1 ? -.59 : -.20).multiplyScalar(scale)
  const mountRay = new THREE.Raycaster(new THREE.Vector3(flag.x, bounds.max.y + scale, flag.z), new THREE.Vector3(0, -1, 0))
  flag.copy(mountRay.intersectObject(root, true)[0].point)
  root.userData = {
    top,
    door: new THREE.Vector3(f.doorX, 0, .75).multiplyScalar(base / 1.6),
    flag,
    anim(t, dt, context) {
      const night = context?.night
      const n = Number.isFinite(night) ? THREE.MathUtils.clamp(night, 0, 1) : 0
      if (glowMaterial) glowMaterial.emissiveIntensity = n * 1.7
      if (lanternMaterial) lanternMaterial.emissiveIntensity = n * 2.2
      if (curtainPivot) curtainPivot.rotation.x = Math.sin((Number.isFinite(t) ? t : 0) * 1.7) * .045
    },
    ownedMaterials, ownedTextures: [],
  }
  return root
}

