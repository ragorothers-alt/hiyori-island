// 小動畫：列表重畫時每一件滑到新的位置、打勾的地方爆開一小圈花瓣、冒出經驗值、全部完成時的花瓣雨。
// 只用 DOM、CSS 和 Web Animations，放完就拿掉；系統開了「減少動態效果」時都不放（列表照樣不重播淡入）
import './motion.css'

const EASE = 'cubic-bezier(.2, .8, .2, 1)'
export const calmMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// ── 列表重畫 ──
// 整串用 innerHTML 換掉時，原本就在的那幾件不要再重播一次淡入（不然打個勾整串都閃一下）；
// 位置變了的（做完的排到後面、上面那件刪掉了）從原來的地方滑過去。新加進來的照樣淡入。
// boxes：一起重畫的幾個容器。換了容器的（從逾期移到今天）當成新加的淡入：
// 目的地的卡片會裁掉外面的東西，從舊位置滑過去的那一段會被切掉、看起來像先消失再冒出來
// 還在跑的進場動畫（CSS 的 animation，不算 transition）
const entering = (el) => el.getAnimations?.().find((a) => a.animationName && a.playState === 'running')

export function flipItems(boxes, render, sel = '.item[data-id]') {
  const list = () => boxes.flatMap((b, i) => (b ? [...b.querySelectorAll(sel)].map((el) => [el, i]) : []))
  const before = new Map()
  for (const [el, box] of list()) {
    const r = el.getBoundingClientRect()
    // 藏著的分頁量不到位置：當成新的，照樣淡入
    if (r.height) before.set(el.dataset.id, { r, box, t: entering(el)?.currentTime ?? null })
  }
  render()
  if (!before.size) return
  const calm = calmMotion()
  for (const [el, box] of list()) {
    const b = before.get(el.dataset.id)
    if (!b || b.box !== box) continue
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
// 所以在事件裡還量得到剛按的那顆按鈕在哪裡。
// 只有「正在處理使用者這一下」的時候才算數：番茄鐘自己到點、同步補算的獎勵不是剛按的那顆按鈕給的，
// 不要從那裡冒出來。click、submit、Enter 的那一輪事件跑完（下一個 task）就不算了
let tap = null
let live = 0
const hold = () => {
  live++
  setTimeout(() => live--, 0)
}
const anchorOf = (t) => (t instanceof Element ? t.closest('.check, .td-check, button, [role="button"], label') || t : null)
const center = (el) => {
  const r = el?.getBoundingClientRect?.()
  return r && r.width && r.height && r.bottom > 0 && r.top < innerHeight ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
}
export function trackTaps(target = globalThis) {
  // 按下去的時候就先量好：按鈕所在的面板可能在處理時先關掉（例如日程的編輯面板按「完成」）
  target.addEventListener?.(
    'pointerdown',
    (e) => {
      const el = anchorOf(e.target)
      tap = { el, c: center(el), x: e.clientX, y: e.clientY, t: performance.now() }
    },
    true,
  )
  target.addEventListener?.(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const el = anchorOf(document.activeElement)
      tap = { el, c: center(el), x: null, y: null, t: performance.now() }
      hold()
    },
    true,
  )
  for (const type of ['click', 'submit']) target.addEventListener?.(type, hold, true)
}
// 不是用按的（例如手機上滑一下完成）：直接指定花瓣從哪個元素爆開
export function noteTap(el) {
  if (!el) return
  tap = { el, c: center(el), x: null, y: null, t: performance.now() }
  hold()
}
// 正在處理使用者這一下、1.5 秒內按的：回傳那顆勾（或那顆按鈕）的中心；
// 按鈕已經不在畫面上了就用按下去時量的位置
export function tapPoint(now = performance.now()) {
  if (!live || !tap || now - tap.t > 1500) return null
  if (tap.el?.isConnected) {
    const c = center(tap.el)
    if (c) return c
  }
  return tap.c || (tap.x != null ? { x: tap.x, y: tap.y } : null)
}
// ── 數字從 from 走到 to（先快後慢）；fmt 回傳要放進去的 HTML。減少動態效果、沒變、還沒有上一次的數字：直接放結果 ──
// 走到一半又被呼叫（接著又做完一件、整塊重畫了）：從畫面上現在的數字接著走，不會先跳到上一次的終點。
// state 記著畫面上現在的數字：元素每次重畫都會換掉的話，傳一個留在畫面物件上的 {}（預設記在元素自己身上）
export function countUp(el, from, to, { dur = 700, fmt = String, state = el } = {}) {
  if (!el) return
  const start = state._count ? state._v : from
  cancelAnimationFrame(state._count)
  state._count = 0
  const put = (n) => {
    state._v = n
    el.innerHTML = fmt(n)
  }
  if (start == null || start === to || !Number.isFinite(start) || !Number.isFinite(to) || calmMotion()) return put(to)
  const t0 = performance.now()
  const step = (t) => {
    // 第一格畫面的時間戳可能比上面量的 t0 還早一點：不要算出負的（數字會先往反方向閃一下）
    const k = Math.max(0, Math.min(1, (t - t0) / dur))
    put(Math.round(start + (to - start) * (1 - (1 - k) ** 3)))
    state._count = k < 1 ? requestAnimationFrame(step) : 0
  }
  put(start)
  state._count = requestAnimationFrame(step)
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
