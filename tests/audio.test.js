import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// 測試環境是 node：沒有 window 的事件和 AudioContext。用 EventTarget 接事件，假的 AudioContext 記下排了什麼
const target = new EventTarget()
globalThis.addEventListener = target.addEventListener.bind(target)
globalThis.removeEventListener = target.removeEventListener.bind(target)
const fire = (type, props = {}) => target.dispatchEvent(Object.assign(new Event(type), props))

class FakeParam {
  constructor(v) {
    this.value = v
    this.target = v
  }
  cancelAndHoldAtTime() {}
  setTargetAtTime(v) {
    this.target = v
  }
}
class FakeNode {
  connect(n) {
    this.out = n
    return n
  }
}
class FakeCtx {
  constructor() {
    this.currentTime = 0
    this.sampleRate = 8000
    this.state = 'running'
    this.destination = new FakeNode()
    this.sources = []
    FakeCtx.last = this
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam(1) })
  }
  createDelay() {
    return Object.assign(new FakeNode(), { delayTime: new FakeParam(0) })
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length))
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (i) => data[i] }
  }
  createBufferSource() {
    const s = Object.assign(new FakeNode(), { start() { s.started = true }, stop(t) { s.stopAt = t } })
    this.sources.push(s)
    return s
  }
}
globalThis.AudioContext = FakeCtx

let audio
beforeAll(async () => {
  audio = await import('../src/audio.js')
})
beforeEach(() => {
  audio.noise.want('off', 50)
  localStorage.clear()
})

// 固定的亂數：同一顆種子每次都一樣
const seeded = (seed = 1) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)
const KEY = 'hiyori-noise-tab'

describe('背景聲的聲音', () => {
  it('三種聲音都做得出來：沒有壞掉的數字、最大不超過 0.98、音量差不多大；同一顆種子做出一樣的', () => {
    expect(audio.NOISE_KINDS).toEqual(['brown', 'pink', 'rain'])
    for (const kind of audio.NOISE_KINDS) {
      const a = audio.loopNoise(kind, 24000, 8000, seeded(7))
      expect(a).toHaveLength(24000)
      expect(a.every(Number.isFinite)).toBe(true)
      expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(0.98 + 1e-6)
      expect(rms(a)).toBeGreaterThan(0.08)
      expect(rms(a)).toBeLessThanOrEqual(0.2 + 1e-6)
      expect(audio.loopNoise(kind, 24000, 8000, seeded(7))).toEqual(a)
    }
  })

  it('頭尾接得起來：循環時從最後一個樣本跳回第一個，不比聲音裡平常相鄰兩個樣本差得多（不會「喀」一聲）', () => {
    // 跳回開頭的那一下，比聲音裡最大的相鄰兩個樣本差還大嗎
    const clicks = (a) => {
      let step = 0
      for (let i = 1; i < a.length; i++) step = Math.max(step, Math.abs(a[i] - a[i - 1]))
      return Math.abs(a[0] - a[a.length - 1]) > step
    }
    for (const kind of audio.NOISE_KINDS) for (let s = 1; s <= 20; s++) expect(clicks(audio.loopNoise(kind, 24000, 8000, seeded(s)))).toBe(false)
    // 沒做交叉淡化的褐噪音（直接把那一段循環）：有些會「喀」——上面的檢查是有意義的
    const raw = (s) => {
      const r = seeded(s)
      let last = 0
      return Array.from({ length: 24000 }, () => (last = (last + 0.02 * (r() * 2 - 1)) / 1.02))
    }
    expect(Array.from({ length: 20 }, (_, i) => clicks(raw(i + 1))).filter(Boolean).length).toBeGreaterThan(3)
  })

  it('音量 0～100 照聽起來的大小換成倍數（平方），超出範圍、壞掉的數字收回來', () => {
    expect(audio.noiseLevel(0)).toBe(0)
    expect(audio.noiseLevel(50)).toBeCloseTo(0.25)
    expect(audio.noiseLevel(100)).toBe(1)
    expect(audio.noiseLevel(140)).toBe(1)
    expect(audio.noiseLevel(-5)).toBe(0)
    expect(audio.noiseLevel('x')).toBe(0)
  })
})

