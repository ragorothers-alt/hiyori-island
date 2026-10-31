import * as THREE from 'three'
import { SKY_GLSL } from './skyGlsl.js'
import { CLOUD_TOP } from './shading.js'

// 畫出來的遠景（Codex 手繪素材）：一圈地平線雲堤、幾朵主角積雨雲、遠方的浮島和城堡都市。
// 全部是以鏡頭為圓心的圓柱面，跟著鏡頭移動（遠景不會因為鏡頭繞島而跑掉），只有轉動時看得到它們在天邊移動。
// 顏色在 shader 裡依時段重新上色：白天保留原畫，黃昏染暖、夜晚變成月光下的藍紫剪影，城堡的窗戶亮燈。
const SRC = {
  far: new URL('../assets/sky/horizon_far.webp', import.meta.url).href,
  mid: new URL('../assets/sky/horizon_mid.webp', import.meta.url).href,
  midLights: new URL('../assets/sky/horizon_mid_lights.webp', import.meta.url).href,
  cumulus: [
    new URL('../assets/sky/cumulus_01.webp', import.meta.url).href,
    new URL('../assets/sky/cumulus_02.webp', import.meta.url).href,
    new URL('../assets/sky/cumulus_03.webp', import.meta.url).href,
    new URL('../assets/sky/cumulus_04.webp', import.meta.url).href,
    new URL('../assets/sky/cumulus_05.webp', import.meta.url).href,
    new URL('../assets/sky/cumulus_06.webp', import.meta.url).href,
  ],
  moon: new URL('../assets/sky/moon.webp', import.meta.url).href,
  sea: new URL('../assets/sky/cloudsea_tile.webp', import.meta.url).href,
}
export const SKY_SRC = SRC

const deg = THREE.MathUtils.degToRad
// 地平線長條的地平線（雲海頂端）在原圖由上往下 77% 的地方
const HORIZON_ROW = 0.77

// 遠方雲堤：繞一圈重複 3 次，垂直壓扁一點，雲塔約 12° 高（預設視角天空只露出地平線上方 11° 左右）
const FAR = { r: 700, copies: 3, squash: 0.75, offset: deg(-14) }
// 遠方浮島：原圖切成三段放在不同方位。px 是每度幾個原圖像素（越大越遠越小），城堡島約 6° 高
const MID_R = 560
const MID = [
  { u: [0.0, 0.4], at: deg(-21), px: 88 }, // 左邊的小島＋城堡都市（在等級卡和月亮之間的天空）
  { u: [0.43, 0.67], at: deg(14), px: 120 }, // 日期列右下方
  { u: [0.73, 1.0], at: deg(-78), px: 100 },
]
// 主角積雨雲：[圖, 方位, 每度幾個像素, 雲底的仰角]；BOTTOM 是每張圖雲底在原圖由上往下的位置
const CUMULUS_R = 630
const BOTTOM = [0.94, 0.95, 0.8, 0.77, 0.75, 0.85]
const CUMULUS = [
  [1, deg(25), 66, deg(-1.2)], // 蕈狀雲塔：島的右後方，撐起畫面右側
  [0, deg(-34), 70, deg(-1.4)], // 高聳雲塔：左側
  [2, deg(4), 118, deg(-0.6)], // 寬雲堤：島正後方，大半被島擋住，只露出頂
  [3, deg(-62), 70, deg(-0.8)],
  [4, deg(62), 80, deg(-0.6)],
  [5, deg(178), 70, deg(-0.8)],
]

