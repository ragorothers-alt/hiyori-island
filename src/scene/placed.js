import * as THREE from 'three'
import { mat, shadowed, tween, ease } from './util.js'
import { LAYOUT } from './island.js'
import { SHOP_ITEMS } from '../data/shop.js'

// 金平糖商店的裝飾：模型、擺放位置檢查、擺放預覽
const WOOD = '#b48f7a'
const DARK = '#5d5866'

// 會在夜晚發光的材質（每個物件各自一份）
const glowMat = (color, emissive) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.3, roughness: 0.6 })

function frame(g, h = 1.1, w = 0.9) {
  for (const x of [-w / 2, w / 2]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, h, 6), mat(WOOD))
    p.position.set(x, h / 2, 0)
    g.add(p)
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.07, 0.08), mat(WOOD))
  beam.position.y = h
  g.add(beam)
  return h
}

// 小物件共用的形體；透明材質由各模型自行持有
function piece(g, geometry, color, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geometry, typeof color === 'string' ? mat(color) : color)
  o.position.set(x, y, z)
  g.add(o)
  return o
}

function ball(g, color, x, y, z, sx, sy = sx, sz = sx) {
  const o = piece(g, new THREE.SphereGeometry(1, 12, 8), color, x, y, z)
  o.scale.set(sx, sy, sz)
  return o
}

function box(g, color, x, y, z, w, h, d) {
  return piece(g, new THREE.BoxGeometry(w, h, d), color, x, y, z)
}

function rod(g, color, from, to, r = 0.025) {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const dir = b.clone().sub(a)
  const o = piece(g, new THREE.CylinderGeometry(r, r, dir.length(), 7), color)
  o.position.copy(a.add(b).multiplyScalar(0.5))
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  return o
}

function pinwheel(g, x, y, z, r) {
  const rotor = new THREE.Group()
  const colors = ['#f3a9bb', '#9ed9d1', '#f4d48c', '#a9c9eb']
  const blade = new THREE.Shape()
  blade.moveTo(0, 0)
  blade.lineTo(0, r)
  blade.lineTo(r * 0.7, r * 0.65)
  blade.lineTo(r * 0.35, r * 0.12)
  blade.closePath()
  for (let i = 0; i < 4; i++) {
    const p = piece(rotor, new THREE.ShapeGeometry(blade), mat(colors[i], { side: THREE.DoubleSide }))
    p.rotation.z = i * Math.PI / 2
  }
  ball(rotor, '#f9edc9', 0, 0, 0.018, r * 0.15)
  rotor.position.set(x, y, z)
  g.add(rotor)
  ;(g.userData.spin ||= []).push(rotor)
  return rotor
}

function steam(g, positions) {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.42, depthWrite: false, roughness: 1 })
  ;(g.userData.owned ||= []).push(material)
  const puffs = positions.map(([x, y, z, s]) => ball(g, material, x, y, z, s * 0.65, s, s * 0.6))
  g.userData.anim = (t) => {
    puffs.forEach((p, i) => {
      p.position.y = positions[i][1] + Math.sin(t * 0.9 + i * 1.8) * 0.035
      p.position.x = positions[i][0] + Math.sin(t * 0.7 + i) * 0.018
      p.scale.y = positions[i][3] * (1 + Math.sin(t + i) * 0.12)
    })
  }
}

