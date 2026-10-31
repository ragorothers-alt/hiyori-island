import * as THREE from 'three'
import { LAYOUT } from './island.js'
import { PROJECT_COLORS } from '../theme.js'
import { mat, tween, ease } from './util.js'
import { daysBetween } from '../store.js'

// 專案 = 一座五重塔。里程碑數 = 樓層數（最多 7），完成幾個就蓋幾層。
const FLOOR_H = 0.62
const BASE_H = 0.36
const MAX_FLOORS = 7
const TOWER_SCALE = 1.22

const bodyGeo = new THREE.BoxGeometry(1, 0.38, 1)
const bandGeo = new THREE.BoxGeometry(1.02, 0.11, 1.02)
const roofGeo = new THREE.CylinderGeometry(0.26, 0.98, 0.2, 4, 1)
roofGeo.rotateY(Math.PI / 4)
const edgeBody = new THREE.EdgesGeometry(bodyGeo)
const edgeRoof = new THREE.EdgesGeometry(roofGeo)

const PAUSED_GREY = new THREE.Color('#b9bcc4')
export const floorsOf = (p) => Math.min(MAX_FLOORS, Math.max(1, p.milestones.length))

class Tower {
  constructor(project) {
    this.id = project.id
    this.group = new THREE.Group()
    this.group.userData.pick = { type: 'project', id: project.id }
    this.floors = []
    this.built = -1
    this.total = 0

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.2, 1.9), mat('#ece6df'))
    base.position.y = 0.1
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.16, 1.55), mat('#f4efe9'))
    step.position.y = 0.28
    this.group.add(base, step)

    // 小旗（專案色）
    this.flagMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 })
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), mat('#8d7b74'))
    pole.position.set(0.82, 0.75, 0.82)
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.5, 1, 4), this.flagMat)
    this.flag.position.set(0.82 + 0.12, 1.02, 0.82)
    this.group.add(pole, this.flag)

    this.wallMat = mat('#fffaf3')
    this.roofMat = new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true })
    this.bandMat = new THREE.MeshStandardMaterial({ color: '#fff4dd', emissive: '#ffcf8f', emissiveIntensity: 0.15, roughness: 0.7 })
    this.ghostMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false })
    this.ghostFill = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false })

    // 完工的相輪與寶珠
    this.spire = new THREE.Group()
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.9, 6), mat('#e8c36c', { metalness: 0.5, roughness: 0.35 }))
    rod.position.y = 0.45
    this.spire.add(rod)
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 5, 14), mat('#f0cf7e', { metalness: 0.5, roughness: 0.35 }))
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.2 + i * 0.12
      this.spire.add(ring)
    }
    this.orbMat = new THREE.MeshStandardMaterial({ color: '#fff6dc', emissive: '#ffd98a', emissiveIntensity: 1.2 })
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), this.orbMat)
    orb.position.y = 0.98
    this.spire.add(orb)
    // 準時落成：寶珠外圍兩圈金色光環
    this.haloMat = new THREE.MeshStandardMaterial({ color: '#ffe08a', emissive: '#ffc94d', emissiveIntensity: 1, metalness: 0.4, roughness: 0.3 })
    this.halo = new THREE.Group()
    for (const tilt of [0.35, -0.35]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.016, 6, 32), this.haloMat)
      ring.rotation.set(Math.PI / 2 + tilt, 0, 0)
      this.halo.add(ring)
    }
    this.halo.position.y = 0.98
    this.halo.visible = false
    this.spire.add(this.halo)
    this.group.add(this.spire)

    // 期限快到：塔前掛一盞紅燈籠（逾期了就熄燈，安靜等你）
    this.lanternMat = new THREE.MeshStandardMaterial({ color: '#f07f86', emissive: '#ff8a7a', emissiveIntensity: 0.6, roughness: 0.55 })
    this.lantern = new THREE.Group()
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.0, 5), mat('#8d7b74'))
    post.position.y = 0.5
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.025, 0.025), mat('#8d7b74'))
    arm.position.set(0.12, 0.98, 0)
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), this.lanternMat)
    shade.scale.y = 1.3
    const capGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 8)
    const capTop = new THREE.Mesh(capGeo, mat('#4f4a55'))
    capTop.position.y = 0.13
    const capBottom = new THREE.Mesh(capGeo, mat('#4f4a55'))
    capBottom.position.y = -0.13
    this.lanternBody = new THREE.Group()
    this.lanternBody.add(shade, capTop, capBottom)
    this.lanternBody.position.set(0.24, 0.78, 0)
    this.lantern.add(post, arm, this.lanternBody)
    this.lantern.position.set(-0.82, 0, 0.82)
    this.lantern.visible = false
    this.group.add(this.lantern)
    // 樓層用的是模組共用 geometry；這裡只登記這座塔自己的
    this.ownedGeometries = new Set()
    this.group.traverse((o) => {
      if (o.geometry) this.ownedGeometries.add(o.geometry)
    })
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
  }

  topY() {
    return BASE_H + Math.max(this.built, 0) * FLOOR_H + (this.done ? 1.2 : 0.2)
  }
  ghostTopY() {
    return BASE_H + this.total * FLOOR_H + 0.3
  }

  _makeFloor(i, built) {
    const w = 0.84 - i * 0.055
    const rw = w * 1.55
    const f = new THREE.Group()
    f.position.y = BASE_H + i * FLOOR_H
    if (built) {
      const body = new THREE.Mesh(bodyGeo, this.wallMat)
      body.scale.set(w, 1, w)
      body.position.y = 0.19
      const band = new THREE.Mesh(bandGeo, this.bandMat)
      band.scale.set(w, 1, w)
      band.position.y = 0.24
      const roof = new THREE.Mesh(roofGeo, this.roofMat)
      roof.scale.set(rw, 1, rw)
      roof.position.y = 0.38 + 0.1
      for (const m of [body, band, roof]) {
        m.castShadow = true
        m.receiveShadow = true
      }
      f.add(body, band, roof)
    } else {
      const body = new THREE.LineSegments(edgeBody, this.ghostMat)
      body.scale.set(w, 1, w)
      body.position.y = 0.19
      const fill = new THREE.Mesh(bodyGeo, this.ghostFill)
      fill.scale.copy(body.scale)
      fill.position.y = 0.19
      const roof = new THREE.LineSegments(edgeRoof, this.ghostMat)
      roof.scale.set(rw, 1, rw)
      roof.position.y = 0.5
      f.add(body, fill, roof)
    }
    return f
  }

  // 期限燈籠與準時光環
  _marks(project, done, today) {
    const days = project.deadline && today && !project.pausedAt ? daysBetween(today, project.deadline) : null
    this.lanternState = !done && project.milestones.length && days !== null && days <= 2 ? (days < 0 ? 'late' : 'near') : null
    this.lantern.visible = !!this.lanternState
    this.lanternMat.color.set(this.lanternState === 'late' ? '#c9b6b8' : '#f07f86')
    this.halo.visible = done && !!project.onTime
  }

  // 回傳新蓋好的樓層（供特效使用）
  setState(project, progress, animate, today = null) {
    const color = new THREE.Color(PROJECT_COLORS[project.color % PROJECT_COLORS.length])
    // 暫停：顏色褪成灰、旗子降到半旗
    this.paused = !!project.pausedAt
    if (this.paused) color.lerp(PAUSED_GREY, 0.65)
    this.flag.position.y = this.paused ? 0.62 : 1.02
    this.roofMat.color.copy(color)
    this.roofMat.emissive.copy(color).multiplyScalar(0.12)
    this.flagMat.color.copy(color)
    this.ghostMat.color.copy(color)
    const total = floorsOf(project)
    const built = project.milestones.length ? Math.round(progress * total) : 0
    const done = project.milestones.length > 0 && progress >= 1
    this._marks(project, done, today)
    if (total === this.total && built === this.built && done === this.done) return []

    const prevBuilt = this.built
    for (const f of this.floors) this.group.remove(f)
    this.floors = []
    for (let i = 0; i < total; i++) {
      const f = this._makeFloor(i, i < built)
      this.group.add(f)
      this.floors.push(f)
    }
    const fresh = []
    if (animate && prevBuilt >= 0 && built > prevBuilt) {
      for (let i = prevBuilt; i < built; i++) {
        const f = this.floors[i]
        const y = f.position.y
        f.scale.setScalar(0.001)
        tween(
          0.9,
          (k) => {
            f.scale.set(Math.max(0.001, k), Math.max(0.001, k), Math.max(0.001, k))
            f.position.y = y + (1 - k) * 0.8
          },
          { easing: ease.outBack, delay: (i - prevBuilt) * 0.25 },
        )
        fresh.push(new THREE.Vector3(0, (y + 0.3) * TOWER_SCALE, 0).add(this.group.position))
      }
    }
    this.spire.visible = done
    this.spire.position.y = BASE_H + total * FLOOR_H
    if (done && animate && !this.done) {
      this.spire.scale.setScalar(0.001)
      tween(1, (k) => this.spire.scale.setScalar(Math.max(0.001, k)), { easing: ease.outElastic, delay: 0.4 })
    }
    this.total = total
    this.built = built
    this.done = done
    return fresh
  }

  update(t, night) {
    this.bandMat.emissiveIntensity = 0.15 + night * 1.6
    this.orbMat.emissiveIntensity = 1 + Math.sin(t * 2) * 0.3 + night
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
    for (const m of [this.flagMat, this.roofMat, this.bandMat, this.ghostMat, this.ghostFill, this.orbMat, this.haloMat, this.lanternMat]) m.dispose()
    for (const g of this.ownedGeometries) g.dispose()
  }
}

