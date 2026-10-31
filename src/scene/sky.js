import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, smooth } from './util.js'
import { SUNRISE, SUNSET, sunElevation, lookHour, systemDark, realHour } from '../daylight.js'

// 依真實時間變化的天空：漸層穹頂、太陽/月光、星星、雲與雲海
// 外觀設定（白天／夜晚／跟著系統）會改變天空顯示的時間，切換時快轉過去：變夜晚看夕陽、變白天看日出
const KEYS = [
  { h: 0, top: '#121a3d', mid: '#283667', bot: '#454a82' },
  { h: 4.6, top: '#1b2350', mid: '#36467a', bot: '#62649a' },
  { h: 6, top: '#8eb0de', mid: '#f6d6dc', bot: '#e9d3e3' },
  { h: 8, top: '#6fb6e8', mid: '#e3f2fb', bot: '#bfe0f4' },
  { h: 12, top: '#5aaee6', mid: '#dff1fb', bot: '#b4dbf3' },
  { h: 16, top: '#6db4e4', mid: '#e7f2f8', bot: '#c6e0f1' },
  { h: 18, top: '#8a9ed6', mid: '#f6cad0', bot: '#e6c8d8' },
  { h: 19.4, top: '#3b4884', mid: '#998cc1', bot: '#e0b3c4' },
  { h: 20.8, top: '#192147', mid: '#323f77', bot: '#525590' },
  { h: 24, top: '#121a3d', mid: '#283667', bot: '#454a82' },
].map((k) => ({ h: k.h, top: new THREE.Color(k.top), mid: new THREE.Color(k.mid), bot: new THREE.Color(k.bot) }))

const C_GOLD = new THREE.Color('#ffc6a8')
const C_GOLD2 = new THREE.Color('#ffc9a6')
const C_WHITE = new THREE.Color('#ffffff')
const C_NIGHT_GROUND = new THREE.Color('#3a3f72')
const C_NIGHT_CLOUD = new THREE.Color('#3f477c')
const C_MOON_GLOW = new THREE.Color('#7d8fd8')
const C_DAY_GLOW = new THREE.Color('#ffffff')
const MOON_DIR = new THREE.Vector3(-0.45, 1, 0.35).normalize()
const C_KEY_DAY = new THREE.Color('#fff3df')
const C_KEY_MOON = new THREE.Color('#a9bcff')
const C_BOUNCE = new THREE.Color('#ead9c4')
const _sunDir = new THREE.Vector3()
const _keyDir = new THREE.Vector3()
const _c = new THREE.Color()
const mix = (a, b, k) => a + (b - a) * k
const mix3 = (out, a, b, k) => {
  for (let i = 0; i < 3; i++) out[i] = mix(a[i], b[i], k)
  return out
}
// 調色（後製 lift/gamma/gain）：白天陰影帶一點藍、亮部微暖；黃昏整體偏暖；夜晚偏藍紫
const GRADE = {
  day: { lift: [0.012, 0.024, 0.055], gamma: [1, 1, 1], gain: [1.03, 1.01, 0.97], sat: 1.08 },
  gold: { lift: [0.03, 0.016, 0.05], gamma: [1, 0.99, 0.97], gain: [1.06, 0.99, 0.92], sat: 1.1 },
  night: { lift: [0.02, 0.022, 0.06], gamma: [1, 1, 1.03], gain: [0.97, 0.99, 1.05], sat: 1.05 },
}