describe('背景聲的播放', () => {
  it('放、調音量（同一段接著放）、換一種（舊的淡出再停）、不放了；不認得的種類當成不放', () => {
    audio.noise.want('rain', 50)
    const ctx = FakeCtx.last
    const first = ctx.sources.at(-1)
    expect(first.started).toBe(true)
    expect(first.loop).toBe(true)
    expect(first.buffer.numberOfChannels).toBe(2)
    // 不經過音效的殘響：直接接到喇叭
    expect(first.out.out).toBe(ctx.destination)
    expect(first.out.gain.target).toBeCloseTo(0.25)
    expect(audio.noise.state()).toEqual({ want: 'rain', vol: 50, playing: 'rain', mine: true })
    audio.noise.want('rain', 80)
    expect(ctx.sources.at(-1)).toBe(first)
    expect(first.out.gain.target).toBeCloseTo(0.64)
    audio.noise.want('brown', 80)
    expect(first.out.gain.target).toBe(0)
    expect(first.stopAt).toBeGreaterThan(ctx.currentTime)
    const second = ctx.sources.at(-1)
    expect(second).not.toBe(first)
    expect(audio.noise.state().playing).toBe('brown')
    audio.noise.want('off', 80)
    expect(second.stopAt).toBeGreaterThan(ctx.currentTime)
    expect(audio.noise.state().playing).toBe('off')
    audio.noise.want('thunder', 80)
    expect(audio.noise.state()).toMatchObject({ want: 'off', playing: 'off' })
  })

  it('同一個瀏覽器開著好幾個分頁：只有一個分頁放。在哪個分頁操作就換哪個放；放的分頁關掉了，還想放的分頁接手', () => {
    const other = () => localStorage.setItem(KEY, JSON.stringify({ id: 'other', at: Date.now() }))
    // 另一個分頁正在放
    other()
    audio.noise.want('pink', 50)
    expect(audio.noise.state()).toMatchObject({ playing: 'off', mine: false })
    // 在這個分頁點了一下：換這邊放
    fire('pointerdown')
    expect(audio.noise.state()).toMatchObject({ playing: 'pink', mine: true })
    const mine = FakeCtx.last.sources.at(-1)
    // 另一個分頁按了鍵盤（換那邊放）：這邊淡出
    other()
    fire('storage', { key: KEY })
    expect(audio.noise.state()).toMatchObject({ playing: 'off', mine: false })
    expect(mine.out.gain.target).toBe(0)
    // 那個分頁關掉了：這邊接手
    localStorage.removeItem(KEY)
    fire('storage', { key: KEY })
    expect(audio.noise.state()).toMatchObject({ playing: 'pink', mine: true })
    // 這個分頁關掉：讓出來給別的分頁
    fire('pagehide')
    expect(localStorage.getItem(KEY)).toBeNull()
    // 不想放的時候點了也不搶
    audio.noise.want('off', 50)
    other()
    const before = localStorage.getItem(KEY)
    fire('keydown')
    expect(localStorage.getItem(KEY)).toBe(before)
    // 記的東西壞掉了：當成沒人放
    localStorage.setItem(KEY, 'garbage')
    audio.noise.want('rain', 50)
    expect(audio.noise.state()).toMatchObject({ playing: 'rain', mine: true })
  })

  it('放的分頁被系統收掉、當掉（沒說要走）：太久沒記「還在」就換這邊放；自己放的每隔一陣子記一次，不會被當成不在', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 10, 16, 9, 0))
      // 早就不在的分頁（重新打開 App 時留下來的）：馬上接手
      localStorage.setItem(KEY, JSON.stringify({ id: 'dead', at: Date.now() - 60000 }))
      audio.noise.want('brown', 50)
      expect(audio.noise.state()).toMatchObject({ playing: 'brown', mine: true })
      // 自己放著：過了好一陣子，記的時間跟著往前，別的分頁看得到「還在」
      vi.advanceTimersByTime(40000)
      expect(Date.now() - JSON.parse(localStorage.getItem(KEY)).at).toBeLessThan(6000)
      // 另一個分頁剛接手，之後就沒消息了（當掉）：15 秒內這邊不搶，之後接手
      localStorage.setItem(KEY, JSON.stringify({ id: 'other', at: Date.now() }))
      fire('storage', { key: KEY })
      expect(audio.noise.state()).toMatchObject({ playing: 'off', mine: false })
      vi.advanceTimersByTime(10000)
      expect(audio.noise.state().playing).toBe('off')
      vi.advanceTimersByTime(10000)
      expect(audio.noise.state()).toMatchObject({ playing: 'brown', mine: true })
      // 不想放了：不再記
      audio.noise.want('off', 50)
      const last = localStorage.getItem(KEY)
      vi.advanceTimersByTime(30000)
      expect(localStorage.getItem(KEY)).toBe(last)
    } finally {
      audio.noise.want('off', 50)
      vi.useRealTimers()
    }
  })
})
