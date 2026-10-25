import * as THREE from 'three'
import { mat, shadowed, tween, ease } from './util.js'
import { LAYOUT } from './island.js'

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
}

// 看不見的點擊範圍：小物件（蘑菇、南瓜）也好點
const HIT_GEO = new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0)
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false })

export const buildItem = (key) => shadowed(BUILD[key]?.() || BUILD.mushroom())

// 擺放位置是否空著（島內、避開池塘花圃小徑塔位裝飾與其他擺設）
export function spotFree(x, z, placed = [], ignoreId = null) {
  const { pond, bed, home, slots, decor, radius } = LAYOUT
  if (Math.hypot(x, z) > radius - 0.8) return false
  if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 0.45) return false
  if (Math.hypot(x - bed.x, z - bed.z) < bed.r + 0.4) return false
  if (Math.hypot(x - home.x, z - home.z) < 1.1) return false
  if (Math.abs(x) < 0.8 && z > 2.1) return false
  for (const [sx, sz] of slots) if (Math.hypot(x - sx, z - sz) < 1.5) return false
  for (const [dx, dz] of decor) if (Math.hypot(x - dx, z - dz) < 1.15) return false
  for (const p of placed) if (p.id !== ignoreId && Math.hypot(x - p.x, z - p.z) < 0.85) return false
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
    for (const m of obj.userData.glow || []) m.dispose()
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
  }
  r.dispose()
  r.forceContextLoss()
  return thumbCache
}
