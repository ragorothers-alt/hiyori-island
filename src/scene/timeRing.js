import * as THREE from 'three'
import { EVENT_COLORS } from '../theme.js'
import { toMin } from '../store.js'
import { textSprite, glowTexture, tween, ease } from './util.js'

// 時之環：24 小時環繞小島。0 點在後方、6 點在右、12 點在正前方、18 點在左（俯視順時針）。
// 圍在島外（島半徑 12）
const R_IN = 13.5
const R_OUT = 15.1
const Y = -0.55
const LANE_H = 0.26

export const ringPos = (minutes, r = (R_IN + R_OUT) / 2, y = Y) => {
  const phi = (minutes / 1440) * Math.PI * 2
  return new THREE.Vector3(Math.sin(phi) * r, y, -Math.cos(phi) * r)
}

// 在 XY 平面畫出扇環，旋轉 -90° 後 (x, y) → 世界 (x, -y)，因此 y 取 cos 的值
function arcShape(m0, m1, r0, r1) {
  const s = new THREE.Shape()
  const steps = Math.max(4, Math.ceil(((m1 - m0) / 1440) * 160))
  const pt = (m, r) => {
    const phi = (m / 1440) * Math.PI * 2
    return [Math.sin(phi) * r, Math.cos(phi) * r]
  }
  s.moveTo(...pt(m0, r1))
  for (let i = 1; i <= steps; i++) s.lineTo(...pt(m0 + ((m1 - m0) * i) / steps, r1))
  for (let i = steps; i >= 0; i--) s.lineTo(...pt(m0 + ((m1 - m0) * i) / steps, r0))
  return s
}

