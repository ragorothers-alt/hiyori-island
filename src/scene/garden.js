import * as THREE from 'three'
import { LAYOUT } from './island.js'
import { tagOf } from '../theme.js'
import { tween, ease, hash, mat, cancelTween } from './util.js'
import { flowerOf, COMMON_BY_TAG } from '../data/flowers.js'

// 花圃：當天每個任務 = 一株植物。未完成是花苞，完成就綻放。
const CLOSED = 1.32
const OPEN = 0.3
const GREEN = new THREE.Color('#a9d79a')
const WHITE = new THREE.Color('#ffffff')
const DRY = new THREE.Color('#cdb9a2')
const RAINBOW = ['#f7a1a8', '#f8c48f', '#f6e08c', '#a8dba0', '#8fcbea', '#a7a9ec', '#d4a6e6']

const stemGeo = new THREE.CylinderGeometry(0.022, 0.034, 0.56, 5)
stemGeo.translate(0, 0.28, 0)
const leafGeo = new THREE.SphereGeometry(0.12, 7, 4)
leafGeo.scale(1.1, 0.22, 0.48)
leafGeo.translate(0.11, 0, 0)
const petalGeo = new THREE.SphereGeometry(0.1, 10, 6)
petalGeo.scale(1.3, 0.3, 0.74)
petalGeo.translate(0.12, 0, 0)
// 圖鑑花的花瓣形狀（平面外形擠出薄片，平躺在 XZ 平面、朝 +x 伸出）
function petalShape(draw) {
  const sh = new THREE.Shape()
  draw(sh)
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.014, bevelEnabled: false })
  g.translate(0, 0, -0.007)
  g.rotateX(-Math.PI / 2)
  return g
}
const PETAL_GEOS = {
  round: petalGeo,
  pointed: petalShape((sh) => {
    sh.moveTo(0, 0)
    sh.quadraticCurveTo(0.13, 0.085, 0.27, 0)
    sh.quadraticCurveTo(0.13, -0.085, 0, 0)
  }),
  heart: petalShape((sh) => {
    sh.moveTo(0, 0)
    sh.bezierCurveTo(0.05, 0.11, 0.21, 0.12, 0.25, 0.05)
    sh.lineTo(0.215, 0)
    sh.lineTo(0.25, -0.05)
    sh.bezierCurveTo(0.21, -0.12, 0.05, -0.11, 0, 0)
  }),
  thin: petalShape((sh) => {
    sh.moveTo(0, 0)
    sh.quadraticCurveTo(0.15, 0.036, 0.3, 0.005)
    sh.lineTo(0.3, -0.005)
    sh.quadraticCurveTo(0.15, -0.036, 0, 0)
  }),
  star: petalShape((sh) => {
    sh.moveTo(0, 0.075)
    sh.lineTo(0.29, 0)
    sh.lineTo(0, -0.075)
    sh.lineTo(0, 0.075)
  }),
}
// 任務完成後開出的那朵花的外型（舊任務沒有紀錄時用分類的常見花）
const lookOf = (task) => {
  const f = flowerOf(task.flower) || flowerOf(COMMON_BY_TAG[task.tag]) || flowerOf('nadeshiko')
  return { key: f.key, ...f.look }
}
const coreGeo = new THREE.SphereGeometry(0.065, 10, 8)
const moundGeo = new THREE.SphereGeometry(0.17, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)
moundGeo.scale(1, 0.4, 1)

// 本命：花苞上方飄著一顆小金星
const starShape = new THREE.Shape()
for (let i = 0; i < 10; i++) {
  const r = i % 2 ? 0.045 : 0.11
  const a = (i / 10) * Math.PI * 2 + Math.PI / 2
  if (i) starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  else starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r)
}
const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 })
starGeo.center()
const starMat = new THREE.MeshStandardMaterial({ color: '#ffd76e', emissive: '#ffbf3c', emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.2 })

function plotPosition(i) {
  const { bed } = LAYOUT
  const max = 13
  if (i < max) {
    const r = 0.64 * Math.sqrt(i + 0.5)
    const a = i * 2.39996 + 0.4
    return new THREE.Vector3(bed.x + Math.cos(a) * r, 0.1, bed.z + Math.sin(a) * r)
  }
  // 花圃滿了：沿著擴島前的島緣那一圈種（外圈留給塔）
  const k = i - max
  const a = 0.15 + k * 0.23
  const R = 8.6 - (k % 2) * 0.35
  return new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)
}

