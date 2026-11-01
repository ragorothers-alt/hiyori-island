import * as THREE from 'three'
import { PLAN } from '../data/projectTown.js'
import { PROJECT_COLORS } from '../theme.js'
import { mat, tween, ease, hash } from './util.js'
import { daysBetween } from '../store.js'
import { buildHouse, KINDS_BY_HEIGHT } from './models/projectTown/index.js'

// 專案 = 專案町的一棟房子。里程碑完成的比例決定蓋到哪一段：
// 1 地基 → 2 骨架 → 3 牆 → 4 屋頂 → 5 完工（暖簾、燈籠）。還沒蓋完時，完工的樣子淡淡地浮在工地上當預告。
// （舊的五重塔在 towers.js，留作備用造型）
const PAUSED_GREY = new THREE.Color('#b9bcc4')
const GHOST_OPACITY = 0.13
const WHITE = new THREE.Color('#ffffff')

export function stageOf(project, progress) {
  if (project.milestones.length && progress >= 1) return 5
  return 1 + Math.min(3, Math.floor(progress * 4))
}

// 種類依地的高度分類（矮／中／高）和專案 id 決定，同一個專案一直是同一種
export function kindOf(project, lot) {
  const list = KINDS_BY_HEIGHT[lot.height] || KINDS_BY_HEIGHT.mid
  return list[Math.floor(hash(project.id) * list.length)]
}

// 完工樣子的半透明外形（線框太密，二十棟一起看會糊成一片）
function buildPreview(kind, base, material) {
  const g = buildHouse(kind, 5, { base })
  for (const m of g.userData.ownedMaterials) m.dispose()
  g.userData = { ownedMaterials: [], ownedTextures: [] }
  g.traverse((o) => {
    if (!o.isMesh) return
    o.material = material
    o.castShadow = o.receiveShadow = false
  })
  return g
}

function disposeModel(obj) {
  obj.traverse((o) => o.geometry?.dispose())
  for (const m of obj.userData.ownedMaterials || []) m.dispose()
  for (const t of obj.userData.ownedTextures || []) t.dispose()
}

