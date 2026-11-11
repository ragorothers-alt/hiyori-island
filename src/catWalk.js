// 專注頁散步的貓咪（畫面在 src/ui/focusCat.js）：接下來做什麼（走、坐、理毛、伸懶腰、趴著睡），和每一格身體的樣子。
// 沒有 DOM，可以單獨測。
//
// 螢幕座標是 CSS px：x 往右、y 往下；貓的 (x, y) 是兩腳中間的地面。bounds 是牠能走的地板：寬 w，地板從 top 到 bottom
// （越下面越近、畫得越大），k 是一單位幾 px。
// 身體用「貓的單位」：面向右、地面 y = 0、往上是負的。畫的時候乘上 k 和遠近，面向左時整隻左右翻過來。

const D2R = Math.PI / 180
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const ease = (t) => t * t * (3 - 2 * t)
const between = (r, a, b) => a + (b - a) * r()
// 慢慢靠近目標：rate 越大越快（每秒），跟幀率無關
const approach = (v, to, rate, dt) => to + (v - to) * Math.exp(-rate * dt)

// 固定種子的亂數（mulberry32）：同一個種子走出同一條路，測試才對得上
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 照權重抽一個：[['walk', 2], ['sit', 1]]
function pick(r, list) {
  const sum = list.reduce((a, [, w]) => a + Math.max(0, w), 0)
  let x = r() * sum
  for (const [k, w] of list) if ((x -= Math.max(0, w)) < 0) return k
  return list[list.length - 1][0]
}

// ── 毛色：一天一隻，同一天打開都是同一隻 ──
// fur 身體、shade 另一邊的腳、ol 外框（夜裡用 oln：深色的貓在深色底上才看得到輪廓）、lid 閉著的眼睛、line 嘴巴、
// eye 眼珠、nose 鼻子、inner 耳朵裡面、whisk 鬍鬚；bib 胸口和嘴邊、socks 白襪子、stripes 虎斑、patches 身上的花斑
// [長在哪顆圓上, dx, dy, 半徑, 顏色]、spots 頭上的花斑 [x, y, 半徑, 顏色]、tail／tip 尾巴和尾巴尖的顏色
export const COATS = {
  mike: {
    name: '三花貓', fur: '#fffaf2', shade: '#e9dfd5', ol: '#7d6759', oln: '#dccbbf', lid: '#5a463d', line: '#5a463d', eye: '#4e3c34', nose: '#f19aa6', inner: '#f8c6cb', whisk: '#b3a49a',
    patches: [['hip', -4, -8, 11.5, '#f0a35b'], ['chest', 6, -12, 8.5, '#5e4b43'], ['hip', 9, -14, 6, '#5e4b43']],
    spots: [[-13, -12, 9.5, '#f0a35b'], [13.5, -11, 8, '#5e4b43']],
    tail: '#f0a35b', tip: '#5e4b43',
  },
  chatora: {
    name: '橘貓', fur: '#f7b977', shade: '#e49e5a', ol: '#8d5c3b', oln: '#efc398', lid: '#6b4430', line: '#6b4430', eye: '#5b3e2c', nose: '#ea8f93', inner: '#f8c7b6', whisk: '#c9946a',
    bib: '#fff4e4', stripes: '#e3893f',
  },
  saba: {
    name: '虎斑貓', fur: '#bcc0cd', shade: '#a0a4b3', ol: '#565b6c', oln: '#d3d7e4', lid: '#3e4351', line: '#3e4351', eye: '#3c4250', nose: '#e8a3ad', inner: '#f0c8ce', whisk: '#8e93a3',
    bib: '#f1f2f6', stripes: '#727789',
  },
  kuro: {
    name: '黑貓', fur: '#403d4d', shade: '#2f2c3a', ol: '#25222f', oln: '#a8a2c6', lid: '#d6d0ea', line: '#d6d0ea', eye: '#f3d55a', nose: '#8d7383', inner: '#7a6274', whisk: '#cfc9e3',
  },
  shiro: {
    name: '白貓', fur: '#ffffff', shade: '#e7e2ee', ol: '#887d96', oln: '#ddd6e9', lid: '#6c6278', line: '#6c6278', eye: '#6b9fd6', nose: '#f5a9b5', inner: '#f9cad1', whisk: '#b4abc0',
  },
  hachi: {
    name: '賓士貓', fur: '#403d4d', shade: '#302d3b', ol: '#26232f', oln: '#aaa4c8', lid: '#d9d4ea', line: '#4d4757', eye: '#ecd162', nose: '#f0a3ae', inner: '#7c6476', whisk: '#d9d4ea',
    bib: '#ffffff', socks: '#ffffff', mask: '#ffffff', tip: '#ffffff',
  },
}
export const COAT_IDS = Object.keys(COATS)
// 日期（YYYY-MM-DD）→ 今天來陪的是哪一隻（FNV-1a）
export function coatOfDay(date) {
  let h = 0x811c9dc5
  for (const ch of String(date)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193)
  return COAT_IDS[(h >>> 0) % COAT_IDS.length]
}