const BUILD = {
  mushroom() {
    const g = new THREE.Group()
    const caps = ['#f6a3ae', '#f9c78f', '#f7b7c9']
    ;[[0, 0, 1], [0.28, 0.12, 0.7], [-0.22, 0.18, 0.55]].forEach(([x, z, s], i) => {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.09 * s, 0.3 * s, 8), mat('#fbf6ee'))
      stem.position.set(x, 0.15 * s, z)
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(caps[i]))
      cap.position.set(x, 0.28 * s, z)
      cap.scale.y = 0.8
      g.add(stem, cap)
      for (let k = 0; k < 4; k++) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.025 * s, 6, 4), mat('#ffffff'))
        const a = k * 1.7 + i
        dot.position.set(x + Math.cos(a) * 0.12 * s, 0.38 * s, z + Math.sin(a) * 0.12 * s)
        g.add(dot)
      }
    })
    return g
  },
  lamp() {
    const g = new THREE.Group()
    const stone = mat('#e4e0e6')
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 6), stone)
    base.position.y = 0.05
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.4, 6), stone)
    post.position.y = 0.3
    const light = glowMat('#fff3d6', '#ffcf8a')
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.22), light)
    box.position.y = 0.6
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.18, 4), stone)
    roof.rotation.y = Math.PI / 4
    roof.position.y = 0.79
    g.add(base, post, box, roof)
    g.userData.glow = [light]
    return g
  },
  teru() {
    const g = new THREE.Group()
    const h = frame(g, 1.15, 0.7)
    const doll = new THREE.Group()
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), mat('#ffffff', { flatShading: false }))
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.24, 10, 1, true), mat('#ffffff', { side: THREE.DoubleSide }))
    skirt.position.y = -0.17
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), mat(DARK))
      eye.position.set(s * 0.045, 0.02, 0.12)
      doll.add(eye)
    }
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 4), mat('#d9c9b6'))
    string.position.y = 0.2
    doll.add(head, skirt, string)
    doll.position.y = h - 0.3
    g.add(doll)
    g.userData.sway = doll
    return g
  },
  bench() {
    const g = new THREE.Group()
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, 0.34), mat('#d9b89f'))
    seat.position.y = 0.32
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.24, 0.05), mat('#d9b89f'))
    back.position.set(0, 0.52, -0.15)
    g.add(seat, back)
    for (const x of [-0.42, 0.42]) {
      for (const z of [-0.12, 0.12]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.06), mat(WOOD))
        leg.position.set(x, 0.16, z)
        g.add(leg)
      }
    }
    return g
  },
  pumpkin() {
    const g = new THREE.Group()
    const skin = glowMat('#f4a96a', '#ff9a4a')
    for (let i = 0; i < 6; i++) {
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skin)
      const a = (i / 6) * Math.PI * 2
      lobe.scale.set(0.7, 0.85, 0.9)
      lobe.position.set(Math.cos(a) * 0.1, 0.19, Math.sin(a) * 0.1)
      lobe.rotation.y = -a
      g.add(lobe)
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.12, 6), mat('#7fae6e'))
    stem.position.y = 0.4
    stem.rotation.z = 0.25
    g.add(stem)
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.06, 3), glowMat('#5a4a40', '#ffcf6a'))
      eye.position.set(s * 0.08, 0.24, 0.27)
      eye.rotation.x = Math.PI / 2
      g.add(eye)
    }
    g.userData.glow = [skin]
    g.userData.glowBase = 0.1
    return g
  },
  snowman() {
    const g = new THREE.Group()
    const snow = mat('#fbfdff', { flatShading: false })
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), snow)
    b.position.y = 0.26
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), snow)
    h.position.y = 0.66
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 6), mat('#f4a060'))
    nose.rotation.x = Math.PI / 2
    nose.position.set(0, 0.66, 0.24)
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), mat(DARK))
      eye.position.set(s * 0.07, 0.72, 0.17)
      g.add(eye)
    }
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 6, 20), mat('#8ec5e8'))
    scarf.rotation.x = Math.PI / 2
    scarf.position.y = 0.5
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.14, 10), mat('#f2a3b8'))
    bucket.position.y = 0.86
    bucket.rotation.z = 0.15
    g.add(b, h, nose, scarf, bucket)
    return g
  },
  bamboo() {
    const g = new THREE.Group()
    const greens = ['#9fd18c', '#8cc47c', '#b0dc9a']
    ;[[0, 0, 1.6], [0.2, 0.1, 1.25], [-0.18, 0.12, 1.4], [0.06, -0.2, 1.1], [-0.08, 0.28, 0.9]].forEach(([x, z, h], i) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, h, 7), mat(greens[i % 3]))
      c.position.set(x, h / 2, z)
      g.add(c)
      for (let y = 0.35; y < h; y += 0.35) {
        const node = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 4, 10), mat('#7fb36e'))
        node.rotation.x = Math.PI / 2
        node.position.set(x, y, z)
        g.add(node)
      }
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), mat('#a8d98f'))
      leaf.scale.set(1.4, 0.25, 0.5)
      leaf.position.set(x + 0.1, h - 0.1, z)
      leaf.rotation.z = -0.4
      g.add(leaf)
    })
    return g
  },
  chime() {
    const g = new THREE.Group()
    const h = frame(g, 1.15, 0.6)
    const bell = new THREE.Group()
    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: '#cfeaf8', roughness: 0.05, transmission: 0.3, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    )
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.26), mat('#f7b3c6', { side: THREE.DoubleSide }))
    paper.position.y = -0.24
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 4), mat('#d9c9b6'))
    string.position.y = -0.07
    bell.add(glass, string, paper)
    bell.position.y = h - 0.14
    g.add(bell)
    g.userData.sway = bell
    return g
  },
  pine() {
    const g = new THREE.Group()
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.2, 10), mat('#8fb7d9'))
    pot.position.y = 0.1
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.5, 6), mat('#9a7a6a'))
    trunk.position.set(0.04, 0.42, 0)
    trunk.rotation.z = -0.3
    g.add(pot, trunk)
    ;[[0.18, 0.62, 0.32], [-0.12, 0.72, 0.26], [0.02, 0.86, 0.2]].forEach(([x, y, s]) => {
      const f = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), mat('#7fb38a'))
      f.scale.y = 0.42
      f.position.set(x, y, 0)
      g.add(f)
    })
    return g
  },
  fox() {
    const g = new THREE.Group()
    const white = mat('#f9f7f4')
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), mat('#d9d5e0'))
    base.position.y = 0.07
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 8), white)
    body.position.y = 0.34
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), white)
    head.position.y = 0.6
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), white)
    snout.rotation.x = Math.PI / 2
    snout.position.set(0, 0.58, 0.12)
    g.add(base, body, head, snout)
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 4), white)
      ear.position.set(s * 0.055, 0.71, 0)
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 4), mat('#f6b4c4'))
      inner.position.set(s * 0.055, 0.7, 0.02)
      g.add(ear, inner)
    }
    const bib = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.08, 3), mat('#ef8e83'))
    bib.rotation.x = Math.PI
    bib.position.set(0, 0.47, 0.08)
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), white)
    tail.scale.set(0.8, 1.6, 0.8)
    tail.position.set(0.12, 0.3, -0.1)
    g.add(bib, tail)
    return g
  },
  mailbox() {
    const g = new THREE.Group()
    const red = mat('#ef8e88', { flatShading: false })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.8, 16), red)
    body.position.y = 0.4
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#5d5866', { flatShading: false }))
    cap.position.y = 0.8
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), mat(DARK))
    slot.position.set(0, 0.62, 0.18)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.01), mat('#ffffff'))
    plate.position.set(0, 0.42, 0.181)
    g.add(body, cap, slot, plate)
    return g
  },
  cat() {
    const g = new THREE.Group()
    const fur = mat('#fbf8f5', { flatShading: false })
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), fur)
    body.scale.set(1.3, 0.75, 0.9)
    body.position.y = 0.15
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), fur)
    head.position.set(0.22, 0.2, 0.04)
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.08, 4), fur)
      ear.position.set(0.22 + 0.02, 0.32, 0.04 + s * 0.07)
      ear.rotation.x = s * 0.2
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.006, 4, 8, Math.PI), mat(DARK))
      eye.position.set(0.33, 0.21, 0.04 + s * 0.05)
      eye.rotation.y = Math.PI / 2
      eye.rotation.z = Math.PI
      g.add(ear, eye)
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 16, Math.PI), fur)
    tail.position.set(-0.12, 0.05, 0.1)
    tail.rotation.x = -Math.PI / 2
    g.add(body, head, tail)
    g.userData.breathe = body
    return g
  },
  vending() {
    const g = new THREE.Group()
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.4), mat('#a8dccb'))
    box.position.y = 0.55
    const panel = glowMat('#f4fbff', '#dff3ff')
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.5), panel)
    glass.position.set(0, 0.72, 0.201)
    g.add(box, glass)
    const colors = ['#f7b3c6', '#f5d48a', '#8ec5e8', '#b9a7e6', '#9fd8b0']
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.03), mat(colors[(i + row) % 5]))
        b.position.set(-0.18 + i * 0.09, 0.84 - row * 0.22, 0.21)
        g.add(b)
      }
    }
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.03), mat('#5d5866'))
    tray.position.set(0, 0.22, 0.205)
    g.add(tray)
    g.userData.glow = [panel]
    g.userData.glowBase = 0.4
    return g
  },
  tanuki() {
    const g = new THREE.Group()
    const clay = '#b28c77'
    for (const s of [-1, 1]) {
      ball(g, '#877163', s * 0.11, 0.045, 0.06, 0.09, 0.045, 0.1)
      ball(g, clay, s * 0.12, 0.68, 0, 0.065)
      ball(g, '#e5c9ac', s * 0.12, 0.69, 0.045, 0.035)
    }
    ball(g, clay, 0, 0.28, 0, 0.21, 0.26, 0.17)
    ball(g, '#efddbd', 0, 0.27, 0.137, 0.16, 0.19, 0.055)
    ball(g, clay, 0, 0.57, 0, 0.18, 0.16, 0.15)
    for (const s of [-1, 1]) {
      ball(g, '#786b65', s * 0.072, 0.59, 0.127, 0.062, 0.044, 0.024)
      ball(g, DARK, s * 0.072, 0.6, 0.15, 0.015)
    }
    ball(g, '#f3dfbf', 0, 0.54, 0.15, 0.08, 0.044, 0.047)
    ball(g, DARK, 0, 0.56, 0.19, 0.024, 0.016, 0.018)
    piece(g, new THREE.ConeGeometry(0.26, 0.14, 10), '#dbc29b', 0, 0.77, -0.015)
    piece(g, new THREE.CylinderGeometry(0.27, 0.27, 0.025, 10), '#c9ab84', 0, 0.702, -0.015)
    ball(g, clay, 0.205, 0.38, 0.04, 0.075, 0.12, 0.07).rotation.z = -0.3
    ball(g, clay, -0.2, 0.39, 0.04, 0.07, 0.12, 0.065).rotation.z = 0.4
    ball(g, '#8faeaa', 0.235, 0.24, 0.12, 0.065, 0.11, 0.065)
    piece(g, new THREE.CylinderGeometry(0.024, 0.035, 0.09, 7), '#8faeaa', 0.235, 0.36, 0.12)
    box(g, '#f4e6ce', 0.235, 0.25, 0.182, 0.052, 0.072, 0.008)
    return g
  },
  tsukubai() {
    const g = new THREE.Group()
    const stone = mat('#c2c8c5')
    piece(g, new THREE.CylinderGeometry(0.26, 0.3, 0.1, 9), stone, 0, 0.05, 0.035)
    piece(g, new THREE.CylinderGeometry(0.22, 0.25, 0.19, 10), stone, 0, 0.185, 0.035)
    const rim = piece(g, new THREE.TorusGeometry(0.205, 0.055, 6, 12), '#d8dbd3', 0, 0.29, 0.035)
    rim.rotation.x = Math.PI / 2
    const water = new THREE.MeshStandardMaterial({ color: '#a5dce9', transparent: true, opacity: 0.78, roughness: 0.2 })
    const stream = new THREE.MeshStandardMaterial({ color: '#ceeef2', transparent: true, opacity: 0.65, roughness: 0.2 })
    const surface = piece(g, new THREE.CircleGeometry(0.2, 16), water, 0, 0.287, 0.035)
    surface.rotation.x = -Math.PI / 2
    rod(g, '#a6c58d', [-0.17, 0, -0.18], [-0.17, 0.61, -0.18], 0.035)
    rod(g, '#b8d29b', [-0.17, 0.59, -0.19], [0, 0.59, -0.035], 0.038)
    rod(g, stream, [0, 0.565, -0.035], [0, 0.29, -0.035], 0.009)
    const ripple = piece(g, new THREE.TorusGeometry(0.055, 0.006, 4, 16), '#d9f3ef', 0, 0.293, -0.035)
    ripple.rotation.x = Math.PI / 2
    g.userData.owned = [water, stream]
    g.userData.anim = (t) => ripple.scale.setScalar(1 + Math.sin(t * 2) * 0.18)
    return g
  },
  swing() {
    const g = new THREE.Group()
    for (const x of [-0.29, 0.29]) {
      for (const z of [-0.19, 0.19]) {
        rod(g, WOOD, [x, 0.025, z], [x, 1.12, 0], 0.035)
        ball(g, '#c7aa90', x, 0.022, z, 0.043, 0.022, 0.043)
      }
    }
    rod(g, '#d0ac8f', [-0.36, 1.12, 0], [0.36, 1.12, 0], 0.045)
    const seat = new THREE.Group()
    for (const x of [-0.17, 0.17]) rod(seat, '#dfcfad', [x, 0, 0], [x, -0.73, 0], 0.009)
    box(seat, '#dfbd9f', 0, -0.75, 0, 0.43, 0.06, 0.2)
    box(seat, '#cfa68b', 0, -0.717, 0, 0.4, 0.008, 0.012)
    seat.position.y = 1.1
    g.add(seat)
    g.userData.sway = seat
    return g
  },
  kazaguruma() {
    const g = new THREE.Group()
    piece(g, new THREE.CylinderGeometry(0.22, 0.25, 0.09, 9), '#e4d7be', 0, 0.045, 0)
    ;[[-0.18, 0.67, 0.035, 0.13], [0.04, 0.94, -0.07, 0.16], [0.2, 0.58, 0.07, 0.12], [-0.055, 0.47, 0.12, 0.11]].forEach(([x, y, z, r]) => {
      rod(g, '#b8caa3', [x, 0.08, z], [x, y, z], 0.014)
      pinwheel(g, x, y, z + 0.025, r)
    })
    return g
  },
  azumaya() {
    const g = new THREE.Group()
    box(g, '#d9c5ad', 0, 0.05, 0, 0.96, 0.1, 0.86)
    for (const x of [-0.37, 0.37]) {
      for (const z of [-0.32, 0.32]) rod(g, '#c19c7f', [x, 0.1, z], [x, 1.21, z], 0.045)
    }
    for (const z of [-0.32, 0.32]) box(g, '#b48f7a', 0, 1.16, z, 0.86, 0.095, 0.08)
    for (const x of [-0.37, 0.37]) box(g, '#b48f7a', x, 1.16, 0, 0.08, 0.095, 0.74)
    const eave = piece(g, new THREE.ConeGeometry(0.735, 0.39, 4), '#b9a18b', 0, 1.38, 0)
    eave.rotation.y = Math.PI / 4
    const roof = piece(g, new THREE.ConeGeometry(0.67, 0.37, 4), '#d0b69b', 0, 1.43, 0)
    roof.rotation.y = Math.PI / 4
    ball(g, '#b99b7e', 0, 1.64, 0, 0.055, 0.065, 0.055)
    box(g, '#e1bfa0', 0, 0.4, -0.17, 0.65, 0.07, 0.25)
    box(g, '#d0ab8e', 0, 0.57, -0.27, 0.65, 0.19, 0.04)
    for (const x of [-0.25, 0.25]) {
      for (const z of [-0.25, -0.08]) box(g, WOOD, x, 0.24, z, 0.045, 0.28, 0.045)
    }
    return g
  },
  telescope() {
    const g = new THREE.Group()
    const brass = mat('#dfc18b', { metalness: 0.35, roughness: 0.42 })
    for (const [x, z] of [[-0.22, 0.16], [0.22, 0.16], [0, -0.24]]) {
      rod(g, '#b89d87', [x, 0.025, z], [0, 0.62, 0], 0.023)
      ball(g, '#b5a08c', x, 0.015, z, 0.03, 0.015, 0.03)
    }
    rod(g, brass, [0, 0.6, 0], [0, 0.79, 0], 0.035)
    rod(g, brass, [0, 0.73, -0.21], [0, 0.94, 0.17], 0.075)
    rod(g, '#b69a76', [0, 0.72, -0.23], [0, 0.75, -0.175], 0.046)
    rod(g, brass, [0, 0.925, 0.143], [0, 0.96, 0.206], 0.091)
    const lens = glowMat('#bcdce3', '#b3d8f7')
    rod(g, lens, [0, 0.961, 0.208], [0, 0.965, 0.215], 0.072)
    for (let i = 0; i < 3; i++) {
      const chart = box(g, i === 2 ? '#e8e1c5' : '#b8cbd9', 0.19, 0.02 + i * 0.018, 0.04, 0.18, 0.018, 0.22)
      chart.rotation.y = (i - 1) * 0.18
    }
    const map = piece(g, new THREE.TorusGeometry(0.047, 0.004, 4, 12), '#b3a8c1', 0.19, 0.05, 0.04)
    map.rotation.x = Math.PI / 2
    for (const [x, z] of [[0.15, 0.01], [0.22, 0.06], [0.18, 0.1]]) ball(g, '#a199b9', x, 0.055, z, 0.007)
    g.userData.glow = [lens]
    g.userData.glowBase = 0.04
    return g
  },
  onsen() {
    const g = new THREE.Group()
    const water = new THREE.MeshStandardMaterial({ color: '#a1d9d4', transparent: true, opacity: 0.78, roughness: 0.24 })
    const pool = piece(g, new THREE.CylinderGeometry(1, 1, 0.065, 20), water, -0.035, 0.08, 0)
    pool.scale.set(0.48, 1, 0.32)
    const bed = piece(g, new THREE.CylinderGeometry(1, 1, 0.055, 16), '#bfc7bc', -0.035, 0.028, 0)
    bed.scale.set(0.51, 1, 0.35)
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6
      const rock = ball(g, ['#c3c9c6', '#d3d4ca', '#b8c2bc'][i % 3], Math.cos(a) * 0.49 - 0.035, 0.105, Math.sin(a) * 0.345, 0.115, 0.105, 0.095)
      rock.rotation.y = -a
    }
    piece(g, new THREE.CylinderGeometry(0.105, 0.085, 0.14, 10), '#d8ba92', 0.51, 0.07, 0.22)
    for (const y of [0.04, 0.11]) {
      const hoop = piece(g, new THREE.TorusGeometry(0.096, 0.008, 4, 12), '#a18d76', 0.51, y, 0.22)
      hoop.rotation.x = Math.PI / 2
    }
    rod(g, '#d5b38c', [0.44, 0.15, 0.22], [0.58, 0.15, 0.22], 0.014)
    g.userData.owned = [water]
    steam(g, [[-0.24, 0.4, -0.08, 0.13], [0.02, 0.59, 0.04, 0.15], [0.22, 0.39, -0.07, 0.12]])
    return g
  },
  mochitsuki() {
    const g = new THREE.Group()
    const white = '#fbf7f0'
    for (const [x, z, s] of [[-0.19, -0.015, 1], [0.19, 0.01, 0.88]]) {
      const rabbit = new THREE.Group()
      ball(rabbit, white, 0, 0.16, 0, 0.09, 0.15, 0.085)
      ball(rabbit, white, 0, 0.35, 0.018, 0.095, 0.09, 0.08)
      for (const side of [-1, 1]) {
        const ear = ball(rabbit, white, side * 0.044, 0.49, 0.008, 0.029, 0.12, 0.028)
        ear.rotation.z = -side * 0.13
        ball(rabbit, '#f3bfcb', side * 0.044, 0.5, 0.033, 0.013, 0.082, 0.008)
        ball(rabbit, DARK, side * 0.035, 0.36, 0.092, 0.009)
        ball(rabbit, white, side * 0.045, 0.035, 0.05, 0.047, 0.035, 0.065)
      }
      ball(rabbit, '#e4a7b5', 0, 0.335, 0.101, 0.013, 0.009, 0.008)
      ball(rabbit, white, x < 0 ? 0.075 : -0.075, 0.25, 0.06, 0.04, 0.07, 0.04).rotation.z = x < 0 ? -0.6 : 0.6
      rabbit.position.set(x, 0, z)
      rabbit.scale.setScalar(s)
      g.add(rabbit)
    }
    piece(g, new THREE.CylinderGeometry(0.125, 0.105, 0.21, 10), '#c09a7c', 0, 0.105, 0.035)
    const rim = piece(g, new THREE.TorusGeometry(0.102, 0.025, 6, 12), '#e3c29d', 0, 0.215, 0.035)
    rim.rotation.x = Math.PI / 2
    ball(g, '#fff4dd', 0, 0.205, 0.035, 0.085, 0.025, 0.085)
    rod(g, '#b48f7a', [-0.14, 0.33, 0.065], [0.065, 0.58, 0.025], 0.018)
    rod(g, '#d3ae87', [-0.015, 0.59, 0.025], [0.135, 0.59, 0.025], 0.045)
    piece(g, new THREE.CylinderGeometry(0.1, 0.085, 0.025, 12), '#b6cfcb', 0, 0.013, 0.235)
    for (const x of [-0.045, 0.02, 0.055]) ball(g, white, x, 0.051, 0.235 + (x === 0.02 ? 0.03 : -0.015), 0.033, 0.027, 0.03)
    return g
  },
  koinobori() {
    const g = new THREE.Group()
    piece(g, new THREE.CylinderGeometry(0.11, 0.14, 0.055, 8), '#ded6bd', -0.18, 0.028, 0)
    rod(g, '#b5cc99', [-0.18, 0.04, 0], [-0.18, 1.14, 0], 0.022)
    pinwheel(g, -0.18, 1.18, 0.025, 0.095)
    const flags = new THREE.Group()
    flags.position.set(-0.18, 1.025, 0.025)
    ;['#8cbad9', '#e9969f', '#eab9d1'].forEach((color, i) => {
      const fish = new THREE.Group()
      fish.position.set(0, -i * 0.19, 0)
      fish.scale.setScalar(1 - i * 0.13)
      rod(fish, '#e2d6b6', [0, 0, 0], [0.085, 0, 0], 0.006)
      ball(fish, color, 0.22, 0, 0, 0.15, 0.062, 0.045)
      const tail = new THREE.Shape()
      tail.moveTo(0.32, 0)
      tail.lineTo(0.43, 0.065)
      tail.lineTo(0.405, 0)
      tail.lineTo(0.43, -0.065)
      tail.closePath()
      piece(fish, new THREE.ShapeGeometry(tail), mat(color, { side: THREE.DoubleSide }))
      ball(fish, '#fff8ed', 0.12, 0.018, 0.038, 0.025, 0.025, 0.008)
      ball(fish, DARK, 0.114, 0.019, 0.047, 0.012)
      for (let k = 0; k < 2; k++) {
        const scale = piece(fish, new THREE.TorusGeometry(0.024, 0.006, 4, 8, Math.PI), '#fff4e1', 0.22 + k * 0.055, 0, 0.044)
        scale.rotation.z = -Math.PI / 2
      }
      flags.add(fish)
    })
    g.add(flags)
    g.userData.sway = flags
    return g
  },
  hanami() {
    const g = new THREE.Group()
    box(g, '#e6c5be', 0, 0.012, 0, 0.6, 0.024, 0.4)
    for (let x = 0; x < 6; x++) {
      for (let z = 0; z < 4; z++) box(g, (x + z) % 2 ? '#f7eee4' : '#e99b9f', -0.25 + x * 0.1, 0.026, -0.15 + z * 0.1, 0.098, 0.008, 0.098)
    }
    for (let i = 0; i < 3; i++) box(g, i === 1 ? '#e9d9bc' : '#b97876', -0.115, 0.077 + i * 0.07, -0.035, 0.2, 0.063, 0.16)
    box(g, '#e1b38e', -0.115, 0.226, -0.035, 0.215, 0.018, 0.17)
    box(g, '#d4ac87', -0.115, 0.237, -0.035, 0.027, 0.008, 0.16)
    ball(g, '#a5c9bd', 0.15, 0.105, 0.035, 0.075, 0.07, 0.065)
    piece(g, new THREE.CylinderGeometry(0.049, 0.061, 0.015, 10), '#b7d6c8', 0.15, 0.17, 0.035)
    ball(g, '#d8d4af', 0.15, 0.188, 0.035, 0.015)
    rod(g, '#a5c9bd', [0.2, 0.11, 0.035], [0.255, 0.145, 0.035], 0.019)
    const handle = piece(g, new THREE.TorusGeometry(0.046, 0.011, 5, 12), '#a5c9bd', 0.095, 0.13, 0.035)
    handle.rotation.y = Math.PI / 2
    piece(g, new THREE.CylinderGeometry(0.03, 0.023, 0.045, 8), '#f8eacb', 0.1, 0.055, 0.14)
    ;[[-0.24, 0.13], [0.23, -0.13], [0.015, -0.15], [-0.2, -0.15], [0.24, 0.14]].forEach(([x, z], i) => {
      const petal = ball(g, '#f6c3d6', x, 0.037, z, 0.024, 0.005, 0.013)
      petal.rotation.y = i * 0.9
    })
    return g
  },
  tanabata() {
    const g = new THREE.Group()
    piece(g, new THREE.CylinderGeometry(0.12, 0.14, 0.055, 8), '#d7cfaf', 0, 0.028, 0)
    rod(g, '#9bc28d', [0, 0.045, 0], [0.015, 1.14, 0], 0.026)
    for (const y of [0.3, 0.58, 0.86]) {
      const node = piece(g, new THREE.TorusGeometry(0.028, 0.007, 4, 8), '#82ad7b', 0, y, 0)
      node.rotation.x = Math.PI / 2
    }
    const papers = []
    const colors = ['#eaa5b6', '#a5c7e9', '#f1d58c', '#c1acde', '#abd3aa']
    ;[[-0.23, 0.86, 0.015], [0.24, 0.99, 0], [-0.17, 1.12, -0.035], [0.13, 0.69, 0.025], [-0.25, 0.59, 0.02]].forEach(([x, y, z], i) => {
      rod(g, '#a3c992', [0, y - 0.18, 0], [x, y, z], 0.012)
      ball(g, '#b0d29b', x * 0.82, y - 0.035, z, 0.09, 0.02, 0.025).rotation.z = x > 0 ? 0.45 : -0.45
      const paper = new THREE.Group()
      rod(paper, '#e4d8bd', [0, 0, 0], [0, -0.065, 0], 0.004)
      box(paper, colors[i], 0, -0.14, 0, 0.065, 0.15, 0.009)
      paper.position.set(x, y, z + 0.025)
      papers.push(paper)
      g.add(paper)
    })
    for (let i = 0; i < 3; i++) {
      const folded = box(g, colors[(i + 2) % 5], 0.055, 0.87 - i * 0.08, 0.055, 0.055, 0.055, 0.012)
      folded.rotation.z = Math.PI / 4
    }
    g.userData.anim = (t) => papers.forEach((p, i) => { p.rotation.z = Math.sin(t * 1.3 + i) * 0.09 })
    return g
  },
  kakigori() {
    const g = new THREE.Group()
    for (const x of [-0.22, 0.22]) {
      for (const z of [-0.11, 0.11]) box(g, WOOD, x, 0.21, z, 0.045, 0.42, 0.045)
    }
    box(g, '#dfbb99', 0, 0.435, 0, 0.54, 0.06, 0.32)
    box(g, '#edceaa', 0, 0.33, 0.145, 0.47, 0.15, 0.035)
    rod(g, '#b6a18b', [-0.23, 0.43, -0.1], [-0.23, 1.05, -0.1], 0.014)
    for (let i = 0; i < 3; i++) box(g, ['#e89eaa', '#fff5e4', '#9cc8e2'][i], -0.17 + i * 0.105, 0.947, -0.1, 0.104, 0.17, 0.012)
    for (const [x, color] of [[-0.13, '#f1abbf'], [0.13, '#a3d8eb']]) {
      piece(g, new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#fff4df', x, 0.535, 0.025)
      piece(g, new THREE.CylinderGeometry(0.043, 0.055, 0.025, 10), '#c6d5d5', x, 0.477, 0.025)
      ball(g, '#f9fcf6', x, 0.555, 0.025, 0.09, 0.105, 0.09)
      ball(g, color, x, 0.607, 0.025, 0.085, 0.063, 0.085)
      rod(g, '#e7c9a0', [x + 0.03, 0.54, 0.025], [x + 0.063, 0.71, 0.025], 0.006)
    }
    return g
  },
  tsukimi() {
    const g = new THREE.Group()
    box(g, '#cda886', -0.075, 0.025, 0.025, 0.24, 0.05, 0.22)
    box(g, '#e0bd97', -0.075, 0.14, 0.025, 0.17, 0.18, 0.16)
    ball(g, '#a78871', -0.075, 0.145, 0.108, 0.025, 0.025, 0.005)
    box(g, '#eacdad', -0.075, 0.245, 0.025, 0.32, 0.035, 0.28)
    ;[[-0.08, 0.3, 0.02], [0, 0.3, 0.02], [0.08, 0.3, 0.02], [-0.04, 0.37, 0.02], [0.04, 0.37, 0.02], [0, 0.44, 0.02], [-0.04, 0.3, 0.09], [0.04, 0.3, 0.09]].forEach(([x, y, z]) => {
      ball(g, '#fff8e9', x - 0.075, y, z, 0.044)
    })
    ball(g, '#a8bdc4', 0.22, 0.125, -0.08, 0.075, 0.125, 0.07)
    piece(g, new THREE.CylinderGeometry(0.037, 0.045, 0.07, 8), '#a8bdc4', 0.22, 0.24, -0.08)
    ;[[0.13, 0.68, -0.1], [0.26, 0.78, -0.075], [0.31, 0.6, -0.065]].forEach(([x, y, z]) => {
      rod(g, '#bfbb8d', [0.22, 0.25, -0.08], [x, y, z], 0.006)
      const plume = ball(g, '#eee0b9', x, y, z, 0.027, 0.105, 0.027)
      plume.rotation.z = (0.22 - x) * 2
    })
    return g
  },
  yakiimo() {
    const g = new THREE.Group()
    ball(g, '#bba086', 0, 0.042, 0, 0.28, 0.042, 0.21)
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4
      const r = 0.12 + (i % 3) * 0.04
      const leaf = ball(g, ['#dda581', '#eac58a', '#ca8b83'][i % 3], Math.cos(a) * r, 0.055 + (i % 2) * 0.012, Math.sin(a) * r * 0.75, 0.075, 0.014, 0.035)
      leaf.rotation.y = a
      leaf.rotation.z = 0.1
    }
    const a = ball(g, '#a57e9a', -0.05, 0.105, 0.035, 0.145, 0.044, 0.052)
    a.rotation.y = 0.28
    const b = ball(g, '#b486a4', 0.06, 0.11, -0.04, 0.13, 0.045, 0.048)
    b.rotation.y = -0.55
    ball(g, '#f0d198', 0.085, 0.108, -0.004, 0.022, 0.035, 0.039).rotation.y = 0.28
    steam(g, [[-0.03, 0.23, -0.01, 0.052], [0, 0.35, -0.02, 0.059], [-0.025, 0.48, -0.02, 0.065]])
    return g
  },
  kamakura() {
    const g = new THREE.Group()
    const snow = mat('#eef5f5')
    const vertices = []
    const indices = []
    const levels = [0, 0.1, 0.21, 0.25, 0.29, 0.33, 0.355, 0.37, 0.43, 0.5, 0.56, 0.6, 0.62]
    const segments = 32
    // 雪殼沿著拱門邊緣接合，入口不留下鋸齒破口
    levels.forEach((y, row) => {
      const ring = Math.sqrt(Math.max(0, 1 - (y / 0.62) ** 2))
      const opening = y < 0.37 ? (y <= 0.21 ? 0.16 : Math.sqrt(Math.max(0, 0.16 ** 2 - (y - 0.21) ** 2))) : 0
      const start = ring ? Math.asin(opening / (0.5 * ring)) : 0
      for (let i = 0; i <= segments; i++) {
        const a = start + (Math.PI * 2 - start * 2) * i / segments
        vertices.push(Math.sin(a) * 0.5 * ring, y, Math.cos(a) * 0.4 * ring)
        if (row && i < segments) {
          const k = row * (segments + 1) + i
          indices.push(k, k - segments - 1, k + 1, k + 1, k - segments - 1, k - segments)
        }
      }
    })
    const dome = new THREE.BufferGeometry()
    dome.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    dome.setIndex(indices)
    dome.computeVertexNormals()
    piece(g, dome, snow)
    const arch = new THREE.Shape()
    arch.moveTo(-0.25, 0)
    arch.lineTo(-0.25, 0.21)
    arch.absarc(0, 0.21, 0.25, Math.PI, 0, true)
    arch.lineTo(0.25, 0)
    arch.lineTo(0.16, 0)
    arch.lineTo(0.16, 0.21)
    arch.absarc(0, 0.21, 0.16, 0, Math.PI, false)
    arch.lineTo(-0.16, 0)
    arch.closePath()
    piece(g, new THREE.ExtrudeGeometry(arch, { depth: 0.16, bevelEnabled: false, curveSegments: 8 }), snow, 0, 0, 0.3)
    const warm = glowMat('#f7d7a1', '#ffbf65')
    piece(g, new THREE.PlaneGeometry(0.32, 0.37), warm, 0, 0.185, 0.18)
    box(g, '#d5bda1', 0, 0.023, 0.31, 0.3, 0.045, 0.3)
    g.userData.glow = [warm]
    g.userData.glowBase = 0.08
    return g
  },
  kadomatsu() {
    const g = new THREE.Group()
    for (const side of [-1, 1]) {
      const x = side * 0.2
      piece(g, new THREE.CylinderGeometry(0.12, 0.125, 0.18, 10), '#cbb48a', x, 0.09, 0)
      for (const y of [0.065, 0.135]) {
        const rope = piece(g, new THREE.TorusGeometry(0.122, 0.012, 5, 12), '#e1cca1', x, y, 0)
        rope.rotation.x = Math.PI / 2
      }
      ;[[-0.047, 0.57, 0.015], [0, 0.8, -0.035], [0.047, 0.66, 0.025]].forEach(([dx, h, z]) => {
        const bamboo = new THREE.CylinderGeometry(0.034, 0.038, h, 8)
        const vertices = bamboo.attributes.position
        for (let i = 0; i < vertices.count; i++) {
          if (vertices.getY(i) > 0) vertices.setY(i, vertices.getY(i) + vertices.getX(i) * 0.8)
        }
        bamboo.computeVertexNormals()
        piece(g, bamboo, '#9fc98f', x + dx, h / 2, z)
        const cut = piece(g, new THREE.CircleGeometry(0.025, 8), '#e0e4b3', x + dx, h + 0.001, z)
        cut.rotation.set(-Math.PI / 2, 0, Math.atan(0.8), 'ZXY')
        const node = piece(g, new THREE.TorusGeometry(0.037, 0.007, 4, 8), '#81aa77', x + dx, h * 0.54, z)
        node.rotation.x = Math.PI / 2
      })
      for (const s of [-1, 1]) {
        const pine = ball(g, '#8ab391', x + s * 0.06, 0.27, 0.045, 0.075, 0.1, 0.055)
        pine.rotation.z = -s * 0.55
      }
      ball(g, '#df9c95', x, 0.2, 0.12, 0.025)
    }
    return g
  },
  manekineko() {
    const g = new THREE.Group()
    const fur = '#fcf7eb'
    ball(g, fur, 0, 0.23, 0, 0.18, 0.22, 0.145)
    ball(g, fur, 0, 0.52, 0.015, 0.155, 0.145, 0.125)
    for (const s of [-1, 1]) {
      piece(g, new THREE.ConeGeometry(0.052, 0.12, 4), fur, s * 0.102, 0.657, 0)
      piece(g, new THREE.ConeGeometry(0.026, 0.07, 4), '#edb4bd', s * 0.102, 0.655, 0.036)
      ball(g, fur, s * 0.09, 0.045, 0.065, 0.075, 0.045, 0.09)
      const eye = piece(g, new THREE.TorusGeometry(0.023, 0.006, 4, 10, Math.PI), DARK, s * 0.055, 0.54, 0.135)
      rod(g, '#b6a69c', [s * 0.07, 0.485, 0.13], [s * 0.12, 0.48, 0.12], 0.004)
      eye.rotation.z = 0.1 * s
    }
    ball(g, '#e7a4ae', 0, 0.505, 0.144, 0.016, 0.011, 0.01)
    const collar = piece(g, new THREE.TorusGeometry(0.123, 0.022, 6, 16), '#e49595', 0, 0.405, 0)
    collar.rotation.x = Math.PI / 2
    ball(g, '#e7c578', 0, 0.393, 0.146, 0.034)
    box(g, '#ac8c63', 0, 0.384, 0.177, 0.018, 0.004, 0.003)
    ball(g, fur, 0.19, 0.485, 0.025, 0.063, 0.13, 0.063).rotation.z = -0.14
    ball(g, fur, 0.205, 0.625, 0.037, 0.066, 0.065, 0.059)
    ball(g, '#e8c4c4', 0.205, 0.625, 0.092, 0.026, 0.032, 0.009)
    ball(g, fur, -0.17, 0.3, 0.04, 0.055, 0.095, 0.055).rotation.z = -0.5
    const coin = piece(g, new THREE.CylinderGeometry(0.067, 0.067, 0.019, 12), '#e4c47e', -0.085, 0.225, 0.14)
    coin.rotation.x = Math.PI / 2
    coin.scale.z = 1.3
    const tail = piece(g, new THREE.TorusGeometry(0.095, 0.028, 6, 12, Math.PI), fur, -0.095, 0.1, -0.1)
    tail.rotation.x = -Math.PI / 2
    return g
  },
  daruma() {
    const g = new THREE.Group()
    ball(g, '#de8b89', 0, 0.29, 0, 0.255, 0.29, 0.21)
    ball(g, '#f8ead6', 0, 0.405, 0.173, 0.182, 0.137, 0.043)
    for (const s of [-1, 1]) {
      ball(g, '#fff7e9', s * 0.069, 0.435, 0.213, 0.039, 0.04, 0.009)
      const brow = piece(g, new THREE.TorusGeometry(0.045, 0.01, 4, 10, Math.PI), '#695e5e', s * 0.069, 0.46, 0.208)
      brow.rotation.z = -s * 0.2
      rod(g, '#867166', [s * 0.02, 0.372, 0.217], [s * 0.067, 0.355, 0.213], 0.009)
    }
    ball(g, DARK, -0.069, 0.435, 0.225, 0.023, 0.027, 0.009)
    piece(g, new THREE.TorusGeometry(0.033, 0.004, 4, 12), '#baaaa0', 0.069, 0.435, 0.224)
    box(g, '#a48073', 0, 0.338, 0.211, 0.045, 0.01, 0.007)
    for (const x of [-0.095, 0, 0.095]) {
      const stripe = box(g, '#efcd94', x, 0.18, 0.188, 0.022, 0.11, 0.012)
      stripe.rotation.z = x * 2
    }
    return g
  },
  kingyo() {
    const g = new THREE.Group()
    const glass = new THREE.MeshPhysicalMaterial({ color: '#d6edf1', roughness: 0.08, transmission: 0.18, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })
    const water = new THREE.MeshStandardMaterial({ color: '#b6e0e5', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, roughness: 0.2 })
    piece(g, new THREE.CylinderGeometry(0.115, 0.13, 0.04, 12), '#ccdcd7', 0, 0.02, 0)
    piece(g, new THREE.SphereGeometry(0.25, 20, 12, 0, Math.PI * 2, 0.9, Math.PI - 0.9), glass, 0, 0.29, 0)
    const rim = piece(g, new THREE.TorusGeometry(Math.sin(0.9) * 0.25, 0.01, 6, 20), glass, 0, 0.29 + Math.cos(0.9) * 0.25, 0)
    rim.rotation.x = Math.PI / 2
    const surface = piece(g, new THREE.CircleGeometry(0.235, 20), water, 0, 0.375, 0)
    surface.rotation.x = -Math.PI / 2
    const fish = []
    for (const [x, y, z, color, angle] of [[-0.075, 0.235, 0.06, '#ee978a', 0.2], [0.075, 0.305, -0.045, '#e8a274', Math.PI + 0.4]]) {
      const f = new THREE.Group()
      ball(f, color, 0, 0, 0, 0.062, 0.028, 0.027)
      const tail = piece(f, new THREE.ConeGeometry(0.036, 0.06, 3), color, -0.075, 0, 0)
      tail.rotation.z = -Math.PI / 2
      ball(f, '#f8d6b1', 0.005, 0.028, 0, 0.026, 0.018, 0.006)
      ball(f, DARK, 0.033, 0.007, 0.025, 0.006)
      f.position.set(x, y, z)
      f.rotation.y = angle
      fish.push({ f, y, angle })
      g.add(f)
    }
    rod(g, '#95b992', [-0.08, 0.07, -0.075], [-0.07, 0.3, -0.075], 0.006)
    for (let i = 0; i < 3; i++) {
      const leaf = ball(g, '#a5cb9f', -0.075 + (i % 2 ? 0.025 : -0.025), 0.14 + i * 0.055, -0.075, 0.023, 0.055, 0.009)
      leaf.rotation.z = i % 2 ? -0.5 : 0.5
    }
    for (const x of [-0.075, 0, 0.065]) ball(g, '#e4d9bf', x, 0.07, 0, 0.035, 0.018, 0.028)
    g.userData.owned = [glass, water]
    g.userData.anim = (t) => fish.forEach(({ f, y, angle }, i) => {
      f.position.y = y + Math.sin(t * 1.2 + i * 2) * 0.012
      f.rotation.y = angle + Math.sin(t * 0.8 + i) * 0.2
    })
    return g
  },
  shishiodoshi() {
    const g = new THREE.Group()
    ball(g, '#c7cbc1', 0, 0.045, 0.01, 0.29, 0.045, 0.22)
    for (const x of [-0.1, 0.1]) rod(g, '#9cbc8b', [x, 0.065, 0], [x, 0.42, 0], 0.023)
    rod(g, '#c3ad8c', [-0.14, 0.37, 0], [0.14, 0.37, 0], 0.016)
    const tube = new THREE.Group()
    const bamboo = piece(tube, new THREE.CylinderGeometry(0.049, 0.052, 0.44, 9, 1, true), mat('#b3ce98', { side: THREE.DoubleSide }), 0, 0.02, 0.025)
    bamboo.rotation.x = Math.PI / 2
    piece(tube, new THREE.TorusGeometry(0.05, 0.007, 5, 10), '#dfdfaf', 0, 0.02, 0.245)
    piece(tube, new THREE.CircleGeometry(0.043, 9), '#789577', 0, 0.02, 0.2)
    const back = piece(tube, new THREE.CircleGeometry(0.051, 9), mat('#acc58f', { side: THREE.DoubleSide }), 0, 0.02, -0.195)
    back.rotation.y = Math.PI
    tube.position.y = 0.37
    tube.rotation.x = -0.1
    g.add(tube)
    rod(g, '#9cba89', [0, 0.06, -0.19], [0, 0.65, -0.19], 0.023)
    rod(g, '#b2cc95', [0, 0.65, -0.2], [0, 0.65, -0.035], 0.027)
    const water = new THREE.MeshStandardMaterial({ color: '#d0eaed', transparent: true, opacity: 0.65, roughness: 0.2 })
    rod(g, water, [0, 0.635, -0.035], [0, 0.435, -0.035], 0.006)
    ball(g, '#aebbb2', 0, 0.09, 0.2, 0.07, 0.045, 0.05)
    g.userData.owned = [water]
    g.userData.tip = tube
    return g
  },
  ema() {
    const g = new THREE.Group()
    frame(g, 0.96, 0.55)
    box(g, '#caa88a', 0, 0.54, 0, 0.59, 0.035, 0.04)
    for (const x of [-0.275, 0.275]) box(g, '#c7a68c', x, 0.025, 0, 0.13, 0.05, 0.26)
    ;[[-0.18, 0.75], [0, 0.75], [0.18, 0.75], [-0.09, 0.37], [0.09, 0.37]].forEach(([x, y], i) => {
      const plaque = new THREE.Shape()
      plaque.moveTo(-0.065, -0.06)
      plaque.lineTo(0.065, -0.06)
      plaque.lineTo(0.065, 0.025)
      plaque.lineTo(0, 0.075)
      plaque.lineTo(-0.065, 0.025)
      plaque.closePath()
      rod(g, '#e6d0a8', [x, y + 0.06, 0.035], [x, y + 0.16, 0], 0.005)
      piece(g, new THREE.ExtrudeGeometry(plaque, { depth: 0.018, bevelEnabled: false }), i % 2 ? '#ecd4b1' : '#dfbd97', x, y, 0.025)
      ball(g, ['#dba4b2', '#a0bba2', '#b4b5d5'][i % 3], x - 0.015, y, 0.048, 0.025, 0.022, 0.004)
      box(g, '#c99c80', x + 0.027, y - 0.022, 0.048, 0.007, 0.036, 0.005)
    })
    return g
  },
  kokeshi() {
    const g = new THREE.Group()
    for (const [x, s, color] of [[-0.14, 1, '#d99b9c'], [0.145, 0.73, '#a7c5c1']]) {
      const doll = new THREE.Group()
      piece(doll, new THREE.CylinderGeometry(0.083, 0.106, 0.33, 12), color, 0, 0.165, 0)
      piece(doll, new THREE.CylinderGeometry(0.109, 0.109, 0.028, 12), '#d9b997', 0, 0.014, 0)
      ball(doll, '#f3dbb8', 0, 0.45, 0, 0.13, 0.125, 0.12)
      const hair = piece(doll, new THREE.SphereGeometry(0.134, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#6d6268', 0, 0.467, 0)
      hair.scale.z = 0.93
      box(doll, '#6d6268', 0, 0.473, 0.106, 0.18, 0.025, 0.025)
      for (const side of [-1, 1]) {
        ball(doll, DARK, side * 0.041, 0.447, 0.115, 0.009, 0.013, 0.004)
        ball(doll, '#e8b4aa', side * 0.067, 0.416, 0.101, 0.018, 0.008, 0.004)
      }
      box(doll, '#ba8b83', 0, 0.402, 0.113, 0.017, 0.005, 0.005)
      rod(doll, '#c3a477', [0.02, 0.09, 0.1], [-0.02, 0.255, 0.091], 0.005)
      for (let i = 0; i < 3; i++) ball(doll, '#f9e5c5', (i % 2 ? 0.015 : -0.02), 0.15 + i * 0.05, 0.103, 0.022, 0.019, 0.005)
      doll.position.set(x, 0, 0)
      doll.scale.setScalar(s)
      g.add(doll)
    }
    return g
  },
}

// 看不見的點擊範圍：小物件（蘑菇、南瓜）也好點
const HIT_GEO = new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0)
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false })

