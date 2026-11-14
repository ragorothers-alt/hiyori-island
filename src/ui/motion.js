// 小動畫：列表重畫時每一件滑到新的位置、打勾的地方爆開一小圈花瓣、冒出經驗值、全部完成時的花瓣雨。
// 只用 DOM、CSS 和 Web Animations，放完就拿掉；系統開了「減少動態效果」時都不放（列表照樣不重播淡入）
import './motion.css'

const EASE = 'cubic-bezier(.2, .8, .2, 1)'
export const calmMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// ── 列表重畫 ──
// 整串用 innerHTML 換掉時，原本就在的那幾件不要再重播一次淡入（不然打個勾整串都閃一下）；
// 位置變了的（做完的排到後面、上面那件刪掉了）從原來的地方滑過去。新加進來的照樣淡入。
// boxes：一起重畫的幾個容器（逾期和今天的列表：一件從逾期移到今天時也滑得過去）
// 還在跑的進場動畫（CSS 的 animation，不算 transition）
const entering = (el) => el.getAnimations?.().find((a) => a.animationName && a.playState === 'running')

export function flipItems(boxes, render, sel = '.item[data-id]') {
  const list = () => boxes.filter(Boolean).flatMap((b) => [...b.querySelectorAll(sel)])
  const before = new Map()
  for (const el of list()) {
    const r = el.getBoundingClientRect()
    // 藏著的分頁量不到位置：當成新的，照樣淡入
    if (r.height) before.set(el.dataset.id, { r, t: entering(el)?.currentTime ?? null })
  }
  render()
  if (!before.size) return
  const calm = calmMotion()
  for (const el of list()) {
    const b = before.get(el.dataset.id)
    if (!b) continue
    // 淡入到一半又重畫了（剛加進來、馬上又有變動）：從同一個地方接著播完，不要一下子跳到最後
    const run = b.t != null && entering(el)
    if (run) run.currentTime = b.t
    else el.classList.add('settled')
    if (calm) continue
    const a = el.getBoundingClientRect()
    const dx = b.r.left - a.left
    const dy = b.r.top - a.top
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: Math.min(560, 300 + Math.abs(dy) * 0.6), easing: EASE })
  }
}

// ── 剛剛按下去的地方 ──
// 打勾、打卡這些事件是在按下去的那一下同步發出來的（畫面在下一個 microtask 才重畫），
// 所以在事件裡還量得到剛按的那顆按鈕在哪裡
let tap = null
export function trackTaps(target = globalThis) {
  target.addEventListener?.('pointerdown', (e) => (tap = { el: e.target, x: e.clientX, y: e.clientY, t: performance.now() }), true)
  target.addEventListener?.(
    'keydown',
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') tap = { el: document.activeElement, x: null, y: null, t: performance.now() }
    },
    true,
  )
}
// 1.5 秒內按的、還在畫面上：回傳那顆勾（或那顆按鈕）的中心；太久以前按的不算
export function tapPoint(now = performance.now()) {
  if (!tap || now - tap.t > 1500) return null
  const el = tap.el instanceof Element ? tap.el.closest('.check, .td-check, button, [role="button"], label') || tap.el : null
  if (el?.isConnected) {
    const r = el.getBoundingClientRect()
    if (r.width && r.height && r.bottom > 0 && r.top < innerHeight) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  return tap.x != null ? { x: tap.x, y: tap.y } : null
}

const layer = (cls) => {
  const el = document.createElement('div')
  el.className = cls
  el.setAttribute('aria-hidden', 'true')
  document.body.append(el)
  return el
}

// ── 打勾：一小圈花瓣爆開，外面一圈光散開 ──
export function burst(p, colors, { big = false } = {}) {
  if (!p || calmMotion()) return
  const box = layer('mo-burst')
  box.style.left = `${p.x}px`
  box.style.top = `${p.y}px`
  const n = big ? 14 : 10
  let html = `<b style="--c:${colors[0]}"></b>`
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.45
    const d = (big ? 34 : 26) + Math.random() * 16
    const c = colors[i % colors.length]
    html += `<i style="--c:${c};--x:${(Math.cos(a) * d).toFixed(1)}px;--y:${(Math.sin(a) * d).toFixed(1)}px;--r:${Math.round(Math.random() * 360 - 180)}deg;--s:${(0.75 + Math.random() * 0.6).toFixed(2)}"></i>`
  }
  box.innerHTML = html
  setTimeout(() => box.remove(), 1000)
}

// ── 經驗值從剛按的地方冒上來（連著好幾筆的，一筆一筆往上疊） ──
let nextAt = 0
export function floatText(p, text, { gold = false } = {}) {
  if (!p || calmMotion()) return
  const now = performance.now()
  const wait = Math.max(0, nextAt - now)
  nextAt = Math.max(now, nextAt) + 330
  setTimeout(() => {
    const el = layer(`mo-float${gold ? ' gold' : ''}`)
    el.textContent = text
    el.style.left = `${p.x}px`
    el.style.top = `${p.y - 6}px`
    setTimeout(() => el.remove(), 1300)
  }, wait)
}

// ── 今天全部完成：花瓣從上面飄下來 ──
const RAIN = ['#f7b6c8', '#fbd3df', '#ffe6ee', '#f19bb2', '#fff4c9']
export function petalRain({ count = 26, colors = RAIN } = {}) {
  if (calmMotion()) return
  const box = layer('mo-rain')
  let html = ''
  let last = 0
  for (let i = 0; i < count; i++) {
    const t = 2.6 + Math.random() * 1.8
    const d = Math.random() * 1.4
    last = Math.max(last, t + d)
    const w = 7 + Math.random() * 7
    html += `<i style="--l:${(Math.random() * 100).toFixed(1)}%;--w:${w.toFixed(1)}px;--c:${colors[i % colors.length]};--t:${t.toFixed(2)}s;--d:${d.toFixed(2)}s;--sx:${Math.round(Math.random() * 120 - 60)}px;--r:${Math.round(Math.random() * 720 - 360)}deg"></i>`
  }
  box.innerHTML = html
  setTimeout(() => box.remove(), last * 1000 + 200)
}
