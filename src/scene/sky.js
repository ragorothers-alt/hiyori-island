import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, smooth } from './util.js'
import { SUNRISE, SUNSET, sunElevation, lookHour, systemDark, realHour } from '../daylight.js'
import { CLOUD_TOP } from './shading.js'
import { SKY_GLSL, NOISE_GLSL } from './skyGlsl.js'
import { SkyArt, SKY_SRC } from './skyArt.js'

// 依真實時間變化的天空：漸層穹頂（日盤、月盤、銀河）、星星、雲與雲海
// 外觀設定（白天／夜晚／跟著系統）會改變天空顯示的時間，切換時快轉過去：變夜晚看夕陽、變白天看日出
// 新海誠式的配色：天頂是飽和的深鈷藍，往地平線很快亮成淡青白；黃昏地平線橘粉、天頂轉紫；夜晚深藍紫。
// top＝天頂、mid＝地平線、bot＝地平線以下（遠方雲海上的霧）
const KEYS = [
  { h: 0, top: '#0a1033', mid: '#26346e', bot: '#2b3468' },
  { h: 4.6, top: '#121a46', mid: '#3a4888', bot: '#454b86' },
  { h: 6, top: '#3a5aa8', mid: '#f6c4b2', bot: '#e3c1cc' },
  { h: 8, top: '#1d5fc6', mid: '#bde2f7', bot: '#d9ebf6' },
  { h: 12, top: '#1450c0', mid: '#acd9f4', bot: '#dcedf8' },
  { h: 16, top: '#1b5ac2', mid: '#bfe0f3', bot: '#e1ecf5' },
  { h: 18, top: '#4256a6', mid: '#ffbd98', bot: '#efc0c2' },
  { h: 19.4, top: '#262f74', mid: '#c387a6', bot: '#8a77ab' },
  { h: 20.8, top: '#10184a', mid: '#33407e', bot: '#363d73' },
  { h: 24, top: '#0a1033', mid: '#26346e', bot: '#2b3468' },
].map((k) => ({ h: k.h, top: new THREE.Color(k.top), mid: new THREE.Color(k.mid), bot: new THREE.Color(k.bot) }))

// 月亮掛在預設視角看得到的天空：島的左後方、地平線上方約 4°（預設視角只看得到地平線上方 8° 左右），避開左上角的等級卡
const MOON_SKY = new THREE.Vector3(-0.17, 0.072, -0.98).normalize()