export const buildItem = (key) => shadowed(BUILD[key]?.() || BUILD.mushroom())

// 每件裝飾的佔地半徑（大型的東屋、溫泉、雪屋比較寬）
const BASE_R = 0.42
const radiusOf = (key) => SHOP_ITEMS.find((i) => i.key === key)?.r || BASE_R

// 擺放位置是否空著（島內、避開池塘花圃小徑塔位裝飾與其他擺設）；blocked：升級景觀的佔地 [x, z, r]
export function spotFree(x, z, placed = [], ignoreId = null, key = null, blocked = []) {
  const { pond, bed, home, slots, decor, radius } = LAYOUT
  const r = radiusOf(key)
  const e = r - BASE_R
  if (Math.hypot(x, z) > radius - 0.8 - e) return false
  if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 0.45 + e) return false
  if (Math.hypot(x - bed.x, z - bed.z) < bed.r + 0.4 + e) return false
  if (Math.hypot(x - home.x, z - home.z) < 1.1 + e) return false
  if (Math.abs(x) < 0.8 + e && z > 2.1) return false
  for (const [sx, sz] of slots) if (Math.hypot(x - sx, z - sz) < 1.5 + e) return false
  for (const [dx, dz] of decor) if (Math.hypot(x - dx, z - dz) < 1.15 + e) return false
  for (const [bx, bz, br] of blocked) if (Math.hypot(x - bx, z - bz) < br + r) return false
  for (const p of placed) if (p.id !== ignoreId && Math.hypot(x - p.x, z - p.z) < r + radiusOf(p.key) + 0.01) return false
  return true
}