// ── 姿勢 ──
// hip、chest：屁股和胸口兩顆圓 [x, y, 半徑]，身體是包住兩顆圓的形狀；head：頭的中心 [x, y, 轉角(度)，正的是低頭]；
// paws：四隻腳掌 [近前, 遠前, 近後, 遠後]；tail：[根部角度, 每節再彎幾度, 擺幅]（0 朝前、90 朝下、180 朝後、270 朝上）；
// tb：尾巴根在屁股那顆圓上的位置（半徑的倍數）；slot：尾巴畫在身體後面（back）、前面（front），或連頭都蓋住（top）
export const POSES = {
  stand: { hip: [-20, -27, 15], chest: [14, -29, 16.5], head: [31, -46, 0], paws: [[17, 0], [12, 0], [-19, 0], [-24, 0]], tail: [226, 14, 5], tb: [-0.8, -0.45], slot: 'back' },
  sit: { hip: [-9, -16, 16.5], chest: [7, -30, 13.5], head: [11, -53, 0], paws: [[13, 0], [8, 0], [3, -2], [-1, -2]], tail: [100, -20, 2], tb: [-0.6, 0.62], slot: 'front' },
  loaf: { hip: [-15, -14, 14.5], chest: [11, -15, 15], head: [27, -29, 4], paws: [[24, -3], [21, -3], [-14, -8], [-18, -8]], tail: [95, -16, 1], tb: [-0.9, 0.35], slot: 'front' },
  sleep: { hip: [-9, -13, 14], chest: [8, -13, 14.5], head: [22, -16, 16], paws: [[10, -8], [7, -8], [-9, -8], [-12, -8]], tail: [95, -15, 0], tb: [-0.85, 0.4], slot: 'top' },
  stretch: { hip: [-20, -30, 15], chest: [12, -15, 15], head: [32, -21, -8], paws: [[36, 0], [31, 0], [-20, 0], [-25, 0]], tail: [262, 5, 3], tb: [-0.7, -0.6], slot: 'back' },
  crouch: { hip: [-18, -22, 15], chest: [12, -14, 15], head: [30, -23, 0], paws: [[21, 0], [16, 0], [-17, 0], [-22, 0]], tail: [170, 4, 2], tb: [-0.95, -0.2], slot: 'back' },
  leap: { hip: [-24, -27, 14.5], chest: [16, -31, 15.5], head: [33, -45, -6], paws: [[34, -18], [30, -14], [-40, -15], [-36, -11]], tail: [185, -2, 2], tb: [-0.95, -0.25], slot: 'back' },
}
// 腳和尾巴的長度、粗細（單位）
export const LEG = { fore: 24, hind: 25, wf: 8, wh: 9 }
export const TAIL = { n: 7, len: 46, w: 7.5 }
// 步態：duty 腳掌踩在地上的時間比例、stride 一步多長、lift 抬多高、offs 四隻腳的先後（近前、遠前、近後、遠後）
export const GAITS = {
  walk: { duty: 0.62, stride: 13, lift: 5.5, offs: [0.25, 0.75, 0, 0.5] },
  trot: { duty: 0.48, stride: 19, lift: 7, offs: [0.5, 0, 0, 0.5] },
}
// 走路、小跑的速度（一單位 = 1px 時，每秒幾 px）
const SPEED = { walk: 40, trot: 92 }
// 坐著、趴著、睡著時身體一脹一縮的幅度
const BREATH = { sit: 0.35, look: 0.35, groom: 0.3, loaf: 0.45, sleep: 0.6, wake: 0.45, stand: 0.2 }
const BLINK = 0.16
const MEOWS = ['にゃ', 'にゃーん', 'みゃう', 'にゃっ', 'なぁん']

function mixPose(a, b, w) {
  const m = (x, y) => x.map((v, i) => lerp(v, y[i], w))
  return {
    hip: m(a.hip, b.hip), chest: m(a.chest, b.chest), head: m(a.head, b.head),
    paws: a.paws.map((p, i) => m(p, b.paws[i])), tail: m(a.tail, b.tail), tb: m(a.tb, b.tb),
    slot: w < 0.5 ? a.slot : b.slot,
  }
}
const clonePose = (p) => mixPose(p, p, 0)

// 有點睏了沒（0～0.9）：專注開始兩分鐘後越來越想睡，十幾分鐘後大多在睡。休息和暫停時不睏
export const sleepiness = (ctx) => (ctx?.mode === 'focus' && !ctx.paused ? clamp(((ctx.focusMs || 0) / 60000 - 2) / 14, 0, 0.9) : 0)
const modeOf = (ctx) => (ctx?.paused ? 'paused' : ctx?.mode === 'break' ? 'break' : 'focus')
const HOVER_ACTS = new Set(['walk', 'trot', 'stand', 'sit', 'groom'])

// still：系統開了「減少動態效果」，貓不走動、不呼吸，只在原地睡著（點了會抬頭看你）
export function createCat({ seed = 1, coat = 'mike', bounds = null, still = false } = {}) {
  const r = rng(seed)
  const cat = {
    rnd: r, coat, still, time: 0,
    x: 0, y: 0, dir: 1, air: 0,
    bounds: null, k: 1,
    mode: 'focus',
    act: { kind: 'away', t: 0, dur: Infinity },
    queue: [],
    away: true, awayLeft: 0.6, leaving: false,
    pose: 'stand', base: clonePose(POSES.stand),
    blend: { from: clonePose(POSES.stand), to: POSES.stand, t: 1, dur: 0 },
    gait: 'walk', gaitW: 0, phase: 0, tx: 0, ty: 0,
    face: 0.6, faceT: 0.6, eye: 1, eyeT: 1, mood: '', mouth: 0, mouthT: 0, tilt: 0, tiltT: 0, slow: 0,
    blinkIn: between(r, 1, 4), blinkT: 0,
    ears: [0, 0], earIn: between(r, 4, 10),
    hover: false, pokes: [], events: [], zIn: 1.6,
  }
  if (bounds) setBounds(cat, bounds)
  return cat
}

