// 天色的時間換算：太陽高度、夜晚程度，以及外觀設定讓天空顯示幾點。
// 外觀：auto 依真實時間、system 跟著系統深淺色、day 一直白天、night 一直夜晚

export const THEMES = ['auto', 'system', 'day', 'night']
export const SUNRISE = 5.9
export const SUNSET = 18.6

// 「白天」時天色停在 7:30–16:30；「夜晚」時停在 21:30–4:30（跨午夜）
const DAY = [7.5, 16.5]
const NIGHT = [21.5, 4.5]

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// 太陽高度：日出、日落時是 0，中午最高
export function sunElevation(h) {
  const p = (h - SUNRISE) / (SUNSET - SUNRISE)
  return Math.sin(Math.PI * clamp(p, -0.2, 1.2))
}
export const dayAt = (h) => smooth(-0.08, 0.32, sunElevation(h))
export const nightAt = (h) => 1 - dayAt(h)

// 真實時間 h（0–24）在這個外觀下，天空要顯示幾點；dark 是系統是否在深色模式
export function lookHour(h, theme, dark = false) {
  if (theme === 'system') theme = dark ? 'night' : 'day'
  if (theme === 'day') return clamp(h, DAY[0], DAY[1])
  if (theme === 'night') return h >= NIGHT[0] || h < NIGHT[1] ? h : h < 12.5 ? NIGHT[1] : NIGHT[0]
  return h
}

export const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

export const realHour = (d = new Date()) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
