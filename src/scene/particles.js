import * as THREE from 'three'
import { glowTexture, rng, tween, ease } from './util.js'

// 飄落的櫻花瓣、夜晚螢火蟲、各種慶祝特效
export class Particles {
  constructor(world, sky) {
    this.world = world
    this.sky = sky
    this.scene = world.scene
    this.bursts = []
    this._petals()
    this._fireflies()
    world.add((dt, t) => this.update(dt, t))
  }

  _petals() {
    const n = 180
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    shape.bezierCurveTo(0.06, 0.04, 0.07, 0.11, 0.025, 0.14)
    shape.lineTo(0, 0.12)
    shape.lineTo(-0.025, 0.14)
    shape.bezierCurveTo(-0.07, 0.11, -0.06, 0.04, 0, 0)
    const geo = new THREE.ShapeGeometry(shape, 3)
    geo.center()
    const m = new THREE.MeshStandardMaterial({ color: '#f9c3d2', emissive: '#ffd3df', emissiveIntensity: 0.25, side: THREE.DoubleSide, roughness: 0.6 })
    this.petals = new THREE.InstancedMesh(geo, m, n)
    this.petals.frustumCulled = false
    const r = rng(13)
    this.petalData = []
    for (let i = 0; i < n; i++) {
      this.petalData.push({
        p: new THREE.Vector3((r() - 0.5) * 34, r() * 22 - 6, (r() - 0.5) * 34),
        rot: new THREE.Euler(r() * 6, r() * 6, r() * 6),
        spin: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(3),
        fall: 0.35 + r() * 0.45,
        sway: r() * 6,
        s: 1.2 + r() * 1.3,
      })
    }
    this._o = new THREE.Object3D()
    this.scene.add(this.petals)
  }