class Plant {
  constructor(task, pos, today = null) {
    this.id = task.id
    const g = (this.group = new THREE.Group())
    g.position.copy(pos)
    g.rotation.y = hash(task.id) * Math.PI * 2
    g.userData.pick = { type: 'task', id: task.id }

    g.add(new THREE.Mesh(moundGeo, mat('#d9bba0')))
    const stemMat = mat('#82c08c')
    this.stem = new THREE.Mesh(stemGeo, stemMat)
    g.add(this.stem)
    for (const [y, rot] of [[0.14, 0.3], [0.26, Math.PI + 0.5]]) {
      const leaf = new THREE.Mesh(leafGeo, mat('#9ed69a'))
      leaf.position.y = y
      leaf.rotation.set(0, rot, 0.35)
      g.add(leaf)
    }

    this.head = new THREE.Group()
    this.head.position.y = 0.56
    g.add(this.head)
    this.petalMat = new THREE.MeshStandardMaterial({ roughness: 0.55, emissiveIntensity: 0.16 })
    this.innerMat = new THREE.MeshStandardMaterial({ roughness: 0.55, emissiveIntensity: 0.2 })
    this.core = new THREE.Mesh(coreGeo, new THREE.MeshStandardMaterial({ color: '#ffe59b', roughness: 0.6, emissive: '#ffd56b', emissiveIntensity: 0.15 }))
    this.head.add(this.core)
    this.pivots = []
    this.phase = hash(task.id + 'p') * 6
    this.starMark = new THREE.Mesh(starGeo, starMat)
    this.starMark.position.y = 0.95
    this.starMark.scale.setScalar(0.001)
    this.starMark.visible = false
    g.add(this.starMark)
    this.wilt = 0
    this.apply(task, true, today)
    this.group.traverse((o) => {
      if (o.isMesh) o.castShadow = true
    })
  }