// 地板大小變了（轉向、縮放視窗、卡片高度變了）：站在外面的拉回地板上，正要走去的地方也收進來
export function setBounds(cat, b) {
  cat.bounds = { ...b }
  cat.k = b.k
  if (cat.away) return
  const m = margin(cat)
  cat.y = clamp(cat.y, b.top, b.bottom)
  cat.ty = clamp(cat.ty, b.top, b.bottom)
  // 要走出畫面的：出口跟著新的寬度；其他的目標收進地板（正要撲、撲到一半的落點也是）
  const inside = (x) => clamp(x, m, Math.max(m, b.w - m))
  if (cat.act.kind === 'exit') cat.tx = cat.tx > 0 ? b.w + 70 * cat.k : -70 * cat.k
  else cat.tx = inside(cat.tx)
  for (const [kind, o] of cat.queue) if (kind === 'leap' && o) o.tx = inside(o.tx)
  if (cat.act.kind === 'leap') {
    cat.act.tx = inside(cat.act.tx)
    cat.act.x0 = inside(cat.act.x0)
  }
  // 視窗變窄（手機轉向）時被留在畫面外的貓：直接拉回來，不用等牠走好久才看得到
  if (cat.still || (cat.act.kind !== 'enter' && cat.act.kind !== 'exit' && (cat.x < 0 || cat.x > b.w))) cat.x = clamp(cat.x, m, Math.max(m, b.w - m))
}
const margin = (cat) => 52 * cat.k
// 遠近：地板最後面縮成 0.84 倍
export function depth(cat) {
  const b = cat.bounds
  if (!b || b.bottom <= b.top) return 1
  return lerp(0.84, 1, clamp((cat.y - b.top) / (b.bottom - b.top), 0, 1))
}

function setPose(cat, name, dur = 0.45) {
  cat.pose = name
  cat.blend = { from: clonePose(cat.base), to: POSES[name], t: 0, dur: cat.still ? 0 : dur }
}

// 打開專注頁時把貓放好：已經專注很久（貓早就睏了）就直接在地板上睡著，不然等一下從旁邊走進來
export function placeCat(cat, ctx) {
  cat.mode = modeOf(ctx)
  cat.queue = []
  cat.leaving = false
  cat.air = 0
  if (cat.still) return settle(cat)
  if (sleepiness(ctx) >= 0.6 && cat.mode === 'focus') {
    const b = cat.bounds
    cat.x = between(cat.rnd, margin(cat), b.w - margin(cat))
    cat.y = between(cat.rnd, b.top, b.bottom)
    return settle(cat, { sleepy: sleepiness(ctx) })
  }
  cat.away = true
  cat.awayLeft = 0.5
  begin(cat, 'away')
}

// 直接在地板上睡著（暫停中就坐著看你），姿勢一次到位。不動的貓固定在右下角
function settle(cat, sleep = { dur: Infinity }) {
  const b = cat.bounds
  cat.away = false
  if (cat.still) {
    cat.x = b.w * 0.76
    cat.y = b.bottom
  }
  cat.tx = cat.x
  cat.ty = cat.y
  cat.dir = cat.x > b.w / 2 ? -1 : 1
  begin(cat, cat.mode === 'paused' ? 'look' : 'sleep', cat.mode === 'paused' ? { pause: true } : sleep)
  cat.base = clonePose(POSES[cat.pose])
  cat.blend = { from: clonePose(cat.base), to: POSES[cat.pose], t: 1, dur: 0 }
  cat.face = cat.faceT
  cat.eye = cat.eyeT
}

// ── 動作 ──
// 開始一個動作：換姿勢、決定做多久、臉朝哪、眼睛張多開
function begin(cat, kind, o = {}) {
  const r = cat.rnd
  const a = { kind, t: 0, dur: Infinity, ...o }
  cat.act = a
  cat.mood = o.happy ? 'happy' : ''
  cat.mouthT = 0
  cat.slow = 0
  switch (kind) {
    case 'away':
      break
    case 'walk':
    case 'trot':
    case 'enter':
    case 'exit':
      cat.gait = kind === 'trot' || o.fast ? 'trot' : 'walk'
      // 從坐著、趴著站起來：先站好再邁步，不然看起來像坐著滑過去
      a.wait = cat.pose === 'stand' ? 0 : 0.42
      if (cat.pose !== 'stand') setPose(cat, 'stand', 0.42)
      cat.faceT = 0.65
      cat.eyeT = 1
      cat.tiltT = 0
      break
    case 'turn':
      a.dur = 0.3
      cat.faceT = 0
      break
    case 'stand':
      setPose(cat, 'stand')
      a.dur = between(r, 2, 5)
      cat.faceT = between(r, 0.2, 0.9)
      cat.eyeT = 1
      break
    case 'sit':
      setPose(cat, 'sit', 0.5)
      a.dur = between(r, 6, 16)
      a.yawnAt = r() < 0.3 ? between(r, 2, a.dur - 2) : -1
      cat.faceT = 0.35
      cat.eyeT = 1
      break
    case 'groom':
      setPose(cat, 'sit', 0.45)
      a.dur = between(r, 5.5, 9)
      cat.faceT = 0.75
      cat.eyeT = 0.15
      cat.tiltT = 0
      break
    case 'loaf':
      setPose(cat, 'loaf', 0.7)
      a.dur = between(r, 12, 40)
      cat.faceT = 0.35
      cat.eyeT = 0.5
      cat.tiltT = 0
      break
    case 'sleep':
      setPose(cat, 'sleep', 1)
      a.dur = o.dur ?? between(r, 40, 90) + 240 * (o.sleepy ?? 0)
      cat.faceT = 0.2
      cat.eyeT = 0
      cat.tiltT = 0
      cat.zIn = 1.6
      break
    case 'wake':
      setPose(cat, 'loaf', 0.6)
      a.dur = 1.8
      cat.faceT = 0.35
      cat.eyeT = 0
      break
    case 'stretch':
      setPose(cat, 'stretch', 0.7)
      a.dur = 2.7
      cat.faceT = 0.8
      cat.eyeT = 0.15
      cat.tiltT = 0
      break
    case 'look':
      // 看著你：暫停時一直坐著看；被摸、滑鼠移過來時看一下
      setPose(cat, o.stand ? 'stand' : 'sit', 0.45)
      if (o.dur) a.dur = o.dur
      cat.faceT = 0
      cat.eyeT = 1
      cat.tiltT = between(r, -7, 7)
      break
    case 'crouch':
      setPose(cat, 'crouch', 0.35)
      a.dur = between(r, 1.1, 1.6)
      cat.faceT = 0.95
      cat.eyeT = 1.1
      cat.tiltT = 0
      break
    case 'leap':
      setPose(cat, 'leap', 0.16)
      a.dur = 0.5
      a.x0 = cat.x
      cat.faceT = 0.95
      cat.eyeT = 1.1
      break
    case 'land':
      setPose(cat, 'crouch', 0.12)
      a.dur = 0.3
      break
  }
}

