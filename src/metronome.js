// 節拍器：照速度打拍子。用 Web Audio 提前排好接下來一小段的拍點（計時器只負責「該排下一批了」，
// 拍子準不準看的是音訊時鐘，不受畫面忙不忙影響）。一次只有一個在響

const AHEAD = 0.15 // 往後排多久的拍點（秒）
const EVERY = 30 // 多久看一次要不要再排（毫秒）

// 從 next 開始、到 until 之前該響的拍點；回傳拍點和下一拍的時間。落後太多（分頁被放到背景又回來）就從現在重新起拍，不補敲
export function beatsDue(next, now, until, bpm) {
  const step = 60 / bpm
  if (next < now - step) next = now + 0.05
  const times = []
  while (next < until) {
    times.push(next)
    next += step
  }
  return { times, next }
}

let ctx = null
let timer = null
let bpm = 60
let next = 0
let onBeat = null
let pending = []
// 已經排進去、還沒響完的拍點（停的時候要取消）
let live = []

function click(at) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = 1100
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.5, at + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
  osc.connect(gain).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + 0.06)
  live.push({ osc, at })
}

function pump() {
  const now = ctx.currentTime
  const due = beatsDue(next, now, now + AHEAD, bpm)
  next = due.next
  for (const at of due.times) {
    click(at)
    // 畫面上的閃一下：跟聲音同一刻
    if (onBeat) pending.push(setTimeout(() => onBeat?.(), Math.max(0, (at - now) * 1000)))
  }
  if (pending.length > 16) pending = pending.slice(-8)
  live = live.filter((x) => x.at > now - 0.2)
}

const hidden = () => document.hidden && metronome.stop()

export const metronome = {
  get on() {
    return timer != null
  },
  // 要在使用者按下去的那一刻呼叫（瀏覽器才讓它出聲）；回傳有沒有開起來
  start(v, beat = null) {
    this.stop()
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!AC) return false
    try {
      ctx ??= new AC()
      ctx.resume?.()
    } catch {
      return false
    }
    bpm = v
    onBeat = beat
    next = ctx.currentTime + 0.06
    timer = setInterval(pump, EVERY)
    pump()
    // 分頁放到背景時計時器會變慢、拍子會亂：先停
    document.addEventListener('visibilitychange', hidden)
    return true
  },
  set(v) {
    bpm = v
  },
  stop() {
    if (timer == null) return
    clearInterval(timer)
    timer = null
    for (const t of pending) clearTimeout(t)
    pending = []
    onBeat = null
    document.removeEventListener('visibilitychange', hidden)
    for (const x of live) {
      try {
        x.osc.stop()
      } catch {}
    }
    live = []
    this.onStop?.()
  },
  // 停下來時通知（畫面把按鈕換回來）
  onStop: null,
}