export class Placed {
  constructor(world, sky) {
    this.world = world
    this.sky = sky
    this.group = new THREE.Group()
    world.scene.add(this.group)
    world.addPickable(this.group)
    this.items = new Map()
    this.ghost = null
    world.add((dt, t) => this.update(dt, t))
  }

  // 第一次同步之後才新出現的物件會播彈出動畫
  sync(list) {
    const ids = new Set(list.map((p) => p.id))
    for (const [id, obj] of this.items) {
      if (ids.has(id)) continue
      this.items.delete(id)
      tween(0.4, (k) => obj.scale.setScalar(Math.max(0.001, 1 - k)), { onDone: () => this._dispose(obj) })
    }
    for (const p of list) {
      let obj = this.items.get(p.id)
      if (!obj || obj.userData.key !== p.key) {
        if (obj) this._dispose(obj)
        obj = buildItem(p.key)
        obj.userData.key = p.key
        obj.userData.pick = { type: 'placed', id: p.id }
        const hit = new THREE.Mesh(HIT_GEO, HIT_MAT)
        hit.userData.shared = true
        obj.add(hit)
        this.group.add(obj)
        this.items.set(p.id, obj)
        if (this._ready) {
          obj.scale.setScalar(0.001)
          tween(0.8, (k) => obj.scale.setScalar(Math.max(0.001, k)), { easing: ease.outBack })
        }
      }
      obj.position.set(p.x, 0, p.z)
      obj.rotation.y = p.rot || 0
      obj.visible = p.id !== this.hiddenId
    }
    this._ready = true
  }