// 以鏡頭為圓心的圓柱面一段。方位 a：0＝鏡頭正前方（-z），往右為正；e 是仰角。
// u 跟著方位往右增加；v 依原圖的列（0 在上）換算。edge 是左右邊緣的淡出座標（0..1），整圈的用 0.5
function arc({ r, a0, a1, e0, e1, u0, u1, f0, f1, wrap = false }) {
  const seg = Math.max(4, Math.ceil(((a1 - a0) / Math.PI) * 48))
  const rows = 4
  const pos = []
  const uv = []
  const edge = []
  const idx = []
  for (let i = 0; i <= seg; i++) {
    const k = i / seg
    const a = a0 + (a1 - a0) * k
    for (let j = 0; j <= rows; j++) {
      const q = j / rows
      const e = e0 + (e1 - e0) * q
      pos.push(r * Math.sin(a), r * Math.tan(e), -r * Math.cos(a))
      uv.push(u0 + (u1 - u0) * k, 1 - (f0 + (f1 - f0) * q))
      edge.push(wrap ? 0.5 : k)
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < rows; j++) {
      const p = i * (rows + 1) + j
      const n = p + rows + 1
      idx.push(p, n, p + 1, n, n + 1, p + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1))
  g.setIndex(idx)
  return g
}

// 一張原圖上的一段（u0..u1、列 f0..f1）照比例放到天上：px＝每度幾個原圖像素，地平線那一列對齊仰角 base
function placed(img, { u0, u1, f0 = 0, f1 = 1, at, px, base = 0, r, squash = 1 }) {
  const w = ((u1 - u0) * img.width) / px
  const vpx = px / squash
  const a0 = at - deg(w / 2)
  return { r, a0, a1: a0 + deg(w), e0: base + deg(((HORIZON_ROW - f0) * img.height) / vpx), e1: base + deg(((HORIZON_ROW - f1) * img.height) / vpx), u0, u1, f0, f1 }
}

const VERT = /* glsl */ `
  attribute float edge;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vEdge;
  void main() {
    vUv = uv;
    vEdge = edge;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const FRAG = /* glsl */ `
  ${SKY_GLSL}
  uniform sampler2D map;
  #ifdef LIGHTS
  uniform sampler2D lightMap;
  #endif
  uniform vec3 uTint, uLit, uShade, uSunDir, uSunColor;
  uniform float uRemap, uGlow, uNight, uHaze, uSeaTop;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vEdge;
  void main() {
    vec4 t = texture2D(map, vUv);
    vec3 to = vWorld - cameraPosition;
    float flat_ = length(to.xz);
    vec3 dir = to / length(to);
    float l = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
    // 依時段重新上色：白天幾乎是原畫，黃昏和夜晚改用雲海的亮面／暗面色，原畫的明暗留著
    vec3 col = mix(t.rgb * uTint, mix(uShade, uLit, smoothstep(0.06, 0.92, l)), uRemap);
    // 太陽那一側的亮部鑲一層暖光（黃昏最明顯）
    float sd = max(dot(normalize(dir.xz + 1e-4), normalize(uSunDir.xz + 1e-4)), 0.0);
    col += uSunColor * pow(sd, 6.0) * uGlow * smoothstep(0.3, 0.9, l);
    // 空氣透視：越遠越融進那個高度的天色
    col = mix(col, skyColor(dir.y), uHaze);
    float a = t.a * smoothstep(0.0, 0.12, vEdge) * smoothstep(1.0, 0.88, vEdge);
    // 雲海平面在這個距離會擋住某個仰角以下的部分，先淡掉，不留一條切線
    float occ = (uSeaTop - cameraPosition.y) / flat_;
    a *= smoothstep(occ, occ * 0.35, to.y / flat_);
    #ifdef LIGHTS
    float lt = texture2D(lightMap, vUv).r * uNight;
    col += vec3(1.0, 0.7, 0.38) * lt * 9.0;
    #endif
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`

export class SkyArt {
  // shared：Sky 的穹頂 uniform（天色、太陽）和雲海的亮暗色，這裡直接共用同一個物件，Sky.update 改了就生效
  constructor(scene, shared) {
    this.group = new THREE.Group()
    this.group.name = 'skyArt'
    scene.add(this.group)
    this.cumulus = new THREE.Group()
    this.group.add(this.cumulus)
    this.uniforms = {
      ...shared,
      uTint: { value: new THREE.Color(1, 1, 1) },
      uRemap: { value: 0 },
      uGlow: { value: 0 },
      uNight: { value: 0 },
      uSeaTop: { value: CLOUD_TOP },
    }
    if (typeof document === 'undefined') return // 測試環境沒有圖片可以載
    const loader = new THREE.TextureLoader()
    const load = (url, color = true) =>
      new Promise((resolve) => {
        loader.load(
          url,
          (tex) => {
            if (color) tex.colorSpace = THREE.SRGBColorSpace
            tex.anisotropy = 4
            resolve(tex)
          },
          undefined,
          () => resolve(null), // 載不到就維持沒有遠景（程序化的天空和雲海照常）
        )
      })

    load(SRC.far).then((tex) => {
      if (!tex) return
      tex.wrapS = THREE.RepeatWrapping
      const { r, copies, squash, offset } = FAR
      const px = (copies * tex.image.width) / 360
      const g = arc({ ...placed(tex.image, { u0: 0, u1: copies, at: offset + Math.PI, px, r, squash }), wrap: true })
      this._add(g, tex, { haze: 0.32, order: -8.6 })
    })
    Promise.all([load(SRC.mid), load(SRC.midLights, false)]).then(([tex, lights]) => {
      if (!tex) return
      for (const m of MID) {
        const g = arc(placed(tex.image, { u0: m.u[0], u1: m.u[1], f0: 0.2, at: m.at, px: m.px, r: MID_R }))
        this._add(g, tex, { haze: 0.2, order: -8.2, lights })
      }
    })
    SRC.cumulus.forEach((url, i) =>
      load(url).then((tex) => {
        if (!tex) return
        for (const [img, at, px, base] of CUMULUS) {
          if (img !== i) continue
          // 雲底對齊 base
          const lift = deg(((BOTTOM[i] - HORIZON_ROW) * tex.image.height) / px)
          const g = arc(placed(tex.image, { u0: 0, u1: 1, at, px, base: base + lift, r: CUMULUS_R }))
          this._add(g, tex, { haze: 0.14, order: -8.4, parent: this.cumulus })
        }
      }),
    )
  }

  _add(geometry, map, { haze, order, lights = null, parent = this.group }) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, map: { value: map }, uHaze: { value: haze }, ...(lights ? { lightMap: { value: lights } } : {}) },
      defines: lights ? { LIGHTS: '' } : {},
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.renderOrder = order
    mesh.frustumCulled = false
    parent.add(mesh)
    return mesh
  }

  update(dt, cam) {
    this.group.position.copy(cam)
    // 積雨雲非常慢地繞著天邊飄（約 4 小時一圈）
    this.cumulus.rotation.y -= dt * 0.00045
  }
}
