import * as THREE from 'three'
import { mat, rng, wobble, shadowed } from './util.js'
import { SEASONS } from './season.js'
import { buildIslandBase, addGrassDetail, FALL_UNIFORMS } from './islandBase.js'
import { PLAN, inTown, ISLAND_BASE_R } from '../data/projectTown.js'

// 島嶼配置（俯視座標 x, z；鏡頭在 +z 方向）
export const LAYOUT = {
  // 島的半徑：平常是 12；專案町用到外圈的地時島會變大（Island.setRadius，時之環、街區浮島等跟著往外推）
  radius: ISLAND_BASE_R,
  pond: { x: -3.3, z: 4.0, r: 1.9 },
  bed: { x: 3.4, z: 3.2, r: 2.5 },
  home: { x: 0, z: 1.4 },
  // ふじ平常待的地方（もち在 home）
  home2: { x: 1.5, z: 0.4 },
  // もち的小木屋：中心、佔地半徑、朝向（門朝 +z 轉 rot）、模型放大倍率（讓壓扁的もち擠得過門）
  cabin: { x: -2.55, z: -0.2, r: 1.5, rot: 0.35, scale: 1.25 },
  path: { z0: 11.3, z1: 2.4 },
  // 專案町的地：[x, z, rot（正面朝 (sin rot, cos rot)）, 地的邊長]，順序就是開放順序（data/projectTown.js）
  slots: PLAN.lots.map((l) => [l.x, l.z, l.rot, l.size]),
  // 裝飾的預留位置（避免草叢長在上面）
  decor: [[-6.0, 1.9], [-1.5, 5.6], [0, 7.4], [6.9, 4.6], [-7.0, -4.2]],
}

const occupied = (x, z) => {
  const { pond, bed, home, home2, cabin, decor } = LAYOUT
  if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 0.5) return true
  if (Math.hypot(x - bed.x, z - bed.z) < bed.r + 0.3) return true
  if (Math.hypot(x - home.x, z - home.z) < 1.2) return true
  if (Math.hypot(x - home2.x, z - home2.z) < 1.2) return true
  if (Math.hypot(x - cabin.x, z - cabin.z) < cabin.r + 0.1) return true
  if (Math.abs(x) < 0.9 && z > 1.8) return true
  if (inTown(x, z, 0.15)) return true
  for (const [dx, dz] of decor) if (Math.hypot(x - dx, z - dz) < 1.1) return true
  return false
}

export class Island {
  constructor(world) {
    this.world = world
    // 會隨季節變色的材質：不走 mat() 快取，避免影響其他物件
    this.grassMat = addGrassDetail(new THREE.MeshStandardMaterial({ color: '#bde5b6', roughness: 0.95 }))
    this.rimMat = new THREE.MeshStandardMaterial({ color: '#addb9d', roughness: 0.95, side: THREE.DoubleSide })
    this.topMat = addGrassDetail(new THREE.MeshStandardMaterial({ color: '#c5e6b4', roughness: 0.82 }))
    this.group = new THREE.Group()
    world.scene.add(this.group)
    this._pond()
    this._bed()
    // 跟島的大小有關的部分（草地、岩壁、小徑、草叢野花、漂浮石塊）放在一起，島變大時整組重蓋
    this.outer = new THREE.Group()
    this.group.add(this.outer)
    this._buildOuter()
    world.add((dt, t) => this.update(dt, t))
  }

  _buildOuter() {
    this._terrain()
    this._path()
    this._grass()
    this._floaters()
  }

  // 島長大（或讀到比較大的存檔）：換新的半徑重蓋外圍那一組
  setRadius(R) {
    if (R === LAYOUT.radius) return false
    LAYOUT.radius = R
    LAYOUT.path.z0 = R - 0.7
    const old = this.outer
    old.removeFromParent()
    old.traverse((o) => {
      if (o.isInstancedMesh) o.dispose()
      o.geometry?.dispose()
      for (const m of o.userData.ownedMaterials || []) m.dispose()
    })
    for (const m of [this.tufts.material, this.wildflowers.material]) m.dispose()
    this.outer = new THREE.Group()
    this.group.add(this.outer)
    this._buildOuter()
    if (this.season) this.setSeason(this.season)
    return true
  }