class House {
  constructor(project, slot) {
    const lot = PLAN.lots[slot]
    this.id = project.id
    this.slot = slot
    this.kind = kindOf(project, lot)
    this.base = lot.size - 0.4
    this.stage = 0
    this.hex = ''
    this.model = null
    this.ghost = null
    this.group = new THREE.Group()
    this.group.position.set(lot.x, 0, lot.z)
    this.group.rotation.y = lot.rot
    this.group.userData.pick = { type: 'project', id: project.id }

    // 受光的材質：夜裡跟著暗下來，不會像在發光
    this.ghostMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: GHOST_OPACITY, depthWrite: false })

    // 小旗（專案色）：插在房子的旗座上，暫停時降半旗
    this.flagMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 })
    this.flagPole = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.6, 5), mat('#8d7b74'))
    pole.position.y = 0.3
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.24, 1, 3), this.flagMat)
    this.flag.userData.noShadow = true
    this.flagPole.add(pole, this.flag)
    this.group.add(this.flagPole)

    // 期限快到：門口掛一盞紅燈籠（逾期了就熄燈，安靜等你）
    this.lanternMat = new THREE.MeshStandardMaterial({ color: '#f07f86', emissive: '#ff8a7a', emissiveIntensity: 0.6, roughness: 0.55 })
    this.lantern = new THREE.Group()
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.8, 5), mat('#8d7b74'))
    post.position.y = 0.4
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.02), mat('#8d7b74'))
    arm.position.set(0.09, 0.78, 0)
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), this.lanternMat)
    shade.scale.y = 1.3
    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 8), mat('#4f4a55'))
    capTop.position.y = 0.105
    const capBottom = capTop.clone()
    capBottom.geometry = capTop.geometry.clone()
    capBottom.position.y = -0.105
    this.lanternBody = new THREE.Group()
    this.lanternBody.add(shade, capTop, capBottom)
    this.lanternBody.position.set(0.18, 0.6, 0)
    this.lantern.add(post, arm, this.lanternBody)
    this.lantern.visible = false
    this.group.add(this.lantern)

    // 準時落成：屋頂上方兩圈金色光環
    this.haloMat = new THREE.MeshStandardMaterial({ color: '#ffe08a', emissive: '#ffc94d', emissiveIntensity: 1, metalness: 0.4, roughness: 0.3 })
    this.halo = new THREE.Group()
    for (const tilt of [0.35, -0.35]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.014, 6, 32), this.haloMat)
      ring.rotation.set(Math.PI / 2 + tilt, 0, 0)
      this.halo.add(ring)
    }
    this.halo.visible = false
    this.group.add(this.halo)

    for (const o of [pole, shade, capTop, capBottom, post, arm]) o.castShadow = true
  }

  topY() {
    return this.model ? this.model.userData.top.y : 0.3
  }
  ghostTopY() {
    return this.ghostTop || 0
  }

  // 期限燈籠與準時光環
  _marks(project, done, today) {
    const days = project.deadline && today && !project.pausedAt ? daysBetween(today, project.deadline) : null
    this.lanternState = !done && project.milestones.length && days !== null && days <= 2 ? (days < 0 ? 'late' : 'near') : null
    this.lantern.visible = !!this.lanternState
    this.lanternMat.color.set(this.lanternState === 'late' ? '#c9b6b8' : '#f07f86')
    this.halo.visible = done && !!project.onTime
  }

  // 依目前的模型擺好旗子、燈籠和光環（都在房子自己的座標裡，正面朝 +z）
  _placeMarks() {
    const { flag, door, top } = this.model.userData
    this.flagPole.position.copy(flag)
    this.flag.position.set(0.085, this.paused ? 0.24 : 0.46, 0)
    const half = this.base / 2
    // 燈籠插在門的側邊、地塊前緣以內
    const side = door.x > 0 ? -1 : 1
    this.lantern.position.set(THREE.MathUtils.clamp(door.x + side * 0.42, -half, half), 0, half + 0.06)
    this.halo.position.set(0, top.y + 0.22, 0)
  }

  // 回傳新蓋好的位置（供特效使用）
  setState(project, progress, animate, today = null) {
    const color = new THREE.Color(PROJECT_COLORS[project.color % PROJECT_COLORS.length])
    // 暫停：顏色褪成灰、旗子降到半旗
    this.paused = !!project.pausedAt
    if (this.paused) color.lerp(PAUSED_GREY, 0.65)
    this.flagMat.color.copy(color)
    this.ghostMat.color.copy(color).lerp(WHITE, 0.45)
    const stage = stageOf(project, progress)
    const done = stage === 5
    this._marks(project, done, today)
    const hex = '#' + color.getHexString()
    if (stage === this.stage && hex === this.hex) {
      this._placeMarks()
      return []
    }

    const prev = this.stage
    const old = this.model
    this.model = buildHouse(this.kind, stage, { color: hex, base: this.base })
    this.group.add(this.model)
    const grew = animate && prev > 0 && stage > prev
    if (old) {
      if (grew) tween(0.3, (k) => old.scale.setScalar(Math.max(0.001, 1 - k)), { onDone: () => (old.removeFromParent(), disposeModel(old)) })
      else {
        old.removeFromParent()
        disposeModel(old)
      }
    }
    const fresh = []
    if (grew) {
      const m = this.model
      m.scale.setScalar(0.001)
      tween(0.9, (k) => m.scale.setScalar(Math.max(0.001, k)), { easing: ease.outBack, delay: 0.25 })
      fresh.push(new THREE.Vector3(0, m.userData.top.y * 0.6, 0).add(this.group.position))
    }
    // 還沒蓋完：完工樣子的線框
    if (stage < 5 && !this.ghost) {
      this.ghost = buildPreview(this.kind, this.base, this.ghostMat)
      this.ghostTop = new THREE.Box3().setFromObject(this.ghost).max.y
      this.group.add(this.ghost)
    } else if (stage === 5 && this.ghost) {
      const g = this.ghost
      this.ghost = null
      if (animate) tween(0.6, (k) => (this.ghostMat.opacity = GHOST_OPACITY * (1 - k)), { onDone: () => (g.removeFromParent(), disposeModel(g)) })
      else {
        g.removeFromParent()
        disposeModel(g)
      }
    }
    if (stage < 5) this.ghostMat.opacity = GHOST_OPACITY
    this.stage = stage
    this.hex = hex
    this._placeMarks()
    if (done && animate && prev > 0 && prev < 5) {
      this.halo.scale.setScalar(0.001)
      tween(1, (k) => this.halo.scale.setScalar(Math.max(0.001, k)), { easing: ease.outElastic, delay: 0.6 })
    }
    return fresh
  }

  update(t, dt, night) {
    this.model?.userData.anim(t, dt, { night })
    this.flag.rotation.y = this.paused ? 0.1 : Math.sin(t * 2 + this.group.position.x) * 0.25
    if (this.lanternState) {
      this.lanternBody.rotation.z = Math.sin(t * 1.3 + this.group.position.z) * 0.1
      this.lanternMat.emissiveIntensity = this.lanternState === 'near' ? 0.55 + Math.sin(t * 2.6) * 0.25 + night * 1.4 : 0.05
    }
    if (this.halo.visible) {
      this.halo.rotation.y = t * 0.8
      this.haloMat.emissiveIntensity = 0.8 + night * 1.2
    }
  }

  dispose() {
    if (this.model) disposeModel(this.model)
    if (this.ghost) disposeModel(this.ghost)
    this.model = this.ghost = null
    this.group.traverse((o) => o.geometry?.dispose())
    for (const m of [this.ghostMat, this.flagMat, this.lanternMat, this.haloMat]) m.dispose()
  }
}

