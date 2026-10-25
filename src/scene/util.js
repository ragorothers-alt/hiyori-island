import * as THREE from 'three'

// ── 緩動 ──
export const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
  },
  outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
}

// ── 極簡補間器：由 World 每幀呼叫 updateTweens ──
const tweens = new Set()
export function tween(dur, onUpdate, { easing = ease.outCubic, delay = 0, onDone } = {}) {
  const tw = { t: -delay, dur, onUpdate, easing, onDone }
  tweens.add(tw)
  return tw
}
export function cancelTween(tw) {
  if (tw) tweens.delete(tw)
}
export function updateTweens(dt) {
  for (const tw of tweens) {
    tw.t += dt
    if (tw.t < 0) continue
    const k = Math.min(1, tw.t / tw.dur)
    tw.onUpdate(tw.easing(k), k)
    if (k >= 1) {
      tweens.delete(tw)
      tw.onDone?.()
    }
  }
}
export const wait = (sec) => new Promise((r) => tween(sec, () => {}, { onDone: r }))

// ── 雜湊 / 偽隨機 ──
export function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}
export function rng(seed = 1) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 1000000) / 1000000
  }
}
// 依角度的平滑起伏，用來做島嶼邊緣
export const wobble = (a, seed = 0) =>
  Math.sin(a * 3 + seed) * 0.5 + Math.sin(a * 7 + 1.3 + seed) * 0.25 + Math.sin(a * 13 + 2.1 + seed * 2) * 0.12

// ── 材質（同參數共用） ──
const matCache = new Map()
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts)
  if (!matCache.has(key)) {
    matCache.set(
      key,
      new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, flatShading: true, ...opts }),
    )
  }
  return matCache.get(key)
}

export function shadowed(obj, cast = true, receive = true) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast
      o.receiveShadow = receive
    }
  })
  return obj
}

// 文字貼圖 sprite（時之環刻度）
export function textSprite(text, { size = 64, color = '#5d6f86', font = '600 {s}px Quicksand, sans-serif', scale = 1 } = {}) {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  const f = font.replace('{s}', size)
  ctx.font = f
  const w = Math.ceil(ctx.measureText(text).width) + size * 0.6
  c.width = w
  c.height = size * 1.4
  ctx.font = f
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  sp.scale.set((w / c.height) * scale, scale, 1)
  return sp
}

// 柔光圓點貼圖（粒子、光暈共用）
let glowTex
export function glowTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

export const lerp = (a, b, t) => a + (b - a) * t
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
