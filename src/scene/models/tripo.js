import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Tripo 生成、Codex 最佳化過的模型（src/assets/models/*.glb：單一網格、只有底色貼圖、底部中心在原點）。
// 程序化模型先照常蓋好；GLB 載好後才把它換進去，原本的外殼拿掉（keep 指定要留的零件，例如燈光、會發光的燈箱）。
// 測試環境（node）或載入失敗時就一直用程序化模型。
const URLS = {
  torii: new URL('../../assets/models/torii.glb', import.meta.url).href,
  stoneLantern: new URL('../../assets/models/stone_lantern.glb', import.meta.url).href,
  shrineSmall: new URL('../../assets/models/shrine_small.glb', import.meta.url).href,
  shrineLarge: new URL('../../assets/models/shrine_large.glb', import.meta.url).href,
  bridge: new URL('../../assets/models/taiko_bridge.glb', import.meta.url).href,
  tree: new URL('../../assets/models/tree_grown.glb', import.meta.url).href,
}

const cache = new Map()
function load(name) {
  if (typeof document === 'undefined' || !URLS[name]) return Promise.resolve(null)
  if (!cache.has(name)) {
    const p = new GLTFLoader()
      .loadAsync(URLS[name])
      .then((gltf) => {
        let mesh = null
        gltf.scene.traverse((o) => {
          if (o.isMesh && !mesh) mesh = o
        })
        return mesh
      })
      .catch((err) => {
        console.warn(`[hiyori] ${name}.glb 載入失敗，沿用程序化模型`, err)
        return null
      })
    cache.set(name, p)
  }
  return cache.get(name)
}

// 把模型換進 group。
// size：目標包圍盒 [x, y, z]，null 的軸跟著其他軸等比；rotY：先繞 y 轉多少（讓正面朝 +z）；
// offset：換進去之後的位置；keep(child)：原本的子物件要不要留；tune(material, mesh)：調材質（季節遮罩等）；
// onSwap(mesh)：換好之後（例如把季節色重新套一次）
export function swapIn(group, name, { size, rotY = 0, offset = null, keep = () => false, tune, onSwap } = {}) {
  return load(name).then((src) => {
    if (!src || group.userData.swapped === name) return null
    const geo = src.geometry.clone()
    if (rotY) geo.rotateY(rotY)
    geo.computeBoundingBox()
    const box = geo.boundingBox
    const have = box.getSize(new THREE.Vector3())
    // 旋轉後底部中心重新對回原點
    geo.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
    const material = src.material.clone()
    material.metalness = 0
    material.roughness = 0.85
    const mesh = new THREE.Mesh(geo, material)
    mesh.name = `tripo:${name}`
    const known = size.map((v, i) => (v == null ? null : v / have.getComponent(i)))
    const uniform = known.find((k) => k != null) ?? 1
    mesh.scale.set(known[0] ?? uniform, known[1] ?? uniform, known[2] ?? uniform)
    if (offset) mesh.position.copy(offset)
    mesh.castShadow = true
    mesh.receiveShadow = true
    tune?.(material, mesh)
    // 原本的外殼拿掉（不能只藏起來：點選的射線和 bounds() 都會算到看不見的物件）
    for (const c of [...group.children]) {
      if (keep(c)) continue
      group.remove(c)
      c.traverse((o) => {
        if (o.isInstancedMesh) o.dispose()
      })
    }
    group.add(mesh)
    ;(group.userData.ownedMaterials ??= []).push(material)
    group.userData.swapped = name
    onSwap?.(mesh)
    return mesh
  })
}

// 樹冠遮罩：Tripo 的櫻花樹冠接近白色（低彩度、高亮度），樹幹是飽和的褐色。
// 遮罩內的顏色換成 material.color（季節色）乘上原畫的明暗，自發光也只留在樹冠；樹幹保持原畫。
export function canopyMask(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        float hiyoriCanopy = 0.0;
        #ifdef USE_MAP
          vec4 texel = texture2D(map, vMapUv);
          vec3 s = pow(max(texel.rgb, vec3(0.0)), vec3(1.0 / 2.2));
          float mx = max(s.r, max(s.g, s.b));
          float sat = (mx - min(s.r, min(s.g, s.b))) / max(mx, 1e-3);
          hiyoriCanopy = smoothstep(0.42, 0.28, sat) * smoothstep(0.42, 0.58, mx);
          float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
          vec3 canopy = diffuse * pow(clamp(lum / 0.94, 0.0, 1.08), 2.2);
          diffuseColor.rgb = mix(texel.rgb, canopy, hiyoriCanopy);
        #endif
        `,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= hiyoriCanopy;')
  }
  material.customProgramCacheKey = () => 'hiyoriCanopy'
  return material
}