// 去某個地方：方向不對先轉身
function go(cat, x, y, kind = 'walk', o = {}) {
  cat.tx = x
  cat.ty = y
  const want = Math.sign(x - cat.x) || cat.dir
  if (want !== cat.dir && Math.abs(x - cat.x) > 4) {
    begin(cat, 'turn')
    cat.queue.unshift([kind, o])
  } else begin(cat, kind, o)
}

// 下一個要去的地方：離現在至少一段距離，不要只挪一小步
function walkTarget(cat) {
  const b = cat.bounds
  const r = cat.rnd
  const m = margin(cat)
  const far = Math.min(150, (b.w - 2 * m) * 0.25)
  for (let i = 0; i < 6; i++) {
    const x = between(r, m, Math.max(m, b.w - m))
    if (Math.abs(x - cat.x) >= far) return [x, between(r, b.top, b.bottom)]
  }
  return [between(r, m, Math.max(m, b.w - m)), between(r, b.top, b.bottom)]
}

// 一個動作做完：排好的先做，沒有就看心情（專注越久越想睡；休息時比較好動，會撲來撲去）
function next(cat, ctx) {
  if (cat.queue.length) {
    const [kind, o] = cat.queue.shift()
    return begin(cat, kind, o)
  }
  const r = cat.rnd
  const s = sleepiness(ctx)
  const prev = cat.act.kind
  if (cat.still) return begin(cat, cat.mode === 'paused' ? 'look' : 'sleep', cat.mode === 'paused' ? { pause: true } : { dur: Infinity })
  if (cat.leaving) return goOff(cat)
  if (cat.mode === 'paused') return begin(cat, 'look', { pause: true })
  let k
  if (cat.mode === 'break') {
    k = pick(r, [['walk', 3], ['trot', 2], ['pounce', 1.6], ['stand', 1], ['sit', 1.2], ['groom', 0.6]])
  } else {
    switch (prev) {
      case 'walk':
      case 'trot':
      case 'enter':
      case 'land':
        k = pick(r, [['stand', 1.4], ['sit', 2.6 + 3 * s], ['walk', 2.2 * (1 - s)], ['exit', 0.3 * (1 - s)]])
        break
      case 'sit':
        k = pick(r, [['groom', 1.3], ['loaf', 0.5 + 5 * s], ['walk', 1.5 * (1 - s)], ['stand', 0.6 * (1 - s)]])
        break
      case 'groom':
        k = pick(r, [['sit', 1.6], ['loaf', 0.8 + 4 * s], ['walk', 1.1 * (1 - s)]])
        break
      case 'loaf':
        k = pick(r, [['sleep', 0.4 + 7 * s], ['sit', 1], ['stand', 0.5 * (1 - s)]])
        break
      case 'sleep':
        k = 'wake'
        break
      case 'wake':
        k = pick(r, [['stretch', 2], ['sit', 1], ['loaf', 3 * s]])
        break
      default:
        // stand、look、stretch、turn 之後
        k = pick(r, [['walk', 2.4 * (1 - 0.6 * s)], ['sit', 1.8 + 3 * s], ['stretch', prev === 'stretch' || prev === 'wake' ? 0 : 0.35]])
    }
  }
  if (k === 'walk' || k === 'trot') {
    const [x, y] = walkTarget(cat)
    return go(cat, x, y, k)
  }
  if (k === 'exit') return goOff(cat)
  if (k === 'pounce') {
    // 往前撲：前面要有地方落地，不夠就轉身朝另一邊撲
    const dist = between(r, 60, 100) * cat.k
    const m = margin(cat)
    let dir = cat.dir
    if (cat.x + dir * dist < m || cat.x + dir * dist > cat.bounds.w - m) dir = -dir
    if (cat.x + dir * dist < m || cat.x + dir * dist > cat.bounds.w - m) return begin(cat, 'stand')
    cat.tx = cat.x + dir * dist
    cat.ty = cat.y
    const jump = ['leap', { tx: cat.tx, h: between(r, 18, 28) * cat.k }]
    if (dir !== cat.dir) {
      begin(cat, 'turn')
      cat.queue.unshift(['crouch'], jump)
    } else {
      begin(cat, 'crouch')
      cat.queue.unshift(jump)
    }
    return
  }
  if (k === 'sleep') return begin(cat, 'sleep', { sleepy: s })
  return begin(cat, k)
}

// 走出畫面（從比較近的那一邊）：走完就先不見，過一陣子再從某一邊走回來
function goOff(cat) {
  const b = cat.bounds
  go(cat, cat.x < b.w / 2 ? -70 * cat.k : b.w + 70 * cat.k, cat.y, 'exit', { fast: cat.leaving })
}

function enter(cat) {
  const b = cat.bounds
  const r = cat.rnd
  const left = r() < 0.5
  cat.away = false
  cat.dir = left ? 1 : -1
  cat.x = left ? -60 * cat.k : b.w + 60 * cat.k
  cat.y = between(r, b.top, b.bottom)
  const span = Math.max(0, b.w - 2 * margin(cat))
  const inX = margin(cat) + span * between(r, 0.12, 0.4)
  cat.tx = left ? inX : b.w - inX
  cat.ty = between(r, b.top, b.bottom)
  cat.base = clonePose(POSES.stand)
  cat.blend = { from: clonePose(POSES.stand), to: POSES.stand, t: 1, dur: 0 }
  cat.pose = 'stand'
  cat.queue = []
  begin(cat, 'enter')
}

