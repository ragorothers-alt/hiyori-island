import * as THREE from 'three'
import { rng, wobble } from './util.js'

// 浮島的底座（主島、街區浮島、小浮島共用）：草地以下的層疊岩壁 → 往下收成岩錐，
// 岩壁頂端掛一圈苔蘚和垂根，可以加幾道從岩壁流出、落進雲海的細瀑布。
// 岩石用 Codex 畫的層理貼圖（圓柱展開的 UV，世界尺度一致），乘上頂點色：上面暖白、越往下越偏薰衣草藍。
// 原點在草地頂面（y=0），岩壁從 top（負值，草地厚度以下）開始。貼圖非同步載入，載好前只有頂點色。
const SRC = {
  rock: new URL('../assets/terrain/rock_cliff.webp', import.meta.url).href,
  roots: new URL('../assets/terrain/roots_moss.webp', import.meta.url).href,
  grass: new URL('../assets/terrain/grass_detail.webp', import.meta.url).href,
}
// 岩壁貼圖一張代表的世界尺寸（寬、高）、垂根一張的寬度（原圖 2:1）
const ROCK_W = 3.2
const ROCK_H = 2.6
const ROOTS_W = 2.6

let loading = null
// 三張地形貼圖（全部島共用、不會被 dispose）；測試環境沒有圖片，回傳空物件
export function terrainTextures() {
  if (loading) return loading
  if (typeof document === 'undefined') return (loading = Promise.resolve({}))
  const loader = new THREE.TextureLoader()
  const load = (url, srgb = true) =>
    new Promise((resolve) =>
      loader.load(
        url,
        (tex) => {
          if (srgb) tex.colorSpace = THREE.SRGBColorSpace
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping
          tex.anisotropy = 4
          resolve(tex)
        },
        undefined,
        () => resolve(null),
      ),
    )
  loading = Promise.all([load(SRC.rock), load(SRC.roots), load(SRC.grass, false)]).then(([rock, roots, grass]) => {
    if (roots) roots.wrapT = THREE.ClampToEdgeWrapping
    return { rock, roots, grass }
  })
  return loading
}

// 平滑的 2D 值雜訊（方位角 a 要能接回一圈：用 cos/sin 取樣）
function noise(seed) {
  const r = rng(seed)
  const N = 64
  const table = Array.from({ length: N * N }, () => r())
  const at = (x, y) => table[(((x % N) + N) % N) + (((y % N) + N) % N) * N]
  const s = (t) => t * t * (3 - 2 * t)
  return (x, y) => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = s(x - ix)
    const fy = s(y - iy)
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx
    return a + (b - a) * fy
  }
}

const C_TOP = new THREE.Color('#fff4ea')
const C_MID = new THREE.Color('#ead8d6')
const C_LOW = new THREE.Color('#aaa7dc')

