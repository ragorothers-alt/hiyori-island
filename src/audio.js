// 以 WebAudio 即時合成的柔和音效（五聲音階、風鈴、寺院鐘聲），不需任何音檔。
let ctx = null
let master = null
let enabled = true

// 音效看自己的開關；背景聲由專注那邊照存檔裡的設定決定放不放（另一個分頁開了音效也對得上），直接拿 ctxOf()
function ensure() {
  return enabled ? ctxOf() : null
}
function ctxOf() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.32
    // 簡易殘響：短延遲回授
    const delay = ctx.createDelay()
    delay.delayTime.value = 0.19
    const fb = ctx.createGain()
    fb.gain.value = 0.28
    const wet = ctx.createGain()
    wet.gain.value = 0.35
    master.connect(ctx.destination)
    master.connect(delay)
    delay.connect(fb)
    fb.connect(delay)
    delay.connect(wet)
    wet.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// 第一次使用者操作時解鎖音訊
globalThis.addEventListener?.('pointerdown', () => ensure(), { once: true })

const PENTA = [0, 2, 4, 7, 9]
const freq = (deg, base = 587.33) => {
  const oct = Math.floor(deg / 5)
  return base * 2 ** ((PENTA[((deg % 5) + 5) % 5] + oct * 12) / 12)
}

function note(f, { at = 0, dur = 0.6, type = 'sine', gain = 0.5, attack = 0.008, partials = [] } = {}) {
  const c = ensure()
  if (!c) return
  const t = c.currentTime + at
  const out = c.createGain()
  out.gain.setValueAtTime(0, t)
  out.gain.linearRampToValueAtTime(gain, t + attack)
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  out.connect(master)
  for (const [mult, g] of [[1, 1], ...partials]) {
    const o = c.createOscillator()
    o.type = type
    o.frequency.value = f * mult
    const pg = c.createGain()
    pg.gain.value = g
    o.connect(pg)
    pg.connect(out)
    o.start(t)
    o.stop(t + dur + 0.05)
  }
}

const bell = [[2.76, 0.25], [5.4, 0.08]]

export const sfx = {
  setEnabled(v) {
    enabled = v
  },
  pop() {
    note(freq(4), { dur: 0.18, type: 'triangle', gain: 0.25 })
  },
  plant() {
    note(freq(2), { dur: 0.25, type: 'triangle', gain: 0.25 })
    note(freq(4), { at: 0.07, dur: 0.3, type: 'triangle', gain: 0.22 })
  },
  bloom(priority = 2) {
    const start = priority === 3 ? 3 : 2
    ;[0, 1, 2].forEach((i) => note(freq(start + i * 2), { at: i * 0.075, dur: 0.9, gain: 0.32, partials: bell }))
  },
  undo() {
    note(freq(3), { dur: 0.22, type: 'triangle', gain: 0.18 })
    note(freq(1), { at: 0.08, dur: 0.3, type: 'triangle', gain: 0.16 })
  },
  build() {
    ;[0, 2, 4, 7].forEach((d, i) => note(freq(d, 293.66), { at: i * 0.09, dur: 0.7, type: 'triangle', gain: 0.28 }))
  },
  fanfare() {
    ;[0, 2, 4, 5, 7, 9, 10].forEach((d, i) => note(freq(d), { at: i * 0.09, dur: 1.4, gain: 0.3, partials: bell }))
  },
  levelUp() {
    ;[0, 4, 7, 9, 12].forEach((d, i) => note(freq(d, 440), { at: i * 0.11, dur: 1.6, gain: 0.32, partials: bell }))
  },
  temple() {
    note(196, { dur: 4.5, gain: 0.5, attack: 0.004, partials: [[2.01, 0.4], [2.76, 0.3], [4.1, 0.12], [5.43, 0.06]] })
  },
  reminder() {
    ;[9, 7, 9, 11].forEach((d, i) => note(freq(d), { at: i * 0.16, dur: 1.4, gain: 0.26, partials: bell }))
  },
  chime() {
    ;[7, 9, 11].forEach((d, i) => note(freq(d), { at: i * 0.13, dur: 1.2, gain: 0.2, partials: bell }))
  },
  squish() {
    const c = ensure()
    if (!c) return
    const t = c.currentTime
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(520, t)
    o.frequency.exponentialRampToValueAtTime(880, t + 0.12)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
    o.connect(g)
    g.connect(master)
    o.start(t)
    o.stop(t + 0.25)
  },
}

// ── 專注時的背景聲：雨聲、褐噪音、粉紅噪音（蓋掉周圍的聲音，很多容易分心的人靠它進入狀態）──
// 一樣即時產生、不用音檔：做一段頭尾接得起來的聲音循環播放，不經過音效的殘響，直接接到喇叭