export class Towers {
  constructor(world, sky) {
    this.world = world
    this.sky = sky
    this.group = new THREE.Group()
    world.scene.add(this.group)
    world.addPickable(this.group)
    this.towers = new Map()
    world.add((dt, t) => {
      for (const tw of this.towers.values()) tw.update(t, sky.night)
    })
  }

  // 回傳 [{ id, positions }]：本次新蓋的樓層位置
  sync(projects, progressOf, animate = true, today = null) {
    const ids = new Set(projects.map((p) => p.id))
    for (const [id, tw] of this.towers) {
      if (!ids.has(id)) {
        this.towers.delete(id)
        const g = tw.group
        tween(0.5, (k) => g.scale.setScalar(Math.max(0.001, (1 - k) * TOWER_SCALE)), {
          onDone: () => {
            this.group.remove(g)
            tw.dispose()
          },
        })
      }
    }
    const built = []
    for (const p of projects) {
      let tw = this.towers.get(p.id)
      const [x, z] = LAYOUT.slots[p.slot] || [0, 0]
      if (!tw) {
        tw = new Tower(p)
        tw.group.position.set(x, 0, z)
        tw.group.scale.setScalar(TOWER_SCALE)
        this.towers.set(p.id, tw)
        this.group.add(tw.group)
        tw.setState(p, progressOf(p), false, today)
        if (animate) {
          tw.group.scale.setScalar(0.001)
          tween(0.9, (k) => tw.group.scale.setScalar(Math.max(0.001, k * TOWER_SCALE)), { easing: ease.outBack })
        }
        continue
      }
      tw.group.position.set(x, 0, z)
      const fresh = tw.setState(p, progressOf(p), animate, today)
      if (fresh.length) built.push({ id: p.id, positions: fresh })
    }
    return built
  }

  get(id) {
    return this.towers.get(id)
  }

  anchor(id, top = true) {
    const tw = this.towers.get(id)
    if (!tw) return null
    return tw.group.position.clone().add(new THREE.Vector3(0, top ? tw.topY() * TOWER_SCALE : 0, 0))
  }

  labelAnchor(id) {
    const tw = this.towers.get(id)
    if (!tw) return null
    return tw.group.position.clone().add(new THREE.Vector3(0, Math.max(tw.ghostTopY(), tw.topY()) * TOWER_SCALE + 0.3, 0))
  }
}