  _terrain() {
    const R = LAYOUT.radius
    const jitter = (geo, amp, seed, keepTop = true) => {
      const p = geo.attributes.position
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i)
        const z = p.getZ(i)
        const r = Math.hypot(x, z)
        if (r < 0.01) continue
        const a = Math.atan2(z, x)
        const k = 1 + amp * wobble(a, seed)
        p.setX(i, x * k)
        p.setZ(i, z * k)
        if (!keepTop) p.setY(i, p.getY(i) + Math.sin(a * 5 + p.getY(i)) * 0.15)
      }
      geo.computeVertexNormals()
      return geo
    }

    // 草地
    const grass = new THREE.Mesh(
      jitter(new THREE.CylinderGeometry(R, R * 0.985, 0.7, 72, 1), 0.035, 0),
      this.grassMat,
    )
    grass.position.y = -0.35
    // 草地邊緣一圈稍深的草
    const rim = new THREE.Mesh(
      jitter(new THREE.CylinderGeometry(R * 1.005, R * 0.99, 0.18, 72, 1, true), 0.035, 0),
      this.rimMat,
    )
    rim.position.y = -0.62
    // 草地以下：層疊岩壁、垂根苔蘚、往下收成岩錐，兩道從岩壁流出的瀑布（鏡頭看得到的左前、右前）
    const base = buildIslandBase({ radius: R * 0.99, top: -0.62, cliff: 2.4, depth: 13, seed: 0, wob: 0.035, segs: 88, roots: 1.3, falls: [2.0, 0.62], fallTo: -15 })
    this.base = base

    this.outer.add(shadowed(grass, false, true), rim, base)
    this.ground = grass
  }

  _pond() {
    const { pond } = LAYOUT
    const g = new THREE.Group()
    g.position.set(pond.x, 0, pond.z)
    // 池底（淺色）＋ 水面（半透明）
    const floor = new THREE.Mesh(new THREE.CircleGeometry(pond.r, 40), mat('#9fcfe0', { flatShading: false }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.01
    this.water = new THREE.Mesh(
      new THREE.CircleGeometry(pond.r, 48),
      new THREE.MeshPhysicalMaterial({
        color: '#bfe9f7', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.55,
        clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#a9e2f5', emissiveIntensity: 0.12,
      }),
    )
    this.water.rotation.x = -Math.PI / 2
    this.water.position.y = 0.09
    g.add(floor, this.water)

    // 池邊石
    const r = rng(11)
    const stoneGeo = new THREE.IcosahedronGeometry(1, 0)
    const n = 18
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.15
      const s = 0.2 + r() * 0.18
      const m = new THREE.Mesh(stoneGeo, mat(r() > 0.5 ? '#e7e2db' : '#d9d5e3'))
      m.scale.set(s * 1.3, s * 0.7, s)
      m.position.set(Math.cos(a) * (pond.r + 0.1), 0.05, Math.sin(a) * (pond.r + 0.1))
      m.rotation.set(r(), r() * 3, r())
      g.add(shadowed(m))
    }

    // 錦鯉
    this.koi = []
    const colors = [['#fff6ef', '#f4895e'], ['#f6a35f', '#fff3e6'], ['#fff6ef', '#3e3a44']]
    colors.forEach(([body, spot], i) => {
      const k = new THREE.Group()
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 10), new THREE.MeshStandardMaterial({ color: body, roughness: 0.4 }))
      b.rotation.z = Math.PI / 2
      b.scale.set(1, 1, 0.75)
      const sp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: spot, roughness: 0.4 }))
      sp.position.set(0.05, 0.035, 0)
      sp.scale.set(1.4, 0.5, 0.9)
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 4), new THREE.MeshStandardMaterial({ color: spot, roughness: 0.4 }))
      tail.rotation.z = Math.PI / 2
      tail.position.x = -0.26
      tail.scale.set(1, 1, 0.3)
      k.add(b, sp, tail)
      k.userData = { r: 0.6 + i * 0.38, speed: 0.35 + i * 0.12, phase: i * 2.1, dir: i % 2 ? -1 : 1, tail }
      k.position.y = 0.045
      g.add(k)
      this.koi.push(k)
    })
    this.pondGroup = g
    this.group.add(g)
  }

  _path() {
    const { path } = LAYOUT
    const geo = new THREE.CylinderGeometry(0.42, 0.46, 0.1, 8)
    const n = 8
    const r = rng(5)
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const m = new THREE.Mesh(geo, mat(i % 2 ? '#ebe6df' : '#e3dfe8'))
      m.position.set((i % 2 ? 0.22 : -0.22) + (r() - 0.5) * 0.1, 0.03, path.z0 - t * (path.z0 - path.z1))
      m.rotation.y = r() * 3
      m.scale.set(1 + r() * 0.2, 1, 0.85 + r() * 0.2)
      this.outer.add(shadowed(m, false, true))
    }
  }

  _bed() {
    const { bed } = LAYOUT
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(bed.r, bed.r + 0.12, 0.12, 48), mat('#e9d2bd', { roughness: 1 }))
    soil.position.set(bed.x, 0.04, bed.z)
    this.group.add(shadowed(soil, false, true))
    // 白石圍邊
    const stone = new THREE.SphereGeometry(0.11, 7, 5)
    const n = 46
    const m = new THREE.InstancedMesh(stone, mat('#f6f3ee'), n)
    const o = new THREE.Object3D()
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      o.position.set(bed.x + Math.cos(a) * (bed.r + 0.12), 0.08, bed.z + Math.sin(a) * (bed.r + 0.12))
      o.scale.set(1.1, 0.7, 1)
      o.rotation.y = a
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    }
    m.castShadow = true
    this.group.add(m)
  }

  _grass() {
    const r = rng(42)
    const R = LAYOUT.radius - 0.7
    const tufts = []
    this.tuftMix = []
    const area = (LAYOUT.radius / 12) ** 2
    while (tufts.length < Math.round(270 * area)) {
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * R
      const x = Math.cos(a) * d
      const z = Math.sin(a) * d
      if (!occupied(x, z)) tufts.push([x, z])
    }
    const blade = new THREE.ConeGeometry(0.05, 0.3, 3)
    blade.translate(0, 0.15, 0)
    const count = tufts.length * 3
    const grass = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), count)
    const o = new THREE.Object3D()
    const c = new THREE.Color()
    let i = 0
    for (const [x, z] of tufts) {
      for (let j = 0; j < 3; j++) {
        o.position.set(x + (r() - 0.5) * 0.16, 0, z + (r() - 0.5) * 0.16)
        o.rotation.set((r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5)
        const s = 0.7 + r() * 0.7
        o.scale.set(s, s, s)
        o.updateMatrix()
        grass.setMatrixAt(i, o.matrix)
        const k = r()
        this.tuftMix.push(k)
        grass.setColorAt(i, c.set('#9fd38f').lerp(new THREE.Color('#d6efb4'), k))
        i++
      }
    }
    grass.receiveShadow = true
    this.outer.add(grass)
    this.tufts = grass

    // 野花小點
    const flowers = []
    while (flowers.length < Math.round(145 * area)) {
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * R
      const x = Math.cos(a) * d
      const z = Math.sin(a) * d
      if (!occupied(x, z)) flowers.push([x, z])
    }
    const dot = new THREE.IcosahedronGeometry(0.055, 0)
    const fm = new THREE.InstancedMesh(dot, new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.08 }), flowers.length)
    const palette = ['#ffffff', '#fde2ea', '#f9c9d6', '#fff2b8', '#dfe9ff']
    flowers.forEach(([x, z], k) => {
      o.position.set(x, 0.07, z)
      o.rotation.set(0, 0, 0)
      o.scale.setScalar(0.8 + r() * 0.6)
      o.updateMatrix()
      fm.setMatrixAt(k, o.matrix)
      fm.setColorAt(k, c.set(palette[Math.floor(r() * palette.length)]))
    })
    this.outer.add(fm)
    this.wildflowers = fm
  }

  _floaters() {
    // 漂浮的小石塊：主島底座的迷你版（層疊岩壁＋岩錐，沒有垂根）
    this.floaters = []
    const r = rng(9)
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group()
      const s = 0.35 + r() * 0.55
      const rock = buildIslandBase({ radius: s * 0.99, top: -0.08, cliff: s * 0.45, depth: s * 1.9, seed: 20 + i, wob: 0.08, segs: 18, roots: 0 })
      const top = new THREE.Mesh(new THREE.CylinderGeometry(s * 1.02, s, 0.16, 18), this.topMat)
      g.add(rock, top)
      const a = (i / 7) * Math.PI * 2 + r()
      const d = LAYOUT.radius + 2 + r() * 4
      g.position.set(Math.cos(a) * d, -3 + r() * 4, Math.sin(a) * d)
      g.userData = { y: g.position.y, phase: r() * 6, sp: 0.4 + r() * 0.4, ownedMaterials: rock.userData.ownedMaterials }
      this.outer.add(g)
      this.floaters.push(g)
    }
  }

  setSeason(key) {
    this.season = key
    const s = SEASONS[key]
    this.grassMat.color.set(s.grass)
    this.rimMat.color.set(s.rim)
    this.topMat.color.set(s.top)
    const a = new THREE.Color(s.tuft[0])
    const b = new THREE.Color(s.tuft[1])
    const c = new THREE.Color()
    this.tuftMix.forEach((k, i) => this.tufts.setColorAt(i, c.copy(a).lerp(b, k)))
    this.tufts.instanceColor.needsUpdate = true
    this.wildflowers.visible = s.flowers
    this.water.material.color.set(s.water)
    this.water.material.emissive.set(s.water)
    this.water.material.opacity = key === 'winter' ? 0.78 : 0.55
  }

  update(dt, t) {
    FALL_UNIFORMS.uTime.value = t
    FALL_UNIFORMS.uNight.value = this.world.look?.night ?? 0
    for (const k of this.koi) {
      const u = k.userData
      const a = t * u.speed * u.dir + u.phase
      const x = Math.cos(a) * u.r
      const z = Math.sin(a) * u.r * 0.85
      k.position.x = x
      k.position.z = z
      k.rotation.y = -a - (u.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      u.tail.rotation.y = Math.sin(t * 8 + u.phase) * 0.5
    }
    for (const f of this.floaters) {
      const u = f.userData
      f.position.y = u.y + Math.sin(t * u.sp + u.phase) * 0.35
      f.rotation.y += dt * 0.05
    }
  }
}