// 填滿一段聲音（大約 -1～1，之後會再調音量）。rand：亂數（測試時換成固定的）
const GEN = {
  // 褐噪音：低沉、像遠處的瀑布或飛機艙（白噪音累加起來，漏掉一點免得越飄越遠）
  brown(a, rate, rand) {
    let last = 0
    for (let i = 0; i < a.length; i++) {
      last = (last + 0.02 * (rand() * 2 - 1)) / 1.02
      a[i] = last
    }
  },
  // 粉紅噪音：比白噪音柔和，高低音一樣多（Paul Kellet 的濾波）
  pink(a, rate, rand) {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < a.length; i++) {
      const w = rand() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      a[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
      b6 = w * 0.115926
    }
  },
  // 雨聲：底下一片細細的沙沙聲（只留中高頻，強弱慢慢起伏），上面落著大大小小、很快就消失的雨滴
  rain(a, rate, rand) {
    const lp = Math.exp((-2 * Math.PI * 5200) / rate)
    const hp = Math.exp((-2 * Math.PI * 420) / rate)
    const ph = rand() * Math.PI * 2
    let l = 0
    let h = 0
    let prev = 0
    for (let i = 0; i < a.length; i++) {
      l = (1 - lp) * (rand() * 2 - 1) + lp * l
      h = hp * (h + l - prev)
      prev = l
      a[i] = h * (1 + 0.15 * Math.sin((2 * Math.PI * i) / (rate * 7.3) + ph))
    }
    const drops = Math.round((a.length / rate) * 34)
    for (let d = 0; d < drops; d++) {
      const big = rand() < 0.12
      const at = Math.floor(rand() * a.length)
      const f = 1400 + rand() * (big ? 1800 : 3600)
      const tau = (big ? 0.007 : 0.003) + rand() * 0.004
      const amp = (big ? 0.5 : 0.18) * (0.4 + rand() * 0.6)
      const p = rand() * Math.PI * 2
      const len = Math.min(a.length - at, Math.floor(tau * rate * 6))
      for (let i = 0; i < len; i++) a[at + i] += amp * Math.sin((2 * Math.PI * f * i) / rate + p) * Math.exp(-i / (tau * rate))
    }
  },
}
export const NOISE_KINDS = Object.keys(GEN)

// 一段可以無縫循環的聲音（n 個樣本）：多做一小段，尾巴用等功率交叉淡化接回開頭（循環時不會「喀」一聲）；
// 三種聲音調成差不多大（RMS 0.2），最大不超過 0.98
export function loopNoise(kind, n, rate, rand = Math.random) {
  const fade = Math.min(Math.floor(rate * 0.5), Math.floor(n / 4))
  const raw = new Float32Array(n + fade)
  GEN[kind](raw, rate, rand)
  const out = raw.slice(0, n)
  for (let i = 0; i < fade; i++) {
    const t = ((i + 0.5) / fade) * (Math.PI / 2)
    out[i] = raw[i] * Math.sin(t) + raw[n + i] * Math.cos(t)
  }
  let sum = 0
  let peak = 0
  for (let i = 0; i < n; i++) {
    sum += out[i] * out[i]
    peak = Math.max(peak, Math.abs(out[i]))
  }
  const k = Math.min(0.2 / (Math.sqrt(sum / n) || 1), 0.98 / (peak || 1))
  for (let i = 0; i < n; i++) out[i] *= k
  return out
}

// 同一個瀏覽器開著好幾個分頁（計時跟著同步）：只有一個分頁放，不會疊成兩倍大聲。
// 誰放記在 localStorage（{ id, at }）：最後在操作的那個分頁放；放的那個分頁關掉了，換還想放的分頁接手。
// 放的分頁每 BEAT 記一次「還在」：被系統收掉、當掉（沒機會說要走）的話，STALE 之後換人放，
// 重新打開的 App 也不會一直等著一個已經不在的分頁
const NOISE_TAB = 'hiyori-noise-tab'
const BEAT = 5000
const STALE = 15000
const tabId = Math.random().toString(36).slice(2, 10)
let want = { kind: 'off', vol: 50 }
let bed = null // 正在放的：{ kind, src, gain }
let cache = null // 最後做的那一段（換一種聲音才重做；只留一段，手機上不佔太多記憶體）
let beat = null