// 往目標走一步；到了回傳 true
function moveToward(cat, dt, speed) {
  const dx = cat.tx - cat.x
  const dy = cat.ty - cat.y
  const d = Math.hypot(dx, dy)
  const step = speed * dt
  const moved = Math.min(d, step)
  if (d > 0.001) {
    cat.x += (dx / d) * moved
    cat.y += (dy / d) * moved
  }
  // 腳步跟著走的距離換：腳掌踩在地上時不會滑
  const g = GAITS[cat.gait]
  cat.phase = (cat.phase + (moved / (cat.k * depth(cat))) * (g.duty / g.stride)) % 1
  return d <= step
}

// 模式變了：暫停時醒來看著你；開始休息時伸個懶腰（睡著的先醒來）
function syncMode(cat, ctx) {
  const m = modeOf(ctx)
  if (m === cat.mode) return
  const was = cat.mode
  cat.mode = m
  if (cat.away || cat.leaving) return
  const a = cat.act
  const asleep = a.kind === 'sleep' || a.kind === 'loaf'
  if (cat.still) {
    cat.queue = []
    return begin(cat, m === 'paused' ? 'look' : 'sleep', m === 'paused' ? { pause: true } : { dur: Infinity })
  }
  // 正在半空中、轉身、走進或走出畫面：做完再說（走出去的回來後再看你）
  const busy = a.kind === 'leap' || a.kind === 'turn' || a.kind === 'enter' || a.kind === 'exit' || a.kind === 'crouch'
  if (m === 'paused') {
    cat.queue = []
    if (busy) return cat.queue.push(['look', { pause: true }])
    if (asleep) {
      begin(cat, 'wake')
      cat.queue.push(['look', { pause: true }])
    } else begin(cat, 'look', { pause: true })
    return
  }
  // 不暫停了：不再一直坐著看你
  if (a.kind === 'look' && a.pause) a.done = true
  cat.queue = cat.queue.filter(([k, o]) => !(k === 'look' && o?.pause))
  if (m === 'break' && was !== 'break') {
    if (busy) return cat.queue.length || cat.queue.push(['stretch'])
    cat.queue = []
    if (asleep) {
      begin(cat, 'wake')
      cat.queue.push(['stretch'])
    } else begin(cat, 'stretch')
  }
}

// ── 每一格：dt 秒過去了 ──
// ctx：{ mode: 'focus' | 'break', paused, focusMs（這一輪專注了多久）}
export function stepCat(cat, dt, ctx = {}) {
  dt = clamp(dt, 0, 0.1)
  cat.time += dt
  syncMode(cat, ctx)
  const r = cat.rnd
  let a = cat.act
  a.t += dt

  if (a.kind === 'away') {
    if (!cat.leaving && (cat.awayLeft -= dt) <= 0) cat.still ? settle(cat) : enter(cat)
    a = cat.act
  } else if (['walk', 'trot', 'enter', 'exit'].includes(a.kind)) {
    if (a.t >= (a.wait || 0)) {
      // rush：被叫過來時跑快一點（路遠也不會讓人等）
      const speed = SPEED[cat.gait] * cat.k * depth(cat) * (a.rush || 1)
      if (moveToward(cat, dt, speed)) {
        a.done = true
        if (a.kind === 'exit') {
          cat.away = true
          cat.awayLeft = between(r, 6, 16)
          cat.queue = []
          begin(cat, 'away')
          a = cat.act
        }
      }
    }
  } else if (a.kind === 'turn') {
    if (!a.flipped && a.t >= a.dur / 2) {
      cat.dir = -cat.dir
      a.flipped = true
    }
  } else if (a.kind === 'leap') {
    const u = clamp(a.t / a.dur, 0, 1)
    cat.x = lerp(a.x0, a.tx, u)
    cat.air = 4 * a.h * u * (1 - u)
    if (u >= 1) {
      cat.air = 0
      cat.queue.unshift(['land'])
    }
  } else if (a.kind === 'sleep' && !cat.still) {
    if ((cat.zIn -= dt) <= 0) {
      cat.events.push({ type: 'z' })
      cat.zIn = between(r, 2, 2.8)
    }
  } else if (a.kind === 'sit' || (a.kind === 'stand' && !a.pause)) {
    // 東看看西看看；偶爾打個哈欠
    if ((a.lookIn = (a.lookIn ?? between(r, 1, 3)) - dt) <= 0) {
      cat.faceT = [0, 0.15, 0.5, 0.8, 0.95][Math.floor(r() * 5)]
      cat.tiltT = r() < 0.4 ? between(r, -8, 8) : 0
      a.lookIn = between(r, 1.5, 4)
    }
    if (a.yawnAt > 0 && a.t >= a.yawnAt) cat.mouthT = a.t < a.yawnAt + 1.1 ? 1 : 0
  } else if (a.kind === 'wake') {
    cat.mouthT = a.t > 0.3 && a.t < 1.3 ? 1 : 0
    cat.eyeT = a.t > 1.35 ? 0.6 : 0
  } else if (a.kind === 'stretch') {
    cat.mouthT = a.t > 0.8 && a.t < 1.9 ? 1 : 0
    // 伸完站起來
    if (a.t >= a.dur - 0.55 && cat.pose === 'stretch') setPose(cat, 'stand', 0.55)
    cat.eyeT = a.t > 2.1 ? 1 : 0.15
  } else if (a.kind === 'look') {
    // 滑鼠移開了：再看一下就走
    if (a.hover && !cat.hover) {
      a.hover = false
      a.dur = a.t + 0.8
    }
    // 暫停時一直看著你，摸一下會笑一下
    if (a.happyT > 0 && (a.happyT -= dt) <= 0) cat.mood = ''
  }

  // 慢慢眨眼（坐著、趴著時）：貓眨眼是在說「我很放心」
  if ((a.kind === 'sit' || a.kind === 'loaf' || a.kind === 'look') && !cat.still) {
    if ((a.slowIn = (a.slowIn ?? between(r, 3, 7)) - dt) <= 0) {
      cat.slow = 1.1
      a.slowIn = between(r, 5, 11)
    }
  }
  // 滑鼠移到牠身上：醒著就停下來看你（走進畫面、轉身、伸懶腰、要離開時不理）
  if (cat.hover && !cat.still && !cat.leaving && HOVER_ACTS.has(a.kind)) {
    cat.queue = []
    begin(cat, 'look', { stand: a.kind !== 'sit' && a.kind !== 'groom', hover: true })
    a = cat.act
  }

  if (a.t >= a.dur) a.done = true
  if (a.done) next(cat, ctx)

  // 姿勢慢慢換過去
  cat.blend.t += dt
  const w = cat.blend.dur ? ease(clamp(cat.blend.t / cat.blend.dur, 0, 1)) : 1
  cat.base = mixPose(cat.blend.from, cat.blend.to, w)
  // 走路的腳步：在走才用步態，停下來時腳慢慢收回站姿
  const moving = ['walk', 'trot', 'enter', 'exit'].includes(cat.act.kind) && cat.act.t >= (cat.act.wait || 0)
  cat.gaitW = cat.still ? 0 : approach(cat.gaitW, moving ? 1 : 0, 9, dt)
  if (!moving && cat.gaitW < 0.02) cat.phase = 0

  // 臉、眼睛、嘴巴：慢慢轉過去（不動的貓直接換好）
  if (cat.still) {
    cat.face = cat.faceT
    cat.tilt = cat.tiltT
    cat.eye = cat.eyeT
    cat.mouth = 0
  } else {
    cat.face = approach(cat.face, cat.faceT, 5, dt)
    cat.tilt = approach(cat.tilt, cat.tiltT, 5, dt)
    cat.mouth = approach(cat.mouth, cat.mouthT, 6, dt)
    const eyeTo = cat.slow > 0 ? Math.min(cat.eyeT, 0.12) : cat.eyeT
    cat.eye = approach(cat.eye, eyeTo, cat.slow > 0 ? 4 : 8, dt)
    cat.slow = Math.max(0, cat.slow - dt)
  }
  if (!cat.still) {
    if (cat.blinkT > 0) cat.blinkT = Math.max(0, cat.blinkT - dt)
    else if ((cat.blinkIn -= dt) <= 0) {
      if (cat.eyeT > 0.6 && cat.mood !== 'happy') cat.blinkT = BLINK
      cat.blinkIn = between(r, 2.4, 6)
    }
    // 耳朵偶爾抖一下
    for (let i = 0; i < 2; i++) cat.ears[i] = Math.max(0, cat.ears[i] - dt)
    if ((cat.earIn -= dt) <= 0) {
      cat.ears[r() < 0.5 ? 0 : 1] = 0.24
      cat.earIn = between(r, 5, 12)
    }
  }
}

