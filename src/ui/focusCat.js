// 專注頁（App 模式的全螢幕計時）上散步的貓咪：用 SVG 畫，身體每一格照 src/catWalk.js 算出來的姿勢重畫。
// 只在專注頁開著時動；畫面在背景上、計時卡片底下，不會擋到按鈕。系統開了「減少動態效果」就只在角落睡覺。
import {
  COATS, createCat, stepCat, poseOf, pokeCat, hoverCat, leaveCat, comeBack, placeCat, setBounds,
  bodyPath, legPath, sockPath, smoothPath, stripesPath, LEG, TAIL,
} from '../catWalk.js'
import './focusCat.css'

const OL = 1.7 // 外框粗細（單位）
const f1 = (n) => Math.round(n * 10) / 10
const f2 = (n) => Math.round(n * 100) / 100
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// 頭（頭的中心是原點）：圓圓的、臉頰鼓一點；耳朵畫左邊那隻，右邊鏡射
const SKULL = 'M-19 0C-19-11-11-17 0-17C11-17 19-11 19 0C19.5 9 11 14.5 0 14.5C-11 14.5-19.5 9-19 0Z'
const EAR = 'M-18-4C-19-13-17.5-21-14.6-25.6C-13.9-26.6-12.9-26.6-12.1-25.9C-9-23-6.2-19.6-4-15.5Z'
const EAR_IN = 'M-15.6-8C-16.1-14-15.2-19-13.6-22C-11.4-20-9.4-17.5-7.8-14.6Z'
const EYE = '<g data-r="eo"><ellipse class="iris" rx="2.7" ry="3.4"/><ellipse class="pupil" rx="1.25" ry="2.5"/><circle class="hl" cx=".9" cy="-1.3" r="1.05"/></g><path data-r="lid" class="lid" d="M-2.9-.4Q0 2.3 2.9-.4"/><path data-r="joy" class="lid" d="M-2.9 1Q0-2.2 2.9 1"/>'

// 一條尾巴（外框、毛、虎斑、尾巴尖）；後面、前面、頭上面各放一條，看姿勢用哪一條
const tailSlot = (name) =>
  `<g data-r="tail-${name}"><path class="lo" stroke-width="${TAIL.w + 2 * OL}"/><path class="tf" stroke-width="${TAIL.w}"/><path class="tb" stroke-width="${TAIL.w}"/><path class="tp" stroke-width="${TAIL.w}"/></g>`
const leg = (name, w) => `<path data-r="${name}-o" class="lo" stroke-width="${w + 2 * OL}"/>`
const legFill = (name, w, sock) => `<path data-r="${name}" class="lf" stroke-width="${w}"/>${sock ? `<path data-r="${name}-s" class="sk" stroke-width="${w}"/>` : ''}`