  _fireflies() {
    const n = 70
    const r = rng(17)
    const pos = new Float32Array(n * 3)
    this.flyData = []
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2
      const d = 1.5 + r() * 7.5
      this.flyData.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y: 0.3 + r() * 2.4, ph: r() * 10, sp: 0.3 + r() * 0.5 })
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.flyMat = new THREE.PointsMaterial({
      map: glowTexture(), color: '#e4ff9a', size: 0.5, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.flies = new THREE.Points(g, this.flyMat)
    this.flies.frustumCulled = false
    this.scene.add(this.flies)
  }

  // 一團向外散開的光點
  burst(pos, { colors = ['#ffffff', '#ffd1dc', '#f7a9bf'], count = 46, speed = 2.6, up = 2.2, gravity = -4.2, life = 1.3, size = 0.22, spread = 1 } = {}) {
    const g = new THREE.BufferGeometry()
    const p = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const vel = []
    const c = new THREE.Color()
    for (let i = 0; i < count; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3)
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize()
      const s = speed * (0.4 + Math.random() * 0.8) * spread
      vel.push(dir.multiplyScalar(s).add(new THREE.Vector3(0, up * (0.5 + Math.random() * 0.6), 0)))
      c.set(colors[i % colors.length])
      col.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const m = new THREE.PointsMaterial({ map: glowTexture(), size, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    this.scene.add(pts)
    this.bursts.push({ pts, vel, life, t: 0, gravity })
  }

  // 地面擴散的光圈
  ripple(pos, color = '#ffffff', radius = 1.6) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    )
    m.rotation.x = -Math.PI / 2
    m.position.copy(pos).setY(pos.y + 0.06)
    this.scene.add(m)
    tween(1.1, (k) => {
      m.scale.setScalar(0.2 + k * radius)
      m.material.opacity = 0.8 * (1 - k)
    }, {
      onDone: () => {
        this.scene.remove(m)
        m.geometry.dispose()
        m.material.dispose()
      },
    })
  }

  // 煙火：從島上升空再爆開
  fireworks(center, n = 5) {
    const palettes = [
      ['#ffd1dc', '#f7a9bf', '#ffffff'],
      ['#bfe3ff', '#8ec5e8', '#ffffff'],
      ['#fff1b8', '#f3cf7f', '#ffe0ec'],
      ['#d9ccff', '#b9a7e6', '#ffffff'],
      ['#c8f2dc', '#93d4b0', '#ffffff'],
    ]
    for (let i = 0; i < n; i++) {
      const start = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0.5, (Math.random() - 0.5) * 6))
      const top = start.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 6 + Math.random() * 3, (Math.random() - 0.5) * 2))
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff3d9', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      spark.scale.setScalar(0.5)
      spark.visible = false
      this.scene.add(spark)
      tween(0.9, (k) => {
        spark.visible = true
        spark.position.lerpVectors(start, top, k)
      }, {
        easing: ease.outCubic,
        delay: i * 0.35,
        onDone: () => {
          this.scene.remove(spark)
          spark.material.dispose()
          this.burst(top, { colors: palettes[i % palettes.length], count: 90, speed: 4.2, up: 0.6, gravity: -2.2, life: 1.8, size: 0.3 })
        },
      })
    }
  }

  // 專注結束：放一盞天燈慢慢升空
  skyLantern(pos) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.16, 0.4, 10),
      new THREE.MeshStandardMaterial({ color: '#fff0d8', emissive: '#ffbf7a', emissiveIntensity: 1.4, transparent: true, opacity: 0.95 }),
    )
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffcf96', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }))
    glow.scale.setScalar(1.4)
    g.add(body, glow)
    g.position.copy(pos)
    this.scene.add(g)
    const from = pos.clone()
    const drift = new THREE.Vector3((Math.random() - 0.5) * 6, 18, (Math.random() - 0.5) * 6)
    tween(9, (k) => {
      g.position.copy(from).addScaledVector(drift, k)
      g.position.x += Math.sin(k * 12) * 0.3
      body.material.opacity = glow.material.opacity = 1 - Math.max(0, (k - 0.7) / 0.3)
    }, {
      easing: ease.inOutSine,
      onDone: () => {
        this.scene.remove(g)
        body.geometry.dispose()
        body.material.dispose()
        glow.material.dispose()
      },
    })
  }

  // 摸摸もち：冒出小愛心
  hearts(pos) {
    this.burst(pos, { colors: ['#ffb3c7', '#ffd6e0', '#ffffff'], count: 14, speed: 0.9, up: 1.8, gravity: -0.6, life: 1.4, size: 0.26 })
  }

  update(dt, t) {
    // 櫻花瓣
    const o = this._o
    const wind = Math.sin(t * 0.13) * 0.4 + 0.5
    for (let i = 0; i < this.petalData.length; i++) {
      const d = this.petalData[i]
      d.p.y -= d.fall * dt
      d.p.x += (Math.sin(t * 0.9 + d.sway) * 0.35 + wind) * dt
      d.p.z += Math.cos(t * 0.7 + d.sway) * 0.25 * dt
      if (d.p.y < -9 || d.p.x > 20) {
        d.p.y = 13 + Math.random() * 4
        d.p.x = -18 + Math.random() * 20
        d.p.z = (Math.random() - 0.5) * 34
      }
      d.rot.x += d.spin.x * dt
      d.rot.y += d.spin.y * dt
      d.rot.z += d.spin.z * dt
      o.position.copy(d.p)
      o.rotation.copy(d.rot)
      o.scale.setScalar(d.s)
      o.updateMatrix()
      this.petals.setMatrixAt(i, o.matrix)
    }
    this.petals.instanceMatrix.needsUpdate = true

    // 螢火蟲（夜晚才出現）
    const night = this.sky.night
    this.flyMat.opacity = Math.max(0, night - 0.3) * 1.3
    this.flies.visible = night > 0.3
    if (this.flies.visible) {
      const arr = this.flies.geometry.attributes.position.array
      for (let i = 0; i < this.flyData.length; i++) {
        const f = this.flyData[i]
        arr[i * 3] = f.x + Math.sin(t * f.sp + f.ph) * 0.8
        arr[i * 3 + 1] = f.y + Math.sin(t * f.sp * 1.7 + f.ph * 2) * 0.4
        arr[i * 3 + 2] = f.z + Math.cos(t * f.sp * 0.8 + f.ph) * 0.8
      }
      this.flies.geometry.attributes.position.needsUpdate = true
      this.flyMat.size = 0.45 + Math.sin(t * 3) * 0.1
    }

    // 爆花
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]
      b.t += dt
      const arr = b.pts.geometry.attributes.position.array
      for (let k = 0; k < b.vel.length; k++) {
        const v = b.vel[k]
        v.y += b.gravity * dt
        v.multiplyScalar(1 - dt * 0.9)
        arr[k * 3] += v.x * dt
        arr[k * 3 + 1] += v.y * dt
        arr[k * 3 + 2] += v.z * dt
      }
      b.pts.geometry.attributes.position.needsUpdate = true
      b.pts.material.opacity = 1 - Math.pow(b.t / b.life, 2)
      if (b.t >= b.life) {
        this.scene.remove(b.pts)
        b.pts.geometry.dispose()
        b.pts.material.dispose()
        this.bursts.splice(i, 1)
      }
    }
  }
}