export class TimeRing {
  constructor(world, sky) {
    this.world = world
    this.sky = sky
    this.group = new THREE.Group()
    world.scene.add(this.group)
    this.arcGroup = new THREE.Group()
    this.group.add(this.arcGroup)
    world.addPickable(this.arcGroup)
    this.arcs = new Map()
    this.isToday = true

    // 玻璃底環
    const base = new THREE.Mesh(
      new THREE.RingGeometry(R_IN, R_OUT, 192, 1),
      new THREE.MeshStandardMaterial({ color: '#eaf5fc', transparent: true, opacity: 0.5, roughness: 0.15, metalness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
    )
    base.rotation.x = -Math.PI / 2
    base.position.y = Y
    this.baseMat = base.material
    this.group.add(base)
    this.edgeMat = new THREE.MeshStandardMaterial({ color: '#a9d3ee', emissive: '#cfe9fa', emissiveIntensity: 0.35, roughness: 0.3 })
    for (const r of [R_IN, R_OUT]) {
      const e = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 6, 220), this.edgeMat)
      e.rotation.x = Math.PI / 2
      e.position.y = Y
      this.group.add(e)
    }

    // 刻度與時刻文字
    this.labels = []
    const tickGeo = new THREE.BoxGeometry(0.05, 0.03, 0.3)
    for (let h = 0; h < 24; h++) {
      const major = h % 3 === 0
      const tick = new THREE.Mesh(tickGeo, this.edgeMat)
      const p = ringPos(h * 60, R_OUT + 0.25)
      tick.position.copy(p)
      tick.scale.z = major ? 1.6 : 1
      tick.lookAt(0, Y, 0)
      this.group.add(tick)
      if (major) {
        const sp = textSprite(String(h), { size: 72, color: '#ffffff', scale: 0.62 })
        sp.position.copy(ringPos(h * 60, R_OUT + 1.0, Y + 0.25))
        this.labels.push(sp)
        this.group.add(sp)
      }
    }

    // 今日進度弧
    this.progMat = new THREE.MeshBasicMaterial({ color: '#ffd7e3', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })
    this.progress = new THREE.Mesh(new THREE.BufferGeometry(), this.progMat)
    this.progress.position.y = Y + 0.01
    this.group.add(this.progress)
    this._progMin = -1

    // 「現在」光點
    this.now = new THREE.Group()
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: '#fff7e6', emissive: '#ffd48f', emissiveIntensity: 2.2 }))
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd9a0', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.scale.setScalar(1.6)
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 5), new THREE.MeshBasicMaterial({ color: '#ffe3b8', transparent: true, opacity: 0.7 }))
    pin.position.y = -0.45
    this.now.add(orb, halo, pin)
    this.group.add(this.now)

    world.add((dt, t) => this.update(dt, t))
  }

  nowMinutes() {
    const h = this.sky.hour()
    return h * 60
  }

  _progressGeo(m) {
    this.progress.geometry.dispose()
    if (m < 1) {
      this.progress.geometry = new THREE.BufferGeometry()
      return
    }
    const g = new THREE.ShapeGeometry(arcShape(0, m, R_IN + 0.02, R_IN + 0.3), 1)
    g.rotateX(-Math.PI / 2)
    this.progress.geometry = g
  }

  sync(events, isToday) {
    this.isToday = isToday
    this.now.visible = isToday
    this.progress.visible = isToday
    for (const a of this.arcs.values()) {
      this.arcGroup.remove(a.mesh)
      a.mesh.geometry.dispose()
      a.mesh.material.dispose()
    }
    this.arcs.clear()

    // 重疊的日程分層堆疊
    const lanes = []
    const sorted = [...events].sort((a, b) => toMin(a.start) - toMin(b.start))
    for (const e of sorted) {
      const m0 = toMin(e.start)
      const m1 = Math.max(m0 + 10, toMin(e.end))
      let lane = lanes.findIndex((end) => end <= m0)
      if (lane < 0) lane = lanes.length
      lanes[lane] = m1
      const geo = this._arcGeo(m0, m1)
      const color = new THREE.Color(EVENT_COLORS[e.color % EVENT_COLORS.length])
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.35, transparent: true, opacity: 0.92 })
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.y = Y + 0.06 + lane * LANE_H
      mesh.userData.pick = { type: 'event', id: e.id }
      mesh.castShadow = false
      this.arcGroup.add(mesh)
      this.arcs.set(e.id, { mesh, e, m0, m1, lane, color })
    }
    this._styleArcs()
  }

  _arcGeo(m0, m1) {
    const geo = new THREE.ExtrudeGeometry(arcShape(m0 + 1.5, m1 - 1.5, R_IN + 0.14, R_OUT - 0.14), {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.05,
      bevelSegments: 2,
      curveSegments: 4,
    })
    geo.rotateX(-Math.PI / 2)
    return geo
  }

  // ── 拖曳 ──
  arc(id) {
    return this.arcs.get(id)
  }
  // 射線與某條光帶所在水平面的交點 → 分鐘數（0～1440）
  minutesOnRay(ray, y) {
    const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3())
    if (!hit) return null
    let phi = Math.atan2(hit.x, -hit.z)
    if (phi < 0) phi += Math.PI * 2
    return (phi / (Math.PI * 2)) * 1440
  }
  // 依指到的位置決定拖曳模式：兩端調整長度、中段整段移動
  dragMode(id, minutes) {
    const a = this.arcs.get(id)
    if (!a || minutes == null) return 'move'
    const edge = Math.min(14, (a.m1 - a.m0) * 0.28)
    if (Math.abs(minutes - a.m0) < edge) return 'start'
    if (Math.abs(minutes - a.m1) < edge) return 'end'
    return 'move'
  }
  previewArc(id, m0, m1) {
    const a = this.arcs.get(id)
    if (!a) return
    a.mesh.geometry.dispose()
    a.mesh.geometry = this._arcGeo(m0, m1)
  }

  _styleArcs() {
    const now = this.isToday ? this.nowMinutes() : -1
    for (const a of this.arcs.values()) {
      const mat = a.mesh.material
      const past = this.isToday && a.m1 < now
      const current = this.isToday && a.m0 <= now && now < a.m1
      a.current = current
      mat.opacity = a.e.done ? 0.5 : past ? 0.62 : 0.92
      mat.color.copy(a.color)
      if (a.e.done) mat.color.lerp(new THREE.Color('#ffffff'), 0.35)
      a.baseGlow = current ? 0.6 : a.e.done ? 0.1 : 0.25
    }
  }

  highlight(id) {
    this.hl = id
  }

  pulse(id) {
    const a = this.arcs.get(id)
    if (!a) return
    const m = a.mesh
    const y = m.position.y
    tween(0.7, (k) => (m.position.y = y + Math.sin(k * Math.PI) * 0.5), { easing: ease.outCubic })
  }

  anchor(id) {
    const a = this.arcs.get(id)
    if (!a) return null
    return ringPos((a.m0 + a.m1) / 2, (R_IN + R_OUT) / 2, Y + 0.4 + a.lane * LANE_H)
  }

  nowAnchor() {
    return this.now.position.clone().add(new THREE.Vector3(0, 0.4, 0))
  }

  update(dt, t) {
    const night = this.sky.night
    const m = this.nowMinutes()
    this.now.position.copy(ringPos(m, (R_IN + R_OUT) / 2, Y + 0.75 + Math.sin(t * 2) * 0.08))
    const whole = Math.floor(m)
    if (this.isToday && whole !== this._progMin) {
      this._progMin = whole
      this._progressGeo(whole)
      this._styleArcs()
    }
    const labelColor = night > 0.5 ? '#dfe6fb' : '#5f86ad'
    for (const sp of this.labels) sp.material.color.set(labelColor)
    this.baseMat.opacity = 0.5 - night * 0.22
    this.edgeMat.emissiveIntensity = 0.3 + night * 0.5
    for (const a of this.arcs.values()) {
      const hl = this.hl === a.e.id
      const pulse = a.current ? Math.sin(t * 3) * 0.25 : 0
      a.mesh.material.emissiveIntensity = a.baseGlow + pulse + (hl ? 0.5 : 0) + night * 0.35
    }
  }
}