// 身上和頭上的花紋（照毛色）
function bodyMarks(c) {
  let s = ''
  if (c.bib) s += '<ellipse data-r="bib" class="bib"/>'
  for (const [, , , r, color] of c.patches || []) s += `<circle data-r="patch" r="${r}" fill="${color}"/>`
  if (c.stripes) s += '<path data-r="stripes" class="st"/>'
  return s
}
function headMarks(c) {
  let s = ''
  for (const [x, y, r, color] of c.spots || []) s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`
  if (c.stripes) s += '<path class="st" d="M-5-15.5L-4-10.5M0-16.8V-11M5-15.5L4-10.5"/><path class="st thin" d="M-19.5.5L-14.5-.3M-19.5 4.5L-15 3.3M19.5.5L14.5-.3M19.5 4.5L15 3.3"/>'
  return s
}
function muzzleMarks(c) {
  // 賓士貓的白臉：從額頭中間往下開成八字，眼睛留在黑色那一邊
  if (c.mask) return '<path class="bib" d="M0-9C-1.5-4-3.5 0-7 3C-10 5.5-13.5 7-14.5 10.5C-9 15.5 9 15.5 14.5 10.5C13.5 7 10 5.5 7 3C3.5 0 1.5-4 0-9Z"/>'
  if (c.stripes) return '<ellipse class="bib" cx="0" cy="7.6" rx="8.4" ry="6.2"/>'
  return ''
}

function markup(id, c) {
  const sock = !!c.socks
  return `<svg class="neko" viewBox="-100 -120 200 160" aria-hidden="true" focusable="false">
<defs><clipPath id="${id}-b"><path data-r="clip"/></clipPath><clipPath id="${id}-h"><path d="${SKULL}"/></clipPath></defs>
<ellipse data-r="shadow" class="sh" cy=".6" ry="4"/>
${tailSlot('back')}
<g class="nk-far">${leg('lf1', LEG.wf)}${leg('lh1', LEG.wh)}${legFill('lf1', LEG.wf, sock)}${legFill('lh1', LEG.wh, sock)}</g>
<path data-r="torso-o" class="o"/>${leg('lf0', LEG.wf)}${leg('lh0', LEG.wh)}
<path data-r="torso" class="fu"/>
<g clip-path="url(#${id}-b)">${bodyMarks(c)}</g>
${legFill('lf0', LEG.wf, sock)}${legFill('lh0', LEG.wh, sock)}
${tailSlot('front')}
<g data-r="head">
  <g data-r="earL-o"><path class="o" d="${EAR}"/></g><g data-r="earR-o"><path class="o" d="${EAR}"/></g>
  <path class="o" d="${SKULL}"/>
  <g data-r="earL"><path class="fu" d="${EAR}"/><path class="in" d="${EAR_IN}"/></g><g data-r="earR"><path class="fu" d="${EAR}"/><path class="in" d="${EAR_IN}"/></g>
  <path class="fu" d="${SKULL}"/>
  <g clip-path="url(#${id}-h)"><g data-r="hm">${headMarks(c)}</g><g data-r="mm">${muzzleMarks(c)}</g></g>
  <g data-r="blush"><ellipse class="bl" cx="-10.5" cy="5" rx="3.4" ry="1.9"/><ellipse class="bl" cx="10.5" cy="5" rx="3.4" ry="1.9"/></g>
  <g data-r="eyeL">${EYE}</g><g data-r="eyeR">${EYE}</g>
  <g data-r="muzzle">
    <path class="wk" d="M-8.5 5.5L-21 3.6M-8.5 8L-21 9.4M8.5 5.5L21 3.6M8.5 8L21 9.4"/>
    <path class="ns" d="M-1.9 3.6Q0 2.6 1.9 3.6Q1 5.6 0 5.9Q-1 5.6-1.9 3.6Z"/>
    <path data-r="mouth" class="ln" d="M0 5.9V7.2M-3.3 7.2Q-1.6 9.4 0 7.2Q1.6 9.4 3.3 7.2"/>
    <ellipse data-r="yawn" class="yw" cx="0" rx="2.9"/>
  </g>
</g>
${tailSlot('top')}
<g data-r="raised">${leg('lfr', LEG.wf)}${legFill('lfr', LEG.wf, sock)}</g>
<ellipse data-r="hit" class="hit" cx="6" cy="-36" rx="50" ry="40"/>
</svg>`
}

let uid = 0

export class FocusCat {
  // layer：貓走動的那一層（蓋滿專注頁）；card：計時卡片，貓只在它下面的地板上走；onPoke：被摸了（放音效）
  constructor(layer, { card, onPoke } = {}) {
    this.layer = layer
    this.card = card
    this.onPoke = onPoke
    this.cat = null
    this.on = false
    this.fits = true
    this.ctx = { mode: 'focus', paused: false, focusMs: 0 }
    this.hiddenAt = 0
    this._raf = 0
    this._timer = 0
    this._drawnAt = 0
    this._last = new WeakMap()
    this._frame = (now) => this._tick(now)
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this._measure()) : null
    // 系統的「減少動態效果」：中途改了就重新放一隻
    this._mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
    this._mq?.addEventListener?.('change', () => {
      if (!this.on || !this.cat) return
      const { coat, leaving } = this.cat
      this.hide()
      this.cat = null
      // 正被請離開（腳印關掉了）：就收起來，不要又放一隻出來
      if (!leaving) this.show(this.ctx, coat)
    })
  }

  // 專注頁開著、貓咪要出來（每秒會叫一次，帶最新的狀態）：ctx = { mode, paused, focusMs }，coat 是今天的毛色
  show(ctx, coat) {
    this.ctx = ctx
    const still = !!this._mq?.matches
    // 隔了一陣子才再打開專注頁、換了一天、換了動態設定：重新放一隻（專注很久了就直接在睡覺）
    const fresh = !this.cat || this.cat.coat !== coat || this.cat.still !== still || (!this.on && Date.now() - this.hiddenAt > 90000)
    if (this.on && !fresh) {
      if (this.cat.leaving) comeBack(this.cat)
      return
    }
    if (this.on) this.hide()
    if (fresh) this._build(coat, still)
    else if (this.cat.leaving) comeBack(this.cat)
    this.on = true
    this.layer.hidden = false
    this._ro?.observe(this.layer)
    if (this.card) this._ro?.observe(this.card)
    this._measure()
    if (fresh) placeCat(this.cat, ctx)
    this._start()
  }

  // 專注頁關掉（縮小、結束）：停下來，狀態留著，很快又打開時接著走
  hide() {
    if (!this.on) return
    this.on = false
    this.hiddenAt = Date.now()
    cancelAnimationFrame(this._raf)
    clearInterval(this._timer)
    this._raf = 0
    this._timer = 0
    this._ro?.disconnect()
    hoverCat(this.cat, false)
    this.layer.hidden = true
  }

  // 關掉貓咪：小跑步離開畫面再收起來（減少動態效果時直接收）
  leave() {
    if (!this.on) return
    if (this.cat.still || this.cat.away) return this.hide()
    leaveCat(this.cat)
  }

  _build(coat, still) {
    // 裁切路徑的 id 整頁不能重複（同一頁有兩份這個模組時也一樣）
    const id = `nk${++uid}${Math.random().toString(36).slice(2, 7)}`
    const c = COATS[coat] || COATS.mike
    this.layer.innerHTML = markup(id, c)
    const svg = (this.svg = this.layer.querySelector('svg'))
    svg.style.cssText = [
      ['fur', c.fur], ['shade', c.shade], ['ol', c.ol], ['oln', c.oln], ['lid', c.lid], ['line', c.line], ['eye', c.eye], ['nose', c.nose], ['inner', c.inner],
      ['whisk', c.whisk], ['tail', c.tail || c.fur], ['tip', c.tip || c.tail || c.fur], ['mark', c.stripes || 'transparent'], ['bib', c.bib || c.fur], ['sock', c.socks || c.fur],
    ].map(([k, v]) => `--nk-${k}:${v}`).join(';')
    const el = {}
    for (const n of svg.querySelectorAll('[data-r]')) {
      const k = n.dataset.r
      if (k === 'patch') (el.patch ||= []).push(n)
      else if (!el[k]) el[k] = n
    }
    for (const side of ['eyeL', 'eyeR']) el[side + 'o'] = el[side].querySelector('[data-r="eo"]')
    for (const side of ['eyeL', 'eyeR']) el[side + 'c'] = el[side].querySelector('[data-r="lid"]')
    for (const side of ['eyeL', 'eyeR']) el[side + 'j'] = el[side].querySelector('[data-r="joy"]')
    for (const name of ['back', 'front', 'top']) el['tail-' + name] = { g: el['tail-' + name], p: [...el['tail-' + name].children] }
    this.el = el
    this._last = new WeakMap()
    this.coat = c
    this.cat = createCat({ seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0, coat, still })
    // 點牠、滑鼠移過去
    el.hit.addEventListener('click', (e) => {
      e.stopPropagation()
      const r = pokeCat(this.cat)
      if (r === 'meow' || r === 'purr' || r === 'wake') this.onPoke?.(r)
      // 不動的貓沒有每一格的迴圈：馬上換成抬頭看你
      if (this.cat.still) this._stillStep(0)
    })
    el.hit.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && hoverCat(this.cat, true))
    el.hit.addEventListener('pointerleave', () => hoverCat(this.cat, false))
  }

  // 地板：計時卡片下面到畫面底；卡片下面放不下一隻坐著的貓（手機橫著拿）就先不出來
  _measure() {
    if (!this.cat) return
    const L = this.layer.getBoundingClientRect()
    if (!L.width || !L.height) return
    const C = this.card?.getBoundingClientRect()
    const w = L.width
    const h = L.height
    const k = clamp(Math.min(w, h * 1.3) / 1080, 0.76, 1)
    const bottom = h - 14 * k
    const cardBottom = C && C.height ? C.bottom - L.top : h * 0.6
    const sitH = 84 * k
    const top = Math.max(cardBottom + sitH * 0.92, bottom - Math.min(120, h * 0.14))
    this.fits = bottom - cardBottom >= sitH * 0.8
    setBounds(this.cat, { w, h, top: Math.min(top, bottom), bottom, k })
    if (this.cat.still) this._draw()
  }

  // 不動的貓：只在被摸、暫停時換姿勢，一秒看四次就夠（沒變的屬性不會重寫）
  _stillStep(dt) {
    // stepCat 一步最多算 0.1 秒：0.25 秒分成幾步走，抬頭看你的 2.4 秒才真的是 2.4 秒
    let left = dt
    do {
      stepCat(this.cat, Math.min(0.1, left), this.ctx)
      left -= 0.1
    } while (left > 1e-6)
    this._draw()
    this._events()
  }

  _start() {
    if (this.cat.still) {
      this._stillStep(0)
      this._timer ||= setInterval(() => this._stillStep(0.25), 250)
      return
    }
    if (!this._raf) {
      this._prev = performance.now()
      this._raf = requestAnimationFrame(this._frame)
    }
  }

  _tick(now) {
    this._raf = 0
    if (!this.on) return
    const dt = Math.min(0.1, (now - this._prev) / 1000)
    this._prev = now
    stepCat(this.cat, dt, this.ctx)
    if (this.cat.away && this.cat.leaving) return this.hide()
    this._events()
    // 睡著、趴著時身體只是一脹一縮：一秒畫 15 次就夠，省電
    const calm = this.cat.act.kind === 'sleep' || this.cat.act.kind === 'loaf'
    if (!calm || now - this._drawnAt > 66) {
      this._drawnAt = now
      this._draw()
    }
    this._raf = requestAnimationFrame(this._frame)
  }

  // 牠說的話、睡覺冒出的 z、愛心
  _events() {
    const list = this.cat.events.splice(0)
    if (!list.length || this.cat.away || !this.fits || !this._pose) return
    const P = this._pose
    const hx = P.x + P.flip * P.s * (P.head.x + 4)
    const hy = P.y + P.s * (P.head.y - 22)
    for (const ev of list) {
      const b = document.createElement('div')
      if (ev.type === 'say') {
        b.className = 'nk-say'
        b.textContent = ev.text
      } else if (ev.type === 'z') {
        b.className = 'nk-z'
        b.textContent = 'z'
      } else {
        b.className = 'nk-heart'
        b.textContent = '♥'
      }
      const dx = ev.type === 'z' ? Math.sign(P.flip) * 14 * P.s : ev.type === 'heart' ? -Math.sign(P.flip) * 16 * P.s : 0
      b.style.left = `${f1(hx + dx)}px`
      b.style.top = `${f1(hy + (ev.type === 'say' ? 0 : 10 * P.s))}px`
      if (this.cat.still) {
        b.classList.add('nk-still')
        setTimeout(() => b.remove(), 1800)
      } else b.addEventListener('animationend', () => b.remove())
      this.layer.append(b)
    }
  }

  // 屬性沒變就不寫（每一格寫的東西越少越省電）
  _set(node, attr, v) {
    let m = this._last.get(node)
    if (!m) this._last.set(node, (m = {}))
    if (m[attr] === v) return
    m[attr] = v
    node.setAttribute(attr, v)
  }
  _show(node, on) {
    this._set(node, 'display', on ? 'inline' : 'none')
  }

  _draw() {
    const { cat, el, svg } = this
    const hidden = cat.away || !this.fits
    svg.style.display = hidden ? 'none' : ''
    if (hidden) return
    const P = (this._pose = poseOf(cat))
    const s = P.s
    svg.style.transform = `translate3d(${f1(P.x - 100)}px,${f1(P.y - 120)}px,0) scale(${f2(s * P.flip) || 0.01},${f2(s)})`
    svg.classList.toggle('happy', P.head.mood === 'happy')

    // 影子：跳起來時縮小、變淡
    const up = clamp(P.shadow.lift / 40, 0, 0.6)
    this._set(el.shadow, 'cx', f1(P.shadow.x))
    this._set(el.shadow, 'cy', f1(0.6 + P.shadow.lift))
    this._set(el.shadow, 'rx', f1(P.shadow.rx * (1 - up * 0.6)))
    this._set(el.shadow, 'opacity', f2(1 - up))

    // 身體和花紋
    const body = bodyPath(P.hip, P.chest)
    this._set(el['torso-o'], 'd', body)
    this._set(el.torso, 'd', body)
    this._set(el.clip, 'd', body)
    const [cx, cy, cr] = P.chest
    if (el.bib) {
      this._set(el.bib, 'cx', f1(cx + cr * 0.5))
      this._set(el.bib, 'cy', f1(cy + cr * 0.42))
      this._set(el.bib, 'rx', f1(cr * 0.62))
      this._set(el.bib, 'ry', f1(cr * 0.78))
    }
    ;(el.patch || []).forEach((n, i) => {
      const [on, dx, dy] = this.coat.patches[i]
      const o = on === 'hip' ? P.hip : P.chest
      this._set(n, 'cx', f1(o[0] + dx))
      this._set(n, 'cy', f1(o[1] + dy))
    })
    if (el.stripes) this._set(el.stripes, 'd', stripesPath(P.hip, P.chest))

    // 腳：0 近前、1 遠前、2 近後、3 遠後；理毛時近的前腳舉到臉前面（畫在頭上面那一層）
    const names = ['lf0', 'lf1', 'lh0', 'lh1']
    P.legs.forEach((L, i) => {
      const d = legPath(L.j, L.p, L.fore ? LEG.fore : LEG.hind, L.fore)
      const sock = this.coat.socks ? sockPath(L.j, L.p) : ''
      const name = i === 0 && L.top ? 'lfr' : names[i]
      if (i === 0) {
        this._show(el.raised, L.top)
        this._show(el['lf0-o'], !L.top)
        this._show(el.lf0, !L.top)
        if (el['lf0-s']) this._show(el['lf0-s'], !L.top)
      }
      this._set(el[name + '-o'], 'd', d)
      this._set(el[name], 'd', d)
      if (sock) this._set(el[name + '-s'], 'd', sock)
    })

    // 尾巴：看姿勢畫在身體後面、前面，或連頭都蓋住
    const td = smoothPath(P.tail)
    const tip = smoothPath(P.tail.slice(-3))
    for (const name of ['back', 'front', 'top']) {
      const slot = el['tail-' + name]
      const on = P.slot === name
      this._show(slot.g, on)
      if (!on) continue
      const [o, fur, band, tp] = slot.p
      this._set(o, 'd', td)
      this._set(fur, 'd', td)
      this._show(band, !!this.coat.stripes)
      if (this.coat.stripes) this._set(band, 'd', td)
      this._show(tp, !!this.coat.tip)
      if (this.coat.tip) this._set(tp, 'd', tip)
    }

    // 頭：轉角；臉朝前看時五官往前挪（近大遠小），眼睛、嘴巴的表情
    const H = P.head
    const fx = H.face
    this._set(el.head, 'transform', `translate(${f1(H.x)} ${f1(H.y)}) rotate(${f1(H.rot)})`)
    const ear = (i) => `translate(${f1(fx * 2.2)} 0)${i ? ' scale(-1 1)' : ''} rotate(${f1(-H.ears[i])} -11 -10)`
    this._set(el['earL-o'], 'transform', ear(0))
    this._set(el.earL, 'transform', ear(0))
    this._set(el['earR-o'], 'transform', ear(1))
    this._set(el.earR, 'transform', ear(1))
    this._set(el.hm, 'transform', `translate(${f1(fx * 3.2)} 0)`)
    this._set(el.mm, 'transform', `translate(${f1(fx * 6)} 0)`)
    this._set(el.blush, 'transform', `translate(${f1(fx * 5)} 0)`)
    this._set(el.muzzle, 'transform', `translate(${f1(fx * 7)} 0)`)
    this._set(el.eyeL, 'transform', `translate(${f1(-7 + fx * 4.2)} -1) scale(${f2(1 - 0.24 * Math.max(0, fx))} 1)`)
    this._set(el.eyeR, 'transform', `translate(${f1(7 + fx * 5)} -1) scale(${f2(1 - 0.24 * Math.max(0, -fx))} 1)`)
    const happy = H.mood === 'happy'
    const open = clamp(H.eye, 0, 1.15)
    for (const side of ['eyeL', 'eyeR']) {
      this._show(el[side + 'j'], happy)
      this._show(el[side + 'o'], !happy && open > 0.2)
      this._show(el[side + 'c'], !happy && open <= 0.2)
      if (!happy && open > 0.2) this._set(el[side + 'o'], 'transform', `scale(1 ${f2(open)})`)
    }
    const yawn = H.mouth > 0.12
    this._show(el.mouth, !yawn)
    this._show(el.yawn, yawn)
    if (yawn) {
      this._set(el.yawn, 'ry', f1(3.9 * H.mouth))
      this._set(el.yawn, 'cy', f1(6 + 3.9 * H.mouth))
    }
  }
}