export class Sky {
  constructor(world) {
    this.world = world
    const scene = world.scene
    this.top = new THREE.Color()
    this.mid = new THREE.Color()
    this.bot = new THREE.Color()
    this.night = 0
    this.hourOverride = null
    this.theme = 'auto'
    this.shown = null // 天空正在顯示的時間（快轉中會超過 24）
    this._shift = null // 切換外觀時的快轉：{ from, ahead, t, sec }
    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        if (this.theme === 'system') this._retarget(() => {})
      })
    }

    // 穹頂
    this.uniforms = {
      uTop: { value: this.top },
      uMid: { value: this.mid },
      uBot: { value: this.bot },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff2dc') },
      uSunVis: { value: 1 },
    }
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(320, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uMid, uBot, uSunDir, uSunColor;
          uniform float uSunVis;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 col = h > 0.0
              ? mix(uMid, uTop, pow(smoothstep(0.0, 0.85, h), 0.7))
              : mix(uMid, uBot, smoothstep(0.0, -0.35, h));
            float d = max(dot(normalize(vDir), uSunDir), 0.0);
            col += uSunColor * (pow(d, 900.0) * 1.6 + pow(d, 40.0) * 0.18 + pow(d, 6.0) * 0.08) * uSunVis;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    )
    dome.renderOrder = -10
    dome.frustumCulled = false
    scene.add(dome)
    this.dome = dome

    scene.fog = new THREE.Fog(this.mid, 80, 280)

    // 光
    this.hemi = new THREE.HemisphereLight('#eaf6ff', '#f3e2d6', 1.4)
    scene.add(this.hemi)
    const sun = (this.sun = new THREE.DirectionalLight('#fff4e6', 2))
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.radius = 4
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.03
    const sc = sun.shadow.camera
    sc.left = sc.bottom = -16
    sc.right = sc.top = 16
    sc.near = 1
    sc.far = 80
    scene.add(sun, sun.target)

    // 這一幀的整體色調（world 每幀套到泛光和最後一道後製）
    this.look = {
      night: 0,
      exposure: 1,
      glare: 0,
      sunDir: new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color('#fff1d6'),
      bloom: { strength: 0.3, threshold: 0.95, radius: 0.5, knee: 0.25 },
      lift: [0, 0, 0],
      gamma: [1, 1, 1],
      gain: [1, 1, 1],
      sat: 1,
      vignette: 0.2,
    }
    world.look = this.look

    this._stars(scene)
    this._clouds(scene)
    world.add((dt, t) => this.update(dt, t))
    this.update(0, 0)
  }

  // 真實時間（時之環的「現在」用這個）
  hour() {
    if (this.hourOverride != null) return this.hourOverride
    return realHour()
  }

  setTheme(theme) {
    if (theme !== this.theme) this._retarget(() => (this.theme = theme))
  }
  // 切換外觀後天色還在快轉
  get shifting() {
    return !!this._shift
  }
  // 依外觀，天空該顯示的時間（0–24）
  _target() {
    return lookHour(((this.hour() % 24) + 24) % 24, this.theme, systemDark())
  }
  // 一律往後快轉到新的時間，跑過的時數越多稍微久一點
  _retarget(change) {
    const from = this.shown ?? this._target()
    change()
    const ahead = (((this._target() - from) % 24) + 24) % 24
    if (ahead < 0.05 || ahead > 23.95) return
    const sec = 1.2 + ahead * 0.08
    this._shift = { from, ahead, t: 0, sec }
    this.world.keepAwake(sec * 1000 + 300)
  }

  _stars(scene) {
    const n = 900
    const r = rng(7)
    const pos = new Float32Array(n * 3)
    const phase = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const u = r() * Math.PI * 2
      const v = Math.acos(1 - r() * 0.95)
      pos.set([Math.sin(v) * Math.cos(u) * 290, Math.cos(v) * 290, Math.sin(v) * Math.sin(u) * 290], i * 3)
      phase[i] = r()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
    this.starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uPR: { value: Math.min(devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `
        attribute float phase;
        uniform float uTime, uOpacity, uPR;
        varying float vA;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (1.4 + phase * 2.2) * uPR;
          vA = uOpacity * (0.55 + 0.45 * sin(uTime * (0.8 + phase * 2.0) + phase * 40.0));
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(1.0, 0.97, 0.9, vA * smoothstep(0.5, 0.0, d));
        }`,
    })
    const stars = new THREE.Points(g, this.starMat)
    stars.frustumCulled = false
    scene.add(stars)
  }

  _clouds(scene) {
    const r = rng(21)
    const puff = new THREE.IcosahedronGeometry(1, 3)
    this.cloudMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 1,
      emissive: '#ffffff',
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.94,
    })
    const makeCloud = (scale, flat) => {
      const parts = []
      const count = 5 + Math.floor(r() * 4)
      for (let i = 0; i < count; i++) {
        const g = puff.clone()
        const s = (0.7 + r() * 0.7) * (i === 0 ? 1.4 : 1)
        g.scale(s, s * flat, s)
        g.translate((i - count / 2) * 0.9 + r() * 0.6, r() * 0.5 * flat, (r() - 0.5) * 1.4)
        parts.push(g)
      }
      const merged = mergeGeometries(parts)
      merged.scale(scale, scale, scale)
      return merged
    }
    // 天空中的雲
    this.skyClouds = new THREE.Group()
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(makeCloud(2.2 + r() * 2.4, 0.6), this.cloudMat)
      const a = r() * Math.PI * 2
      const d = 55 + r() * 60
      m.position.set(Math.cos(a) * d, -2 + r() * 24, Math.sin(a) * d)
      m.rotation.y = r() * Math.PI
      this.skyClouds.add(m)
    }
    // 島下的雲海
    this.seaClouds = new THREE.Group()
    for (let i = 0; i < 34; i++) {
      const m = new THREE.Mesh(makeCloud(2.4 + r() * 2.8, 0.45), this.cloudMat)
      const a = (i / 34) * Math.PI * 2 + r() * 0.3
      const d = 14 + r() * 50
      m.position.set(Math.cos(a) * d, -15 - r() * 6, Math.sin(a) * d)
      m.rotation.y = r() * Math.PI
      this.seaClouds.add(m)
    }
    scene.add(this.skyClouds, this.seaClouds)
  }

  update(dt, t) {
    let shown = this._target()
    const s = this._shift
    if (s) {
      s.t = Math.min(1, s.t + dt / s.sec)
      shown = s.from + s.ahead * smooth(0, 1, s.t)
      if (s.t >= 1) this._shift = null
    }
    this.shown = shown
    const h = ((shown % 24) + 24) % 24
    // 天色插值
    let i = 0
    while (i < KEYS.length - 2 && h >= KEYS[i + 1].h) i++
    const a = KEYS[i]
    const b = KEYS[i + 1]
    const k = smooth(0, 1, (h - a.h) / (b.h - a.h))
    this.top.lerpColors(a.top, b.top, k)
    this.mid.lerpColors(a.mid, b.mid, k)
    this.bot.lerpColors(a.bot, b.bot, k)
    this.world.scene.fog.color.copy(this.mid)

    // 天空裡的太陽（日盤、光暈、雲的亮邊）：右後方升起 → 島的後上方 → 左後方落下，
    // 低角度時會出現在鏡頭前方的天空裡
    const p = (h - SUNRISE) / (SUNSET - SUNRISE)
    const elev = sunElevation(h)
    const sunDir = _sunDir.set(Math.cos(Math.PI * p), elev * 1.25 + 0.05, -0.55).normalize()
    const day = smooth(-0.08, 0.32, elev)
    this.day = day
    this.night = 1 - day
    this.uniforms.uSunDir.value.copy(sunDir)
    const sunVis = smooth(-0.05, 0.1, elev)
    this.uniforms.uSunVis.value = sunVis
    const golden = 1 - smooth(0.12, 0.5, elev)
    this.uniforms.uSunColor.value.set('#fff4dc').lerp(C_GOLD, golden)

    // 主光（投影子）和天空的太陽分開：一直保持在鏡頭這一側約 3/4 正面、仰角 25° 以上，花和貓不會逆光；
    // 白天的太陽方向和夜晚的月光方向連續插值，日落時不會突然跳
    const az = Math.cos(Math.PI * THREE.MathUtils.clamp(p, 0, 1)) * 0.9
    const theta = THREE.MathUtils.degToRad(mix(25, 62, THREE.MathUtils.clamp(elev, 0, 1)))
    const flat = Math.hypot(az, 0.6)
    _keyDir.set((az / flat) * Math.cos(theta), Math.sin(theta), (0.6 / flat) * Math.cos(theta))
    _keyDir.lerp(MOON_DIR, this.night).normalize()
    const sun = this.sun
    sun.position.copy(_keyDir).multiplyScalar(40)
    sun.target.position.set(0, 0, 0)
    sun.color.copy(C_KEY_MOON).lerp(_c.copy(C_KEY_DAY).lerp(C_GOLD2, golden * 0.8), day)
    sun.intensity = mix(0.7, 2.3, day)

    // 半球光：天空那一面偏藍，陰影裡自然帶藍；地面那一面是暖色的反光
    this.hemi.color.copy(this.top).lerp(C_WHITE, 0.4)
    this.hemi.groundColor.copy(C_BOUNCE).lerp(C_NIGHT_GROUND, this.night)
    this.hemi.intensity = 0.62 + day * 0.4

    this.starMat.uniforms.uOpacity.value = smooth(0.35, 0.95, this.night)
    this.starMat.uniforms.uTime.value = t

    this.cloudMat.color.set('#ffffff').lerp(this.bot, 0.3).lerp(C_NIGHT_CLOUD, this.night * 0.8)
    this.cloudMat.emissive.copy(C_DAY_GLOW).lerp(C_MOON_GLOW, this.night)
    this.cloudMat.emissiveIntensity = 0.05 + day * 0.1 + this.night * 0.08
    this.skyClouds.rotation.y += dt * 0.006
    this.seaClouds.rotation.y -= dt * 0.003

    const L = this.look
    const n = this.night
    L.night = n
    L.exposure = mix(1, 1.12, n)
    L.sunDir.copy(sunDir)
    L.sunColor.copy(this.uniforms.uSunColor.value)
    L.glare = sunVis * mix(0.5, 0.75, golden)
    const B = L.bloom
    // 白天受光的白色表面、自帶微光的貓和花苞 HDR 亮度大約到 1.5，門檻高過它們，只讓日盤和真正的高光泛光；
    // 夜晚門檻也不能太低，不然滿天星星會糊成一片，留給燈籠、窗光這些亮度 2 以上的光源
    B.strength = mix(0.22, 0.55, n)
    B.threshold = mix(2.0, 1.35, n)
    B.radius = mix(0.4, 0.55, n)
    B.knee = mix(0.3, 0.3, n)
    const g = golden * day
    for (const k of ['lift', 'gamma', 'gain']) mix3(mix3(L[k], GRADE.day[k], GRADE.gold[k], g), L[k], GRADE.night[k], n)
    L.sat = mix(mix(GRADE.day.sat, GRADE.gold.sat, g), GRADE.night.sat, n)
    L.vignette = mix(0.18, 0.3, n)
  }
}