// ── 互動 ──
// 點了貓：醒著就看你、喵一聲（三秒內點三下會呼嚕）；睡著的有時只動動耳朵，有時醒來看你
export function pokeCat(cat) {
  if (cat.away || cat.leaving) return null
  const a = cat.act
  const now = cat.time
  cat.pokes = cat.pokes.filter((t) => now - t < 3)
  cat.pokes.push(now)
  if (cat.still) {
    begin(cat, 'look', { dur: 2.4, happy: true })
    cat.events.push({ type: 'say', text: MEOWS[0] })
    return 'meow'
  }
  if (a.kind === 'leap' || a.kind === 'turn') return null
  // 正走進、走出畫面（在邊邊上）：喵一聲，照樣走，不會停在只露出半隻的地方
  if (a.kind === 'enter' || a.kind === 'exit') {
    cat.events.push({ type: 'say', text: MEOWS[Math.floor(cat.rnd() * MEOWS.length)] })
    return 'meow'
  }
  if (a.kind === 'sleep') {
    if (cat.pokes.length < 2 && cat.rnd() < 0.55) {
      cat.ears[cat.rnd() < 0.5 ? 0 : 1] = 0.24
      cat.events.push({ type: 'z' })
      return 'twitch'
    }
    cat.queue = [['look', { dur: 2.6 }]]
    begin(cat, 'wake')
    cat.events.push({ type: 'say', text: 'にゃ…？' })
    return 'wake'
  }
  if (cat.pokes.length >= 3) {
    cat.pokes = []
    cat.queue = []
    begin(cat, 'look', { dur: 4, happy: true, stand: cat.pose === 'stand' })
    cat.events.push({ type: 'say', text: 'ゴロゴロ…' }, { type: 'heart' })
    return 'purr'
  }
  cat.queue = []
  if (a.kind === 'look' && a.pause) {
    a.happyT = 2
    cat.mood = 'happy'
  } else begin(cat, 'look', { dur: 2.4, happy: true, stand: cat.pose === 'stand' })
  cat.events.push({ type: 'say', text: MEOWS[Math.floor(cat.rnd() * MEOWS.length)] })
  return 'meow'
}

// 滑鼠移到牠身上、移開（手機沒有這個）
export function hoverCat(cat, on) {
  cat.hover = !!on
}

// 關掉貓咪：小跑步離開畫面（睡著的先醒來）；離開後 away 會是 true
export function leaveCat(cat) {
  if (cat.leaving) return
  cat.leaving = true
  if (cat.away) return
  cat.queue = []
  // 不動的貓不跑步：直接收起來
  if (cat.still) {
    cat.away = true
    return begin(cat, 'away')
  }
  if (cat.act.kind === 'sleep' || cat.act.kind === 'loaf') {
    begin(cat, 'wake', { dur: 0.9 })
    cat.act.dur = 0.9
  } else if (cat.act.kind !== 'leap') goOff(cat)
}
// 又打開了：還在畫面上就繼續；已經走掉的過一下就回來
export function comeBack(cat) {
  if (!cat.leaving) return
  cat.leaving = false
  if (cat.away) {
    cat.awayLeft = 0.3
    return
  }
  // 還沒走出去：不走了（正在轉身準備離開的，排在後面的離開也取消）
  cat.queue = cat.queue.filter(([kind]) => kind !== 'exit')
  if (cat.act.kind === 'exit') begin(cat, 'stand')
}