// 專案町的房子們：介面和舊的 Towers 一樣（sync／get／anchor／labelAnchor）
export class ProjectHouses {
  constructor(world, sky) {
    this.world = world
    this.sky = sky
    this.group = new THREE.Group()
    world.scene.add(this.group)
    world.addPickable(this.group)
    this.houses = new Map()
    world.add((dt, t) => {
      for (const h of this.houses.values()) h.update(t, dt, sky.night)
    })
  }

  _remove(id, animate) {
    const h = this.houses.get(id)
    if (!h) return
    this.houses.delete(id)
    const g = h.group
    const done = () => {
      this.group.remove(g)
      h.dispose()
    }
    if (animate) tween(0.5, (k) => g.scale.setScalar(Math.max(0.001, 1 - k)), { onDone: done })
    else done()
  }

  // 回傳 [{ id, positions }]：本次蓋上去的位置
  sync(projects, progressOf, animate = true, today = null) {
    const bySlot = new Map(projects.map((p) => [p.id, p.slot]))
    for (const [id, h] of this.houses) if (bySlot.get(id) !== h.slot) this._remove(id, animate && !bySlot.has(id))
    const built = []
    for (const p of projects) {
      let h = this.houses.get(p.id)
      if (!h) {
        h = new House(p, p.slot)
        this.houses.set(p.id, h)
        this.group.add(h.group)
        h.setState(p, progressOf(p), false, today)
        if (animate) {
          h.group.scale.setScalar(0.001)
          tween(0.9, (k) => h.group.scale.setScalar(Math.max(0.001, k)), { easing: ease.outBack })
        }
        continue
      }
      const fresh = h.setState(p, progressOf(p), animate, today)
      if (fresh.length) built.push({ id: p.id, positions: fresh })
    }
    return built
  }

  get(id) {
    return this.houses.get(id)
  }

  anchor(id, top = true) {
    const h = this.houses.get(id)
    if (!h) return null
    return h.group.position.clone().add(new THREE.Vector3(0, top ? h.topY() : 0, 0))
  }

  labelAnchor(id) {
    const h = this.houses.get(id)
    if (!h) return null
    return h.group.position.clone().add(new THREE.Vector3(0, Math.max(h.ghostTopY(), h.topY()) + 0.3, 0))
  }
}