const C_GOLD = new THREE.Color('#ffc6a8')
const C_GOLD2 = new THREE.Color('#ffc9a6')
const C_WHITE = new THREE.Color('#ffffff')
const C_NIGHT_GROUND = new THREE.Color('#3a3f72')
const MOON_DIR = new THREE.Vector3(-0.45, 1, 0.35).normalize()
const C_KEY_DAY = new THREE.Color('#fff3df')
const C_KEY_MOON = new THREE.Color('#a9bcff')
const C_BOUNCE = new THREE.Color('#ead9c4')
const C_SEA_SHADE = new THREE.Color('#bcb9ea')
const C_SEA_NIGHT_LIT = new THREE.Color('#6f78bf')
const C_SEA_NIGHT_SHADE = new THREE.Color('#2b3165')
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

    // 穹頂：跟著鏡頭走（地平線永遠在眼睛的高度），畫天空漸層、日盤與光暈、夜晚的月亮和銀河
    this.uniforms = {
      uTop: { value: this.top },
      uMid: { value: this.mid },
      uBot: { value: this.bot },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff2dc') },
      uSunVis: { value: 1 },
      uMoonDir: { value: MOON_SKY },
      uNight: { value: 0 },
      uMoonMap: { value: null },
      uMoonReady: { value: 0 },
    }
    if (typeof document !== 'undefined') {
      new THREE.TextureLoader().load(SKY_SRC.moon, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        this.uniforms.uMoonMap.value = tex
        this.uniforms.uMoonReady.value = 1
      })
    }
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(800, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          ${SKY_GLSL}
          ${NOISE_GLSL}
          uniform vec3 uSunDir, uSunColor, uMoonDir;
          uniform float uSunVis, uNight, uMoonReady;
          uniform sampler2D uMoonMap;
          varying vec3 vDir;
          void main() {
            vec3 dir = normalize(vDir);
            float h = dir.y;
            vec3 col = skyColor(h);
            float sd = max(dot(dir, uSunDir), 0.0);
            // 地平線一圈亮帶，靠太陽那一側更暖更亮
            col += uSunColor * exp(-abs(h) * 16.0) * (0.05 + 0.4 * pow(sd, 4.0)) * uSunVis;
            // 日盤（夠亮才會泛光）＋光暈
            col += uSunColor * (smoothstep(0.99965, 0.99978, sd) * 12.0 + pow(sd, 500.0) * 1.6 + pow(sd, 36.0) * 0.28 + pow(sd, 5.0) * 0.08) * uSunVis;
            if (uNight > 0.01) {
              float above = smoothstep(-0.01, 0.12, h);
              // 銀河：斜斜跨過天空的一條雲狀光帶，中間有暗色的塵帶
              vec3 bn = normalize(vec3(0.55, 0.45, 0.7));
              float b = dot(dir, bn);
              float band = exp(-b * b * 26.0);
              float n = fbm3(dir * 5.0);
              float n2 = fbm3(dir * 16.0 + 3.1);
              float mw = band * smoothstep(0.32, 0.8, n) * (0.55 + 0.7 * n2);
              col += mix(vec3(0.42, 0.5, 1.0), vec3(1.0, 0.78, 0.95), n2) * mw * 0.5 * uNight * above;
              col *= 1.0 - band * smoothstep(0.5, 0.72, n2) * 0.22 * uNight * above;
              // 月亮：手繪的月盤（載好之前用雜訊畫的圓盤＋月海）＋藍色光暈
              float md = dot(dir, uMoonDir);
              if (uMoonReady > 0.5) {
                vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
                vec3 my = cross(mx, uMoonDir);
                // 月盤半徑約 2.2°（tan ≈ 0.0385），原圖的圓盤佔整張寬度 86%
                vec2 muv = vec2(dot(dir, mx), dot(dir, my)) / (2.0 * 0.0385 / 0.86) + 0.5;
                if (md > 0.0 && abs(muv.x - 0.5) < 0.5 && abs(muv.y - 0.5) < 0.5) {
                  vec4 mt = texture2D(uMoonMap, muv);
                  col = mix(col, mt.rgb * 1.9, mt.a * uNight);
                }
              } else {
                float disc = smoothstep(0.99925, 0.99942, md);
                float maria = fbm3(dir * 120.0);
                col = mix(col, vec3(1.0, 0.97, 0.88) * (1.9 - maria * 0.55), disc * uNight);
              }
              col += vec3(0.62, 0.7, 1.0) * (pow(max(md, 0.0), 260.0) * 0.7 + pow(max(md, 0.0), 18.0) * 0.12) * uNight;
            }
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    )
    dome.renderOrder = -10
    dome.frustumCulled = false
    scene.add(dome)
    this.dome = dome
    this._cloudSea(scene)

    scene.fog = new THREE.Fog(this.bot, 90, 320)

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
    const { uTop, uMid, uBot, uSunDir, uSunColor } = this.uniforms
    this.art = new SkyArt(scene, { uTop, uMid, uBot, uSunDir, uSunColor, uLit: this.seaUniforms.uLit, uShade: this.seaUniforms.uShade })
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
    stars.renderOrder = -9.5 // 在遠景畫之前畫，星星會被雲和浮島擋住
    scene.add(stars)
    this.stars = stars
  }

  // 雲海：島下方一整片不透明的雲頂平面，跟著鏡頭的水平位置走、一直延伸到地平線附近。
  // 雲朵起伏用雜訊畫：朝太陽那一側亮、背面是藍紫色的陰影，遠處漸漸融進穹頂地平線以下的顏色
  _cloudSea(scene) {
    this.seaUniforms = {
      uTop: { value: this.top },
      uMid: { value: this.mid },
      uBot: { value: this.bot },
      uSunDir: { value: this.uniforms.uSunDir.value },
      uSunColor: { value: this.uniforms.uSunColor.value },
      uLit: { value: new THREE.Color() },
      uShade: { value: new THREE.Color() },
      uDay: { value: 1 },
      uTime: { value: 0 },
      uTile: { value: null },
      uTileOn: { value: 0 },
    }
    if (typeof document !== 'undefined') {
      new THREE.TextureLoader().load(SKY_SRC.sea, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        tex.anisotropy = 8
        this.seaUniforms.uTile.value = tex
        this.seaUniforms.uTileOn.value = 1
      })
    }
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(1700, 1700).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        fog: false,
        uniforms: this.seaUniforms,
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          ${SKY_GLSL}
          ${NOISE_GLSL}
          uniform vec3 uSunDir, uSunColor, uLit, uShade;
          uniform float uDay, uTime, uTileOn;
          uniform sampler2D uTile;
          varying vec3 vWorld;
          vec2 hash22(vec2 p) {
            p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return fract(sin(p) * 43758.5453);
          }
          // 細胞雜訊：每格一顆會慢慢漂的種子，離最近種子的距離 → 一團團圓頂
          float worley(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            float d = 1.0;
            for (int y = -1; y <= 1; y++)
              for (int x = -1; x <= 1; x++) {
                vec2 g = vec2(float(x), float(y));
                vec2 o = hash22(i + g);
                o = 0.5 + 0.4 * sin(uTime * 0.04 + 6.2831 * o);
                vec2 r = g + o - f;
                d = min(d, dot(r, r));
              }
            return sqrt(d);
          }
          // 雲頂高度：大團的圓頂上再疊小團，加一點細碎起伏；近處再疊上手繪雲海圖的明暗當筆觸
          float tileL(vec2 p) {
            return dot(texture2D(uTile, p * 0.14).rgb, vec3(0.2126, 0.7152, 0.0722));
          }
          float cloudH(vec2 p) {
            float h = (1.0 - worley(p)) * 0.62 + (1.0 - worley(p * 2.3 + 5.0)) * 0.28 + noise2(p * 6.0) * 0.1;
            if (uTileOn > 0.5) h += (tileL(p) - 0.55) * 0.5;
            return h;
          }
          void main() {
            vec3 to = vWorld - cameraPosition;
            float dist = length(to);
            vec3 dir = to / dist;
            vec2 p = vWorld.xz * 0.075 + vec2(uTime * 0.01, uTime * 0.006);
            float h = cloudH(p);
            // 往太陽的方向偏一點再取一次：高度差就是朝光面的亮度；低的地方是雲團之間的陰影
            vec2 toSun = normalize(uSunDir.xz + vec2(1e-4));
            float hs = cloudH(p - toSun * 0.11);
            float lit = clamp(0.5 + (h - hs) * 3.2 + (h - 0.45) * 0.9, 0.0, 1.0);
            // 遠處的細節收掉，避免斜看時變成一條條細紋
            float near = 1.0 - smoothstep(50.0, 260.0, dist);
            lit = mix(0.62, lit, near);
            vec3 col = mix(uShade, uLit, lit);
            col *= mix(1.0, mix(0.86, 1.04, smoothstep(0.15, 0.7, h)), near);
            // 手繪圖的色彩變化（暖白的頂、藍紫的谷）淡淡疊上
            if (uTileOn > 0.5) col = mix(col, mix(uShade, uLit, smoothstep(0.25, 0.95, tileL(p))), 0.3 * near);
            // 往太陽方向看過去，雲海會透出一層暖光
            float fs = pow(max(dot(normalize(dir.xz + vec2(1e-4)), normalize(uSunDir.xz + vec2(1e-4))), 0.0), 5.0);
            col += uSunColor * fs * 0.16 * uDay;
            col = mix(col, skyColor(dir.y), smoothstep(110.0, 760.0, dist));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    )
    sea.position.y = CLOUD_TOP
    sea.frustumCulled = false
    sea.renderOrder = -9
    scene.add(sea)
    this.sea = sea
  }

  // 島下半埋在雲海裡、只露出頂部的近處雲團，讓雲海有立體感（天上的雲改成 SkyArt 的手繪積雨雲）。
  // 畫法跟雲海一樣：朝光面是雲海的亮色、背光是藍紫，表面用雜訊擾動法線做出一球球的花椰菜感，邊緣鑲一圈亮光；
  // 全部合併成一個網格，一次畫完
  _clouds(scene) {
    const r = rng(21)
    const puff = new THREE.IcosahedronGeometry(1, 3)
    this.cloudMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: this.seaUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${SKY_GLSL}
        ${NOISE_GLSL}
        uniform vec3 uSunDir, uLit, uShade;
        varying vec3 vN;
        varying vec3 vWorld;
        void main() {
          vec3 to = vWorld - cameraPosition;
          float dist = length(to);
          vec3 dir = to / dist;
          vec3 q = vWorld * 0.8;
          vec3 n = normalize(vN + (vec3(noise3(q), noise3(q + 7.1), noise3(q + 13.7)) - 0.5) * 1.1);
          // 光從太陽那一側的上方來：雲頂一定亮
          vec3 L = normalize(uSunDir + vec3(0.0, 0.9, 0.0));
          float lit = smoothstep(-0.3, 0.75, dot(n, L));
          vec3 col = mix(uShade, uLit, lit);
          col += uLit * pow(1.0 - abs(dot(normalize(vN), dir)), 3.0) * 0.22;
          // 沉在雲海頂面以下的部分融成雲海的顏色，遠處融進天色
          col = mix(col, mix(uShade, uLit, 0.62), smoothstep(${(CLOUD_TOP + 0.9).toFixed(1)}, ${(CLOUD_TOP - 0.3).toFixed(1)}, vWorld.y));
          col = mix(col, skyColor(dir.y), smoothstep(110.0, 760.0, dist));
          gl_FragColor = vec4(col, 1.0);
        }`,
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
    const parts = []
    const m = new THREE.Matrix4()
    for (let i = 0; i < 34; i++) {
      const g = makeCloud(2.4 + r() * 2.8, 0.45)
      const a = (i / 34) * Math.PI * 2 + r() * 0.3
      const d = 14 + r() * 50
      m.makeRotationY(r() * Math.PI).setPosition(Math.cos(a) * d, CLOUD_TOP - 0.6 - r() * 1.4, Math.sin(a) * d)
      parts.push(g.applyMatrix4(m))
    }
    this.seaClouds = new THREE.Mesh(mergeGeometries(parts), this.cloudMat)
    scene.add(this.seaClouds)
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
    this.hemi.color.copy(this.top).lerp(C_WHITE, 0.55)
    this.hemi.groundColor.copy(C_BOUNCE).lerp(C_NIGHT_GROUND, this.night)
    this.hemi.intensity = 0.62 + day * 0.4

    this.starMat.uniforms.uOpacity.value = smooth(0.35, 0.95, this.night)
    this.starMat.uniforms.uTime.value = t

    this.seaClouds.rotation.y -= dt * 0.003

    // 雲海：亮面帶太陽的顏色、暗面是偏天空色的藍紫；夜晚整片是月光下的藍紫
    const su = this.seaUniforms
    su.uLit.value.copy(C_WHITE).lerp(this.uniforms.uSunColor.value, 0.4).lerp(C_SEA_NIGHT_LIT, this.night)
    su.uShade.value.copy(this.top).lerp(C_SEA_SHADE, 0.62).lerp(C_SEA_NIGHT_SHADE, this.night)
    su.uDay.value = day
    su.uTime.value = t
    // 霧色＝雲海的平均色：沉進雲海的東西會融成雲的顏色
    this.world.scene.fog.color.copy(su.uLit.value).lerp(su.uShade.value, 0.4)
    this.uniforms.uNight.value = this.night
    // 穹頂、星星、雲海跟著鏡頭：地平線永遠在眼睛的高度，雲海永遠鋪到天邊
    const cam = this.world.camera.position
    this.dome.position.copy(cam)
    this.stars.position.copy(cam)
    // 遠景畫：白天保留原畫，黃昏染上太陽色、改用雲海的亮暗色，夜晚整片是月光下的藍紫剪影
    const golden2 = golden * day
    const A = this.art.uniforms
    A.uTint.value.copy(C_WHITE).lerp(this.uniforms.uSunColor.value, golden2 * 0.55)
    A.uRemap.value = mix(golden2 * 0.38, 0.88, this.night)
    A.uGlow.value = golden2 * 0.7
    A.uNight.value = smooth(0.4, 0.9, this.night)
    this.art.update(dt, cam)
    this.sea.position.x = cam.x
    this.sea.position.z = cam.z

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
