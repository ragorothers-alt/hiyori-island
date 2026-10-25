import * as THREE from 'three'
import { LAYOUT } from './island.js'
import { tagOf } from '../theme.js'
import { tween, ease, hash, mat, cancelTween } from './util.js'

// 花圃：當天每個任務 = 一株植物。未完成是花苞，完成就綻放。
const CLOSED = 1.32
const OPEN = 0.3
const GREEN = new THREE.Color('#a9d79a')

const stemGeo = new THREE.CylinderGeometry(0.022, 0.034, 0.56, 5)
stemGeo.translate(0, 0.28, 0)
const leafGeo = new THREE.SphereGeometry(0.12, 7, 4)
leafGeo.scale(1.1, 0.22, 0.48)
leafGeo.translate(0.11, 0, 0)
const petalGeo = new THREE.SphereGeometry(0.1, 10, 6)
petalGeo.scale(1.3, 0.3, 0.74)
petalGeo.translate(0.12, 0, 0)
const coreGeo = new THREE.SphereGeometry(0.065, 10, 8)
const moundGeo = new THREE.SphereGeometry(0.17, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)
moundGeo.scale(1, 0.4, 1)

function plotPosition(i) {
  const { bed } = LAYOUT
  const max = 13
  if (i < max) {
    const r = 0.64 * Math.sqrt(i + 0.5)
    const a = i * 2.39996 + 0.4
    return new THREE.Vector3(bed.x + Math.cos(a) * r, 0.1, bed.z + Math.sin(a) * r)
  }
  // 花圃滿了：沿島嶼邊緣種
  const k = i - max
  const a = 0.15 + k * 0.23
  const R = LAYOUT.radius - 0.9 - (k % 2) * 0.35
  return new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)
}

class Plant {
  constructor(task, pos) {
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
    this.apply(task, true)
    this.group.traverse((o) => {
      if (o.isMesh) o.castShadow = true
    })
  }

  _buildPetals(priority) {
    for (const p of this.pivots) this.head.remove(p)
    this.pivots = []
    const layers = priority === 3 ? [[8, 1, this.petalMat, 0], [5, 0.72, this.innerMat, 0.3]] : [[5 + (priority === 2 ? 1 : 0), 1, this.petalMat, 0]]
    for (const [n, s, m, off] of layers) {
      for (let i = 0; i < n; i++) {
        const pivot = new THREE.Object3D()
        const petal = new THREE.Mesh(petalGeo, m)
        petal.scale.setScalar(s)
        petal.castShadow = true
        pivot.add(petal)
        pivot.userData = { yaw: (i / n) * Math.PI * 2 + off, inner: s < 1 }
        this.head.add(pivot)
        this.pivots.push(pivot)
      }
    }
    this._priority = priority
  }

  _setOpen(k) {
    this.open = k
    const tilt = CLOSED + (OPEN - CLOSED) * k
    for (const p of this.pivots) {
      const t = p.userData.inner ? tilt + 0.35 * k : tilt
      p.rotation.set(0, p.userData.yaw, t)
    }
    const c = this.color
    this.petalMat.color.copy(GREEN).lerp(c, 0.45 + 0.55 * Math.min(1, k))
    this.petalMat.emissive.copy(c)
    this.innerMat.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.45)
    this.innerMat.emissive.copy(c)
    this.core.scale.setScalar(0.4 + 0.6 * Math.min(1, k))
    this.head.scale.setScalar(0.72 + 0.28 * k)
    this.stem.scale.y = 0.82 + 0.18 * Math.min(1, k)
    this.head.position.y = 0.46 + 0.1 * Math.min(1, k)
  }

  apply(task, instant = false) {
    this.color = new THREE.Color(tagOf(task.tag).color)
    if (this._priority !== task.priority) this._buildPetals(task.priority)
    this.group.scale.setScalar(([0.85, 1, 1.25][task.priority - 1] || 1) * 1.65)
    this.baseScale = this.group.scale.x
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

  update(t, night = 0) {
    this.petalMat.emissiveIntensity = 0.16 + night * 0.5 * this.open
    this.innerMat.emissiveIntensity = 0.2 + night * 0.6 * this.open
    const sway = Math.sin(t * 1.4 + this.phase) * 0.06
    this.head.rotation.z = sway
    this.head.rotation.x = Math.cos(t * 1.1 + this.phase) * 0.04
    if (this.open > 0.9) this.head.rotation.y += 0.002
  }

  dispose() {
    this.petalMat.dispose()
    this.innerMat.dispose()
    this.core.material.dispose()
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
    })
  }

  sync(tasks, date) {
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
        p.apply(task)
        continue
      }
      const used = new Set(this.plots.values())
      let plot = 0
      while (used.has(plot)) plot++
      this.plots.set(task.id, plot)
      p = new Plant(task, plotPosition(plot))
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