  _dispose(obj) {
    this.group.remove(obj)
    obj.traverse((o) => {
      if (!o.userData.shared) o.geometry?.dispose()
    })
    for (const m of new Set([...(obj.userData.glow || []), ...(obj.userData.owned || [])])) m.dispose()
  }

  anchor(id) {
    const o = this.items.get(id)
    if (!o) return null
    const box = new THREE.Box3().setFromObject(o)
    return new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.2, (box.min.z + box.max.z) / 2)
  }

  // ── 擺放預覽 ──
  startGhost(key, rot = 0) {
    this.endGhost()
    const g = buildItem(key)
    g.traverse((o) => {
      if (!o.isMesh) return
      o.material = o.material.clone()
      o.material.transparent = true
      o.material.opacity = 0.6
      o.material.depthWrite = false
      o.castShadow = false
    })
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 36),
      new THREE.MeshBasicMaterial({ color: '#8fd8b5', transparent: true, opacity: 0.9, depthWrite: false }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    const root = new THREE.Group()
    root.add(g, ring)
    root.rotation.y = rot
    root.visible = false
    this.ghost = { root, ring, rot }
    this.group.add(root)
  }
  moveGhost(x, z, ok) {
    if (!this.ghost) return
    this.ghost.root.visible = true
    this.ghost.root.position.set(x, 0, z)
    this.ghost.ring.material.color.set(ok ? '#8fd8b5' : '#f4a0a8')
  }
  rotateGhost(step = Math.PI / 4) {
    if (!this.ghost) return 0
    this.ghost.rot += step
    this.ghost.root.rotation.y = this.ghost.rot
    return this.ghost.rot
  }
  endGhost() {
    if (!this.ghost) return
    this.group.remove(this.ghost.root)
    this.ghost.root.traverse((o) => {
      o.geometry?.dispose()
      if (o.isMesh) o.material.dispose()
    })
    this.ghost = null
  }

  update(dt, t) {
    const night = this.sky.night
    for (const o of this.items.values()) {
      const u = o.userData
      if (u.glow) for (const m of u.glow) m.emissiveIntensity = (u.glowBase ?? 0.25) + night * 1.8
      if (u.sway) u.sway.rotation.z = Math.sin(t * 1.6 + o.position.x) * 0.12
      if (u.breathe) u.breathe.scale.y = 0.75 + Math.sin(t * 1.5) * 0.025
      if (u.spin) for (const rotor of u.spin) rotor.rotation.z += dt * 3
      if (u.tip) {
        const phase = ((t % 6) + 6) % 6 / 6
        u.tip.rotation.x = phase < 0.8 ? -0.1 + 0.65 * (phase / 0.8) ** 2
          : phase < 0.86 ? 0.55 : 0.55 - 0.65 * ease.outCubic((phase - 0.86) / 0.14)
      }
      u.anim?.(t, dt, night)
    }
    if (this.ghost) this.ghost.ring.scale.setScalar(1 + Math.sin(t * 5) * 0.05)
  }
}