// 叫牠過來（打開 App 時的今日摘要）：從比較近的那一邊小跑步進來，到 (x, y) 停下。
// 到了之後做什麼照 ctx：暫停中就坐下看著你。不動的貓直接坐在那裡
export function callCat(cat, x, y, ctx = {}) {
  const b = cat.bounds
  if (!b) return
  const m = margin(cat)
  x = clamp(x, m, Math.max(m, b.w - m))
  y = clamp(y, b.top, b.bottom)
  const left = x < b.w / 2
  cat.mode = modeOf(ctx)
  cat.leaving = false
  cat.queue = []
  cat.air = 0
  cat.hover = false
  if (cat.still) {
    settle(cat)
    cat.x = cat.tx = x
    cat.y = cat.ty = y
    cat.dir = left ? 1 : -1
    return
  }
  cat.away = false
  cat.dir = left ? 1 : -1
  cat.x = left ? -60 * cat.k : b.w + 60 * cat.k
  cat.y = y
  cat.tx = x
  cat.ty = y
  cat.base = clonePose(POSES.stand)
  cat.blend = { from: clonePose(POSES.stand), to: POSES.stand, t: 1, dur: 0 }
  cat.pose = 'stand'
  // 大約一秒半內跑到：路遠就跑快一點（最多三倍多，再遠就讓牠慢慢來）
  begin(cat, 'enter', { fast: true, rush: clamp(Math.abs(x - cat.x) / (1.5 * SPEED.trot * cat.k), 1, 3.4) })
}

// ── 這一格畫成什麼樣子 ──
const eyeOf = (cat) => (cat.blinkT > 0 ? cat.eye * (1 - 0.92 * Math.sin(Math.PI * (1 - cat.blinkT / BLINK))) : cat.eye)
// 轉身：身體壓扁再翻過去
function flipOf(cat) {
  const a = cat.act
  if (a.kind !== 'turn') return cat.dir
  return cat.dir * lerp(1, 0.18, Math.sin(Math.PI * clamp(a.t / a.dur, 0, 1)))
}

// 回傳畫一隻貓要的全部數字：位置、遠近和翻面、身體兩顆圓、頭、四隻腳（腳根→腳掌）、尾巴的點
export function poseOf(cat) {
  const B = cat.base
  const a = cat.act
  const t = cat.time
  const still = cat.still
  let [hx, hy, hr] = B.hip
  let [cx, cy, cr] = B.chest
  let [qx, qy, rot] = B.head
  if (!still && BREATH[a.kind]) {
    const s = Math.sin(t * (a.kind === 'sleep' ? 1.7 : 2.4)) * BREATH[a.kind]
    hr += s
    cr += s * 1.1
    cy -= s * 0.5
    qy -= s * 0.6
  }
  const gw = cat.gaitW
  if (gw > 0.01) {
    const ph = cat.phase * Math.PI * 4
    hy += Math.sin(ph) * 0.7 * gw
    cy += Math.sin(ph + 1.2) * 0.7 * gw
    qy += Math.sin(ph + 0.6) * 0.5 * gw
  }
  // 蹲低準備撲：屁股左右扭
  if (a.kind === 'crouch' && !still) {
    const u = Math.sin(a.t * 17)
    hx += u * 1.4
    hy -= Math.abs(u) * 0.6
  }
  const paws = B.paws.map((p) => [p[0], p[1]])
  if (gw > 0.01) {
    const g = GAITS[cat.gait]
    const rest = POSES.stand.paws
    for (let i = 0; i < 4; i++) {
      const p = (cat.phase + g.offs[i]) % 1
      let dx
      let dy = 0
      if (p < g.duty) dx = g.stride * (0.5 - p / g.duty)
      else {
        const s = (p - g.duty) / (1 - g.duty)
        dx = g.stride * (ease(s) - 0.5)
        dy = -g.lift * Math.sin(Math.PI * s)
      }
      paws[i] = [lerp(paws[i][0], rest[i][0] + dx, gw), lerp(paws[i][1], dy, gw)]
    }
  }
  rot += cat.tilt
  // 理毛：舔前腳、用前腳洗臉（那隻腳畫在頭的前面）
  let raised = false
  if (a.kind === 'groom' && !still) {
    const inOut = ease(clamp(Math.min(a.t, a.dur - a.t) / 0.45, 0, 1))
    const u = a.t % 6.4
    let px
    let py
    if (u < 2.4 || u >= 4.8) {
      const lick = Math.sin(a.t * 13)
      px = qx + 10 + cat.face * 3
      py = qy + 13 + lick * 1.2
      rot += (12 + lick * 3) * inOut
    } else {
      const v = ((u - 2.4) / 1.2) * Math.PI * 2
      px = qx + 7 + Math.cos(v) * 5
      py = qy + 1 + Math.sin(v) * 6
      rot += 6 * inOut
    }
    paws[0] = [lerp(paws[0][0], px, inOut), lerp(paws[0][1], py, inOut)]
    raised = inOut > 0.3
  }
  // 打哈欠：頭往上抬
  rot -= 10 * cat.mouth
  const fj = [cx + 2, cy + cr * 0.4]
  const hj = [hx - 1, hy + hr * 0.4]
  const legs = [
    { j: fj, p: paws[0], fore: true, far: false, top: raised },
    { j: [fj[0] - 4, fj[1] - 1], p: paws[1], fore: true, far: true, top: false },
    { j: hj, p: paws[2], fore: false, far: false, top: false },
    { j: [hj[0] - 4, hj[1] - 1], p: paws[3], fore: false, far: true, top: false },
  ]
  const crouch = a.kind === 'crouch'
  const wave = still ? 0 : B.tail[2] + (crouch ? 8 : 0) + 4 * gw
  const tail = tailPoints([hx + B.tb[0] * hr, hy + B.tb[1] * hr], B.tail[0], B.tail[1], wave, t * (crouch ? 9 : 2.3))
  const left = Math.min(hx - hr, cx - cr)
  const right = Math.max(hx + hr, cx + cr)
  return {
    x: cat.x, y: cat.y - cat.air, s: cat.k * depth(cat), flip: flipOf(cat),
    hip: [hx, hy, hr], chest: [cx, cy, cr],
    head: {
      x: qx, y: qy, rot, face: cat.face, eye: eyeOf(cat), mood: cat.mood, mouth: cat.mouth,
      ears: cat.ears.map((e) => (e > 0 ? 24 * Math.sin((Math.PI * e) / 0.24) : 0)),
    },
    legs, tail, slot: B.slot,
    // 影子：身體正下方，跳起來時縮小變淡
    shadow: { x: (left + right) / 2 + 4, rx: (right - left) / 2 + 7, lift: cat.air / Math.max(0.01, cat.k) },
  }
}

