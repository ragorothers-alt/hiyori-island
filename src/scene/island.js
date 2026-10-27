import * as THREE from 'three'
import { mat, rng, wobble, shadowed } from './util.js'
import { SEASONS } from './season.js'

// 島嶼配置（俯視座標 x, z；鏡頭在 +z 方向）
export const LAYOUT = {
  radius: 9.5,
  pond: { x: -3.3, z: 4.0, r: 1.9 },
  bed: { x: 3.4, z: 3.2, r: 2.5 },
  home: { x: 0, z: 1.4 },
  // もち的小木屋：中心、佔地半徑、朝向（門朝 +z 轉 rot）、模型放大倍率（讓壓扁的もち擠得過門）
  cabin: { x: -2.55, z: -0.2, r: 1.5, rot: 0.35, scale: 1.25 },
  path: { z0: 8.8, z1: 2.4 },
  slots: [
    [-1.3, -4.2], [1.3, -4.2], [-3.9, -3.4], [3.9, -3.4],
    [-2.6, -6.6], [2.6, -6.6], [-6.6, -1.2], [6.6, -1.2],
  ],
  // 裝飾的預留位置（避免草叢長在上面）
  decor: [[-6.0, 1.9], [-1.5, 5.6], [0, 7.4], [6.9, 4.6], [-7.0, -4.2]],
}

const occupied = (x, z) => {
  const { pond, bed, home, cabin, slots, decor } = LAYOUT
  if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 0.5) return true
  if (Math.hypot(x - bed.x, z - bed.z) < bed.r + 0.3) return true
  if (Math.hypot(x - home.x, z - home.z) < 1.2) return true
  if (Math.hypot(x - cabin.x, z - cabin.z) < cabin.r + 0.1) return true
  if (Math.abs(x) < 0.9 && z > 1.8) return true
  for (const [sx, sz] of slots) if (Math.hypot(x - sx, z - sz) < 1.35) return true
  for (const [dx, dz] of decor) if (Math.hypot(x - dx, z - dz) < 1.1) return true
  return false
}

export class Island {
  constructor(world) {
    this.world = world
    // 會隨季節變色的材質：不走 mat() 快取，避免影響其他物件
    this.grassMat = new THREE.MeshStandardMaterial({ color: '#bde5b6', roughness: 0.95, flatShading: true })
    this.rimMat = new THREE.MeshStandardMaterial({ color: '#addb9d', roughness: 0.95, flatShading: true, side: THREE.DoubleSide })
    this.topMat = new THREE.MeshStandardMaterial({ color: '#c5e6b4', roughness: 0.82, flatShading: true })
    this.group = new THREE.Group()
    world.scene.add(this.group)
    this._terrain()
    this._pond()
    this._path()
    this._bed()
    this._grass()
    this._floaters()
    world.add((dt, t) => this.update(dt, t))
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
    // 土層
    const soil = new THREE.Mesh(jitter(new THREE.CylinderGeometry(R * 0.985, R * 0.88, 1.5, 56, 2), 0.045, 0.7), mat('#f1dccb'))
    soil.position.y = -1.45

    // 下方岩錐：頂部奶茶色 → 底部薰衣草，頂點色漸層
    const cone = new THREE.ConeGeometry(R * 0.88, 9.5, 36, 7)
    cone.rotateX(Math.PI)
    const p = cone.attributes.position
    const r = rng(3)
    const colors = []
    const top = new THREE.Color('#ecd3c4')
    const bottom = new THREE.Color('#c6bde6')
    const c = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i)
      const x = p.getX(i)
      const z = p.getZ(i)
      const a = Math.atan2(z, x)
      const t = (4.75 - y) / 9.5
      const k = 1 + 0.08 * wobble(a, 2.2) + (r() - 0.5) * 0.09 * t
      p.setXYZ(i, x * k, y + (t > 0.05 && t < 0.98 ? (r() - 0.5) * 0.35 : 0), z * k)
      c.lerpColors(top, bottom, Math.pow(t, 0.8))
      colors.push(c.r, c.g, c.b)
    }
    cone.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    cone.computeVertexNormals()
    const rock = new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }))
    rock.position.y = -2.2 - 4.75

    this.group.add(shadowed(grass, false, true), rim, shadowed(soil, false, true), rock)
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
      this.group.add(shadowed(m, false, true))
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
    while (tufts.length < 170) {
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
    this.group.add(grass)
    this.tufts = grass

    // 野花小點
    const flowers = []
    while (flowers.length < 90) {
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
    this.group.add(fm)
    this.wildflowers = fm
  }

  _floaters() {
    // 漂浮的小石塊
    this.floaters = []
    const r = rng(9)
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group()
      const s = 0.35 + r() * 0.55
      const rock = new THREE.Mesh(new THREE.ConeGeometry(s, s * 1.8, 6, 1), mat('#e2cfd2'))
      rock.rotation.x = Math.PI
      rock.position.y = -s * 0.9
      const top = new THREE.Mesh(new THREE.CylinderGeometry(s * 1.02, s, 0.16, 6), this.topMat)
      g.add(rock, top)
      const a = (i / 7) * Math.PI * 2 + r()
      const d = 11.5 + r() * 4
      g.position.set(Math.cos(a) * d, -3 + r() * 4, Math.sin(a) * d)
      g.userData = { y: g.position.y, phase: r() * 6, sp: 0.4 + r() * 0.4 }
      this.group.add(g)
      this.floaters.push(g)
    }
  }

  setSeason(key) {
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