// 商店縮圖：用一個小的離屏渲染器把每件裝飾拍成圖片（只做一次）
let thumbCache = null
export function renderThumbnails(keys) {
  if (thumbCache) return thumbCache
  thumbCache = {}
  const size = 160
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  r.setSize(size, size)
  r.outputColorSpace = THREE.SRGBColorSpace
  r.toneMapping = THREE.NeutralToneMapping
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#ffffff', '#f3e2d6', 2.2))
  const sun = new THREE.DirectionalLight('#ffffff', 1.6)
  sun.position.set(2, 3, 4)
  scene.add(sun)
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  for (const key of keys) {
    const obj = buildItem(key)
    const box = new THREE.Box3().setFromObject(obj)
    const c = box.getCenter(new THREE.Vector3())
    const s = box.getSize(new THREE.Vector3()).length()
    obj.position.sub(c)
    obj.rotation.y = -0.5
    scene.add(obj)
    cam.position.set(0, s * 0.55, s * 1.75)
    cam.lookAt(0, 0, 0)
    r.render(scene, cam)
    thumbCache[key] = r.domElement.toDataURL('image/png')
    scene.remove(obj)
    obj.traverse((o) => o.geometry?.dispose())
    for (const m of new Set([...(obj.userData.glow || []), ...(obj.userData.owned || [])])) m.dispose()
  }
  r.dispose()
  r.forceContextLoss()
  return thumbCache
}