// opts：
// radius 岩壁頂的半徑（約等於草地半徑）、top 岩壁頂的 y、cliff 層疊岩壁的高度、depth 岩錐（含岩壁）總高、
// seed、wob 輪廓起伏的幅度（和草地的 wobble 一致才貼得合）、segs 圓周分段、roots 垂根的高度（0＝不要）、
// falls 瀑布的方位角陣列（0 在 +x，往 +z 轉；鏡頭在 +z）、fallTo 瀑布落到的 y
export function buildIslandBase({ radius: R, top = -0.6, cliff = 1.8, depth = 9, seed = 1, wob = 0.035, segs = 72, roots = 1.2, falls = [], fallTo = -14 }) {
  const g = new THREE.Group()
  g.name = 'islandBase'
  const n1 = noise(seed * 13 + 1)
  const n2 = noise(seed * 7 + 5)
  const rows = Math.max(20, Math.round(depth * 4.5))
  const bottom = top - depth
  const ledgeH = 0.42 // 一層岩層的厚度

  // 輪廓：岩壁段微微往內收、帶一層層凸出的岩層；下面收成不規則的岩錐
  const radiusAt = (a, y) => {
    const t = (top - y) / depth // 0..1
    const c = cliff / depth
    const ca = Math.cos(a) * 3
    const sa = Math.sin(a) * 3
    const rough = n1(ca + 10, y * 0.9 + sa) - 0.5
    let r
    if (t <= c) {
      const s = t / c
      const strata = (y - top) / ledgeH + (n2(ca * 0.7, sa * 0.7) - 0.5) * 1.2
      const f = strata - Math.floor(strata)
      const ledge = THREE.MathUtils.smoothstep(f, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(f, 0.55, 0.72))
      r = R * (0.99 - 0.07 * s) + ledge * 0.07 * Math.min(1, R / 4) + rough * 0.12 * Math.min(1, R / 5)
    } else {
      const u = (t - c) / (1 - c)
      r = R * 0.92 * Math.pow(1 - u, 0.85) * (1 + rough * 0.35 * u) + R * 0.02
    }
    return r * (1 + wob * wobble(a, seed))
  }

  const pos = []
  const uv = []
  const col = []
  const idx = []
  const U = Math.max(1, Math.round((2 * Math.PI * R) / ROCK_W))
  const c = new THREE.Color()
  for (let j = 0; j <= rows; j++) {
    // 岩壁段的列比較密（層理需要），岩錐段疏
    const q = j / rows
    const t = q < 0.45 ? (q / 0.45) * (cliff / depth) * 1.15 : (cliff / depth) * 1.15 + ((q - 0.45) / 0.55) * (1 - (cliff / depth) * 1.15)
    const y = top - Math.min(1, t) * depth
    const tt = (top - y) / depth
    c.copy(C_TOP).lerp(C_MID, THREE.MathUtils.smoothstep(tt, 0, 0.35)).lerp(C_LOW, THREE.MathUtils.smoothstep(tt, 0.3, 1))
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const r = j === rows ? 0 : radiusAt(a, y)
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r)
      uv.push((i / segs) * U, (y - top) / ROCK_H)
      col.push(c.r, c.g, c.b)
    }
  }
  const W = segs + 1
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < segs; i++) {
      const p = j * W + i
      idx.push(p, p + 1, p + W, p + 1, p + W + 1, p + W)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  // 接縫（a=0 與 a=2π 的重複頂點）法線取平均，避免一條亮線
  const nor = geo.attributes.normal
  for (let j = 0; j <= rows; j++) {
    const a = j * W
    const b = a + segs
    const x = nor.getX(a) + nor.getX(b)
    const y = nor.getY(a) + nor.getY(b)
    const z = nor.getZ(a) + nor.getZ(b)
    const l = Math.hypot(x, y, z) || 1
    nor.setXYZ(a, x / l, y / l, z / l)
    nor.setXYZ(b, x / l, y / l, z / l)
  }
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: '#ffffff' })
  // 原畫的岩層很橘：降一點飽和、提亮，讓頂點色的暖白→薰衣草漸層看得出來
  rockMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      #ifdef USE_MAP
        float rockL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(rockL), diffuseColor.rgb, 0.6) * 1.25;
      #endif`,
    )
  }
  rockMat.customProgramCacheKey = () => 'islandRock'
  const rock = new THREE.Mesh(geo, rockMat)
  rock.receiveShadow = true
  rock.name = 'cliff'
  g.add(rock)
  const owned = [rockMat]

  // 垂根與苔蘚：岩壁頂外面一圈，alphaTest 切邊（不用排序）
  let rootsMat = null
  if (roots > 0) {
    const rs = segs
    const rp = []
    const ru = []
    const ri = []
    const RU = Math.max(1, Math.round((2 * Math.PI * R) / ROOTS_W))
    for (let j = 0; j <= 1; j++) {
      const y = top + 0.12 - j * roots
      for (let i = 0; i <= rs; i++) {
        const a = (i / rs) * Math.PI * 2
        // 貼著岩壁外面，往下稍微外張
        const r = Math.max(radiusAt(a, top), radiusAt(a, Math.max(y, top - cliff * 0.9))) + 0.05 + j * 0.06
        rp.push(Math.cos(a) * r, y, Math.sin(a) * r)
        ru.push((i / rs) * RU, 1 - j)
      }
    }
    for (let i = 0; i < rs; i++) ri.push(i, i + rs + 1, i + 1, i + 1, i + rs + 1, i + rs + 2)
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3))
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2))
    rg.setIndex(ri)
    rg.computeVertexNormals()
    rootsMat = new THREE.MeshStandardMaterial({ alphaTest: 0.45, roughness: 0.9, side: THREE.DoubleSide, visible: false })
    const fringe = new THREE.Mesh(rg, rootsMat)
    fringe.name = 'roots'
    fringe.userData.noShadow = true
    fringe.receiveShadow = true
    g.add(fringe)
    owned.push(rootsMat)
  }

  // 瀑布：從岩壁中段流出、一路落進雲海（雲海的高度霧會把下段吃掉）
  const fallMats = []
  for (const a of falls) {
    const y0 = top - cliff * 0.45
    const r0 = radiusAt(a, y0) + 0.02
    const fall = waterfall(0.45 + R * 0.03, y0 - fallTo)
    fall.position.set(Math.cos(a) * r0, y0, Math.sin(a) * r0)
    // 面向外側
    fall.rotation.y = Math.PI / 2 - a
    g.add(fall)
    fallMats.push(fall.material)
    owned.push(fall.material)
  }

  terrainTextures().then(({ rock: rt, roots: rr }) => {
    if (rt) {
      rockMat.map = rt
      rockMat.needsUpdate = true
    }
    if (rr && rootsMat) {
      rootsMat.map = rr
      rootsMat.visible = true
      rootsMat.needsUpdate = true
    }
  })

  g.userData.ownedMaterials = owned
  g.userData.fallMats = fallMats
  return g
}