  // look = null：還沒完成的花苞（依優先度）；否則照圖鑑那朵花的外型
  _buildPetals(priority, look) {
    const key = look ? look.key : 'bud' + priority
    if (key === this._shapeKey) return
    this._shapeKey = key
    for (const p of this.pivots) this.head.remove(p)
    this.pivots = []
    this._disposeRainbow()
    let layers
    let geo = petalGeo
    if (!look) {
      layers = priority === 3 ? [[8, 1, this.petalMat, 0], [5, 0.72, this.innerMat, 0.3]] : [[5 + (priority === 2 ? 1 : 0), 1, this.petalMat, 0]]
    } else {
      geo = PETAL_GEOS[look.shape] || petalGeo
      layers = [[look.petals, 1, this.petalMat, 0]]
      if (look.inner) layers.push([look.inner, 0.72, this.innerMat, Math.PI / look.inner])
      if (look.rainbow) {
        this.rainbowMats = RAINBOW.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: c, emissiveIntensity: 0.2 }))
      }
    }
    for (const [n, s, m, off] of layers) {
      for (let i = 0; i < n; i++) {
        const pivot = new THREE.Object3D()
        const outer = s === 1
        const petal = new THREE.Mesh(geo, outer && this.rainbowMats ? this.rainbowMats[i % this.rainbowMats.length] : m)
        petal.scale.setScalar(s)
        petal.castShadow = true
        pivot.add(petal)
        pivot.userData = { yaw: (i / n) * Math.PI * 2 + off, inner: !outer }
        this.head.add(pivot)
        this.pivots.push(pivot)
      }
    }
  }

  _disposeRainbow() {
    for (const m of this.rainbowMats || []) m.dispose()
    this.rainbowMats = null
  }

  _setOpen(k) {
    this.open = k
    const open = this.look?.open ?? OPEN
    const tilt = CLOSED + (open - CLOSED) * k
    for (const p of this.pivots) {
      const t = p.userData.inner ? tilt + 0.35 * k : tilt
      p.rotation.set(0, p.userData.yaw, t)
    }
    const c = this.color
    this.petalMat.color.copy(GREEN).lerp(c, 0.45 + 0.55 * Math.min(1, k))
    this.petalMat.emissive.copy(c)
    this.innerMat.color.copy(this.innerColor)
    this.innerMat.emissive.copy(this.innerColor)
    this.core.scale.setScalar(0.4 + 0.6 * Math.min(1, k))
    this.head.scale.setScalar((0.72 + 0.28 * k) * (this.look?.size || 1))
    // 逾期垂下：花瓣褪色、莖往前彎
    const w = this.wilt
    if (w) {
      this.petalMat.color.lerp(DRY, w * 0.55)
      this.innerMat.color.lerp(DRY, w * 0.45)
    }
    const lean = w * 0.32
    this.stem.rotation.x = lean
    this.stem.scale.y = 0.82 + 0.18 * Math.min(1, k)
    this.head.position.y = (0.46 + 0.1 * Math.min(1, k)) * Math.cos(lean) - w * 0.05
    this.head.position.z = Math.sin(lean) * 0.5
  }

  // 逾期幾天：1 天就開始垂，3 天最垂；完成或改到今天就慢慢挺回來
  _setWilt(target, instant) {
    if (target === this._wiltTarget) return
    this._wiltTarget = target
    cancelTween(this._wiltTw)
    if (instant) {
      this.wilt = target
      this._setOpen(this.open ?? 0)
      return
    }
    const from = this.wilt
    this._wiltTw = tween(target ? 0.8 : 1.4, (k) => {
      this.wilt = from + (target - from) * k
      this._setOpen(this.open)
    }, { easing: target ? ease.inOutCubic : ease.outBack })
  }

  apply(task, instant = false, today = null) {
    const look = task.done ? lookOf(task) : null
    this.look = look
    this.color = new THREE.Color(look ? look.colors[0] : tagOf(task.tag).color)
    this.innerColor = look ? new THREE.Color(look.colors[1]) : this.color.clone().lerp(WHITE, 0.45)
    this.core.material.color.set(look ? look.core : '#ffe59b')
    this.core.material.emissive.set(look ? look.core : '#ffd56b')
    this._buildPetals(task.priority, look)
    // 每完成一輪專注，花就長大一點（最多 +40%）
    const grow = 1 + Math.min(task.pomos || 0, 4) * 0.1
    this.group.scale.setScalar(([0.85, 1, 1.25][task.priority - 1] || 1) * 1.65 * grow)
    this.baseScale = this.group.scale.x
    this._setStar(task.star && !task.done, instant)
    const late = !task.done && today && task.date < today ? Math.round((new Date(today) - new Date(task.date)) / 86400000) : 0
    this._setWilt(late ? Math.min(1, 0.4 + late * 0.2) : 0, instant)
    const target = task.done ? 1 : 0
    if (instant) {
      this._setOpen(target)
    } else if (target !== this._target) {
      cancelTween(this._tw)
      const from = this.open
      this._tw = tween(target ? 1.2 : 0.6, (k) => this._setOpen(from + (target - from) * k), { easing: target ? ease.outBack : ease.inOutCubic })
    } else {
      this._setOpen(this.open)
    }
    this._target = target
  }

  _setStar(on, instant) {
    if (on === this._star) return
    this._star = on
    cancelTween(this._starTw)
    const m = this.starMark
    const from = m.scale.x
    const to = on ? 1 : 0.001
    m.visible = true
    if (instant) {
      m.scale.setScalar(to)
      m.visible = on
      return
    }
    this._starTw = tween(on ? 0.6 : 0.35, (k) => m.scale.setScalar(Math.max(0.001, from + (to - from) * k)), {
      easing: on ? ease.outBack : ease.inOutCubic,
      onDone: () => (m.visible = on),
    })
  }

  update(t, night = 0) {
    if (this.starMark.visible) {
      this.starMark.rotation.y = t * 1.6 + this.phase
      this.starMark.position.y = 0.95 + Math.sin(t * 2 + this.phase) * 0.04
    }
    // 會發光的花（月見草、星之花…）晚上更亮
    const glow = (this.look?.glow || 0) * this.open
    this.petalMat.emissiveIntensity = 0.16 + night * 0.5 * this.open + glow * (0.25 + night)
    this.innerMat.emissiveIntensity = 0.2 + night * 0.6 * this.open + glow * (0.3 + night)
    this.core.material.emissiveIntensity = 0.15 + glow * (0.4 + night)
    if (this.rainbowMats) for (const m of this.rainbowMats) m.emissiveIntensity = 0.2 + night * 0.6 * this.open + glow * (0.2 + night)
    const sway = Math.sin(t * 1.4 + this.phase) * 0.06
    const w = this.wilt
    this.head.rotation.z = sway * (1 - w * 0.7)
    this.head.rotation.x = Math.cos(t * 1.1 + this.phase) * 0.04 * (1 - w) + w * 1.15
    if (this.open > 0.9) this.head.rotation.y += 0.002
  }

  dispose() {
    this.petalMat.dispose()
    this.innerMat.dispose()
    this.core.material.dispose()
    this._disposeRainbow()
  }
}

