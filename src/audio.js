// 以 WebAudio 即時合成的柔和音效（五聲音階、風鈴、寺院鐘聲），不需任何音檔。
let ctx = null
let master = null
let enabled = true

function ensure() {
  if (!enabled) return null
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
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
addEventListener('pointerdown', () => ensure(), { once: true })

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