// 一道瀑布：上窄下寬的長條，往下流的水紋、邊緣破碎；原點在出水口，往 -y 長 len
const FALL_VERT = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const FALL_FRAG = /* glsl */ `
  #include <fog_pars_fragment>
  uniform float uTime, uNight;
  uniform vec3 uColor;
  varying vec2 vUv;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    // v：0 在出水口、1 在最下面；水紋沿著 v 往下流，越下面越快
    float v = vUv.y;
    float x = vUv.x;
    float flow = v * 7.0 - uTime * (0.9 + v * 0.8);
    float streak = n(vec2(x * 9.0, flow)) * 0.6 + n(vec2(x * 23.0, flow * 2.3)) * 0.4;
    float edge = smoothstep(0.0, 0.22 + 0.1 * n(vec2(3.0, flow)), x) * smoothstep(1.0, 0.78 - 0.1 * n(vec2(7.0, flow)), x);
    float a = edge * mix(0.7, 1.0, streak) * smoothstep(0.0, 0.03, v);
    // 出水口一小段白色水花
    vec3 col = mix(uColor, vec3(1.0), smoothstep(0.55, 0.9, streak) * 0.6 + smoothstep(0.08, 0.0, v) * 0.5);
    col *= mix(1.0, 0.3, uNight);
    a *= mix(1.0, 0.7, uNight);
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }
`
export const FALL_UNIFORMS = { uTime: { value: 0 }, uNight: { value: 0 } }
function waterfall(w, len) {
  const geo = new THREE.PlaneGeometry(1, 1, 1, 12)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const v = 0.5 - p.getY(i) // 0 上 → 1 下
    // 出水口先往外沖一點再垂直落下，越往下越寬
    p.setXYZ(i, p.getX(i) * w * (1 + v * 1.6), -v * len, 0.35 * Math.sqrt(Math.min(v * 6, 1)) + v * 0.4)
  }
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...FALL_UNIFORMS, uColor: { value: new THREE.Color('#d8f1fb') } },
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  })
  const m = new THREE.Mesh(geo, mat)
  m.name = 'waterfall'
  m.userData.noShadow = true
  m.renderOrder = 1
  return m
}

// 草地頂面的筆觸：用世界座標 xz 取 Codex 畫的灰階草紋，乘在原本（會換季的）顏色上，各島密度一致
export function addGrassDetail(material, scale = 2.2) {
  const uniforms = { uGrassDetail: { value: null }, uGrassOn: { value: 0 } }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrassUv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvGrassUv = (modelMatrix * vec4(transformed, 1.0)).xz / ${scale.toFixed(2)};`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrassUv;\nuniform sampler2D uGrassDetail;\nuniform float uGrassOn;')
      .replace(
        '#include <color_fragment>',
        // 灰階草紋（0.45–1，平均約 0.78）拉開對比，平均亮度大致不變
        '#include <color_fragment>\nif (uGrassOn > 0.5) diffuseColor.rgb *= mix(0.7, 1.16, smoothstep(0.45, 1.0, texture2D(uGrassDetail, vGrassUv).r));',
      )
  }
  material.customProgramCacheKey = () => 'grassDetail'
  terrainTextures().then(({ grass }) => {
    if (!grass) return
    uniforms.uGrassDetail.value = grass
    uniforms.uGrassOn.value = 1
  })
  return material
}