// ── 畫路徑用的幾何 ──
const f = (n) => Math.round(n * 10) / 10
const circlePath = (x, y, r) => `M${f(x - r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x + r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x - r)} ${f(y)}Z`

// 身體：包住屁股和胸口兩顆圓的形狀。肚子那一側微微往下垂、背往上拱一點，比直線胖一點
export function bodyPath([ax, ay, ar], [bx, by, br]) {
  const dx = bx - ax
  const dy = by - ay
  const d = Math.hypot(dx, dy)
  if (d + ar <= br) return circlePath(bx, by, br)
  if (d + br <= ar) return circlePath(ax, ay, ar)
  const th = Math.atan2(dy, dx)
  const ph = Math.acos(clamp((ar - br) / d, -1, 1))
  const at = (x, y, r, an) => [x + r * Math.cos(an), y + r * Math.sin(an)]
  const A1 = at(ax, ay, ar, th + ph)
  const B1 = at(bx, by, br, th + ph)
  const A2 = at(ax, ay, ar, th - ph)
  const B2 = at(bx, by, br, th - ph)
  const nx = -Math.sin(th)
  const ny = Math.cos(th)
  const belly = [(A1[0] + B1[0]) / 2 + nx * 1.6, (A1[1] + B1[1]) / 2 + ny * 1.6]
  const back = [(A2[0] + B2[0]) / 2 - nx * 1.1, (A2[1] + B2[1]) / 2 - ny * 1.1]
  const lb = 2 * ph > Math.PI ? 1 : 0
  const la = 2 * ph < Math.PI ? 1 : 0
  return (
    `M${f(A1[0])} ${f(A1[1])}Q${f(belly[0])} ${f(belly[1])} ${f(B1[0])} ${f(B1[1])}` +
    `A${f(br)} ${f(br)} 0 ${lb} 0 ${f(B2[0])} ${f(B2[1])}Q${f(back[0])} ${f(back[1])} ${f(A2[0])} ${f(A2[1])}` +
    `A${f(ar)} ${f(ar)} 0 ${la} 0 ${f(A1[0])} ${f(A1[1])}Z`
  )
}

// 腳：從腳根到腳掌的一筆，比原本長度短的時候膝蓋往外彎（前腳往前、後腳往後）
export function legPath(j, p, rest, fore) {
  const dx = p[0] - j[0]
  const dy = p[1] - j[1]
  const d = Math.hypot(dx, dy) || 0.001
  const h = Math.min(3.5, Math.sqrt(Math.max(0, rest * rest - d * d)) / 2)
  const s = fore ? -1 : 1
  const mx = (j[0] + p[0]) / 2 + (-dy / d) * s * h * 2
  const my = (j[1] + p[1]) / 2 + (dx / d) * s * h * 2
  return `M${f(j[0])} ${f(j[1])}Q${f(mx)} ${f(my)} ${f(p[0])} ${f(p[1])}`
}

// 白襪子：腳掌往上一小段
export function sockPath(j, p, len = 6) {
  const dx = j[0] - p[0]
  const dy = j[1] - p[1]
  const d = Math.hypot(dx, dy) || 1
  const u = Math.min(1, len / d)
  return `M${f(p[0])} ${f(p[1])}L${f(p[0] + dx * u)} ${f(p[1] + dy * u)}`
}

// 尾巴：一節一節往後接，每節多彎一點，再疊上波浪擺動（越靠尾巴尖擺越大）；不穿到地板下面
export function tailPoints(base, a0, curl, wave, ph) {
  const seg = TAIL.len / TAIL.n
  let [x, y] = base
  const pts = [[x, y]]
  for (let i = 0; i < TAIL.n; i++) {
    const an = (a0 + curl * i + wave * Math.sin(ph - i * 0.7) * ((i + 1) / TAIL.n)) * D2R
    x += Math.cos(an) * seg
    y = Math.min(y + Math.sin(an) * seg, -TAIL.w / 2)
    pts.push([x, y])
  }
  return pts
}

// 穿過每個點的平滑曲線（Catmull-Rom 換成三次貝茲）
export function smoothPath(pts) {
  let s = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    s +=
      `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }
  return s
}

// 虎斑：背上幾條短短的紋，從背往肚子的方向畫（會被身體的形狀裁掉）
export function stripesPath([ax, ay, ar], [bx, by, br]) {
  const dx = bx - ax
  const dy = by - ay
  const d = Math.hypot(dx, dy) || 1
  const ux = dx / d
  const uy = dy / d
  let s = ''
  for (const t of [-0.12, 0.2, 0.5, 0.8]) {
    const px = ax + dx * t
    const py = ay + dy * t
    const r = lerp(ar, br, clamp(t, 0, 1))
    s += `M${f(px + uy * (r + 3))} ${f(py - ux * (r + 3))}L${f(px + uy * r * 0.25 - ux * 2.5)} ${f(py - ux * r * 0.25 - uy * 2.5)}`
  }
  return s
}