// 現在誰在放（沒有、壞掉的是 null）。localStorage 不能用（隱私模式）：分頁之間沒辦法商量，就當成自己放
function ownerOf() {
  let raw
  try {
    raw = localStorage.getItem(NOISE_TAB)
  } catch {
    return { id: tabId, at: Date.now() }
  }
  try {
    const v = JSON.parse(raw || 'null')
    return v && typeof v.id === 'string' && Number.isFinite(v.at) ? v : null
  } catch {
    return null
  }
}
// 太久沒記「還在」（或時間在很後面：時鐘被調過）：當成那個分頁已經不在了
const gone = (o) => !o || Math.abs(Date.now() - o.at) > STALE
const mine = () => ownerOf()?.id === tabId
const claim = () => {
  try {
    localStorage.setItem(NOISE_TAB, JSON.stringify({ id: tabId, at: Date.now() }))
  } catch {}
}
// 想放的時候每 BEAT 看一次：自己放的就記一次「還在」；別人放的那個太久沒記了就接手
function heartbeat() {
  if (want.kind === 'off') {
    clearInterval(beat)
    beat = null
    return
  }
  if (mine()) claim()
  else if (gone(ownerOf())) applyNoise()
}
// 音量 0～100 → 音量的倍數（照聽起來的大小，用平方）
export const noiseLevel = (vol) => Math.min(1, Math.max(0, (Number(vol) || 0) / 100) ** 2)
// 從現在的音量慢慢變過去（正在變的那一段先停在現在的值，不會跳一下）
function glide(param, to, t, tc) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t)
  else {
    const v = param.value
    param.cancelScheduledValues(t)
    param.setValueAtTime(v, t)
  }
  param.setTargetAtTime(to, t, tc)
}
function bufferOf(c, kind) {
  if (cache?.kind === kind && cache.rate === c.sampleRate) return cache.buf
  const n = Math.floor(c.sampleRate * (kind === 'rain' ? 10 : 6))
  const buf = c.createBuffer(2, n, c.sampleRate)
  // 左右聲道各做一段（聽起來比較寬、不會擠在正中間）
  for (let ch = 0; ch < 2; ch++) buf.getChannelData(ch).set(loopNoise(kind, n, c.sampleRate))
  cache = { kind, rate: c.sampleRate, buf }
  return buf
}
function applyNoise() {
  if (want.kind !== 'off' && gone(ownerOf())) claim()
  const kind = want.kind !== 'off' && mine() ? want.kind : 'off'
  if (want.kind !== 'off' && !beat) beat = setInterval(heartbeat, BEAT)
  // 換了一種、或不放了：舊的淡出（0.6 秒左右），淡完再停
  if (bed && bed.kind !== kind) {
    const t = ctx.currentTime
    glide(bed.gain.gain, 0, t, 0.15)
    try {
      bed.src.stop(t + 1.2)
    } catch {}
    bed = null
  }
  if (kind === 'off') return
  const c = ctxOf()
  if (!c) return
  if (!bed) {
    const src = c.createBufferSource()
    src.buffer = bufferOf(c, kind)
    src.loop = true
    const gain = c.createGain()
    gain.gain.value = 0
    src.connect(gain)
    gain.connect(c.destination)
    src.start()
    bed = { kind, src, gain }
  }
  // 慢慢變大聲（開始時淡入 1～2 秒）；只是調音量也照樣滑過去
  glide(bed.gain.gain, noiseLevel(want.vol), c.currentTime, 0.5)
}

export const noise = {
  // kind：'off' 或 NOISE_KINDS 之一（不認得的當成 off）；vol：0～100
  want(kind, vol) {
    want = { kind: GEN[kind] ? kind : 'off', vol: Number(vol) || 0 }
    // 不放了：不用再記「還在」（別的分頁 15 秒後就可以接手）
    if (want.kind === 'off' && beat) {
      clearInterval(beat)
      beat = null
    }
    applyNoise()
  },
  // 測試、除錯用：想放什麼、這個分頁真的在放什麼
  state() {
    return { want: want.kind, vol: want.vol, playing: bed?.kind || 'off', mine: mine() }
  },
}
// 在這個分頁操作了（點、按鍵）：換這個分頁放。音訊還沒解鎖的話也在這時候解鎖
const grab = () => {
  if (want.kind === 'off' || (mine() && bed && ctx?.state !== 'suspended')) return
  claim()
  applyNoise()
}
globalThis.addEventListener?.('pointerdown', grab, true)
globalThis.addEventListener?.('keydown', grab, true)
// 另一個分頁接手了、或放的那個分頁關掉了
globalThis.addEventListener?.('storage', (e) => {
  if (e.key === NOISE_TAB || e.key === null) applyNoise()
})
// 這個分頁關掉、離開（放進上一頁的快取也算）：讓還想放的分頁接手；從快取回來時再看一次
globalThis.addEventListener?.('pagehide', () => {
  if (!mine()) return
  try {
    localStorage.removeItem(NOISE_TAB)
  } catch {}
})
globalThis.addEventListener?.('pageshow', (e) => e.persisted && applyNoise())