export class Garden {
  constructor(world, sky) {
    this.world = world
    this.sky = sky
    this.group = new THREE.Group()
    world.scene.add(this.group)
    world.addPickable(this.group)
    this.plants = new Map()
    this.plots = new Map()
    this.date = null

    // 懸停／選取的地面光圈
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.36, 40),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }),
    )
    this.ring.rotation.x = -Math.PI / 2
    this.group.add(this.ring)
    this.highlighted = null
    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.46, 48),
      new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0, depthWrite: false }),
    )
    this.focusRing.rotation.x = -Math.PI / 2
    this.group.add(this.focusRing)
    this.focusId = null

    world.add((dt, t) => {
      for (const p of this.plants.values()) p.update(t, this.sky?.night || 0)
      const target = this.highlighted && this.plants.get(this.highlighted)
      const m = this.ring.material
      if (target) {
        this.ring.position.set(target.group.position.x, target.group.position.y + 0.04, target.group.position.z)
        this.ring.scale.setScalar(target.baseScale * (1.1 + Math.sin(t * 5) * 0.08))
        m.opacity += (0.85 - m.opacity) * 0.2
      } else {
        m.opacity *= 0.85
      }
      const fp = this.focusId && this.plants.get(this.focusId)
      const fm = this.focusRing.material
      if (fp) {
        this.focusRing.position.set(fp.group.position.x, fp.group.position.y + 0.05, fp.group.position.z)
        this.focusRing.scale.setScalar(fp.baseScale * (1.25 + Math.sin(t * 2) * 0.12))
        fm.opacity += (0.75 - fm.opacity) * 0.1
      } else {
        fm.opacity *= 0.9
      }
    })
  }

  sync(tasks, date, today = date) {
    if (date !== this.date) {
      for (const p of this.plants.values()) {
        this.group.remove(p.group)
        p.dispose()
      }
      this.plants.clear()
      this.plots.clear()
      this.date = date
      this._fresh = true
    }
    const ids = new Set(tasks.map((t) => t.id))
    // 移除
    for (const [id, p] of this.plants) {
      if (!ids.has(id)) {
        this.plants.delete(id)
        this.plots.delete(id)
        const g = p.group
        const s = g.scale.x
        tween(0.45, (k) => g.scale.setScalar(Math.max(0.001, s * (1 - k))), {
          easing: ease.inOutCubic,
          onDone: () => {
            this.group.remove(g)
            p.dispose()
          },
        })
      }
    }
    // 新增 / 更新（依建立時間配置固定花位）
    const sorted = [...tasks].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    for (const task of sorted) {
      let p = this.plants.get(task.id)
      if (p) {
        p.apply(task, false, today)
        continue
      }
      const used = new Set(this.plots.values())
      let plot = 0
      while (used.has(plot)) plot++
      this.plots.set(task.id, plot)
      p = new Plant(task, plotPosition(plot), today)
      this.plants.set(task.id, p)
      this.group.add(p.group)
      const s = p.baseScale
      p.group.scale.setScalar(0.001)
      tween(0.8, (k) => p.group.scale.setScalar(Math.max(0.001, s * k)), {
        easing: ease.outBack,
        delay: this._fresh ? plot * 0.06 : 0,
      })
    }
    this._fresh = false
  }

  highlight(id) {
    this.highlighted = id
  }

  setFocus(id) {
    this.focusId = id
  }

  anchor(id) {
    const p = this.plants.get(id)
    if (!p) return null
    return p.group.position.clone().add(new THREE.Vector3(0, 0.8 * p.baseScale, 0))
  }

  // 輕輕彈一下
  bounce(id) {
    const p = this.plants.get(id)
    if (!p) return
    const s = p.baseScale
    tween(0.6, (k) => p.group.scale.set(s * (1 + Math.sin(k * Math.PI) * 0.25), s * (1 + Math.sin(k * Math.PI) * 0.35), s * (1 + Math.sin(k * Math.PI) * 0.25)), { easing: ease.linear })
  }
}

// 圖鑑縮圖：用離屏渲染器把每種花從斜上方拍一張（只做一次）
let flowerThumbs = null
export function renderFlowerThumbs(keys) {
  if (flowerThumbs) return flowerThumbs
  flowerThumbs = {}
  const size = 112
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  r.setSize(size, size)
  r.outputColorSpace = THREE.SRGBColorSpace
  r.toneMapping = THREE.NeutralToneMapping
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#ffffff', '#f3e2d6', 2.3))
  const sun = new THREE.DirectionalLight('#ffffff', 1.5)
  sun.position.set(1.5, 4, 2.5)
  scene.add(sun)
  const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 20)
  for (const key of keys) {
    const p = new Plant({ id: 'thumb-' + key, tag: 'life', priority: 2, done: true, flower: key }, new THREE.Vector3())
    p.group.scale.setScalar(1)
    p.group.rotation.y = 0.4
    p.update(0, 0)
    scene.add(p.group)
    const y = p.head.position.y
    cam.position.set(0, y + 0.55, 0.42)
    cam.lookAt(0, y + 0.02, 0)
    r.render(scene, cam)
    flowerThumbs[key] = r.domElement.toDataURL('image/png')
    scene.remove(p.group)
    p.dispose()
  }
  r.dispose()
  r.forceContextLoss()
  return flowerThumbs
}
