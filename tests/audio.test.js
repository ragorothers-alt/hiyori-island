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
class FakeCtx extends EventTarget {
  constructor() {
    super()
    this.currentTime = 0
    this.sampleRate = 8000
    this.state = 'running'
    this.resumes = 0
    this.destination = new FakeNode()
    this.sources = []
    FakeCtx.last = this
  }
  // 解鎖：被允許的話過一下下才變成 running（跟瀏覽器一樣不是馬上）。
  // FakeCtx.locked：還不被允許（沒點過、不准自動播放），叫了也一樣停著
  resume() {
    this.resumes++
    if (!FakeCtx.locked) queueMicrotask(() => this.to('running'))
    return Promise.resolve()
  }
  // 狀態變了（解鎖了、iOS 切走時被打斷、回來了）：跟瀏覽器一樣發 statechange
  to(state) {
    if (this.state === state) return
    this.state = state
    this.dispatchEvent(new Event('statechange'))
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
  FakeCtx.locked = false
  // 整個頁面只有一個音訊：上一個測試改過的狀態放回來（不發事件）
  if (FakeCtx.last) FakeCtx.last.state = 'running'
})

// 固定的亂數：同一顆種子每次都一樣
const seeded = (seed = 1) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)
const KEY = 'hiyori-noise-tab'
// 音訊（整個頁面只有一個，第一次要放時才建）：單獨跑某一個測試時先建好
const ctxNow = () => {
  if (!FakeCtx.last) {
    audio.noise.want('brown', 50)
    audio.noise.want('off', 50)
    localStorage.clear()
  }
  return FakeCtx.last
}
// 等解鎖（排在後面的 microtask）跑完
const settle = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve()
}

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
      // 不想放了：不再記，也馬上讓出來
      audio.noise.want('off', 50)
      expect(localStorage.getItem(KEY)).toBeNull()
      localStorage.setItem(KEY, JSON.stringify({ id: 'other', at: Date.now() }))
      const last = localStorage.getItem(KEY)
      vi.advanceTimersByTime(30000)
      expect(localStorage.getItem(KEY)).toBe(last)
    } finally {
      audio.noise.want('off', 50)
      vi.useRealTimers()
    }
  })

  it('不放了：是自己在放的馬上讓出來（還想放的分頁不用等 15 秒）；別的分頁在放的不動它', () => {
    audio.noise.want('brown', 50)
    expect(JSON.parse(localStorage.getItem(KEY))).toMatchObject({ at: expect.any(Number) })
    audio.noise.want('off', 50)
    expect(localStorage.getItem(KEY)).toBeNull()
    // 別的分頁在放：這邊想放又不放了，也不會把它的記號拿掉
    localStorage.setItem(KEY, JSON.stringify({ id: 'other', at: Date.now() }))
    audio.noise.want('pink', 50)
    expect(audio.noise.state()).toMatchObject({ playing: 'off', mine: false })
    audio.noise.want('off', 50)
    fire('pagehide')
    expect(JSON.parse(localStorage.getItem(KEY)).id).toBe('other')
  })

  it('還沒解鎖的分頁（沒點過、不准自動播放）：沒人在放也先不搶（放不出聲音）；解鎖了（Android 的 App 允許自動播放）或在這個分頁點一下才接手', async () => {
    const ctx = ctxNow()
    FakeCtx.locked = true
    ctx.state = 'suspended'
    audio.noise.want('pink', 50)
    expect(audio.noise.state()).toMatchObject({ playing: 'off', mine: false })
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(ctx.resumes).toBeGreaterThan(0)
    // 允許自動播放：解鎖了就接手
    FakeCtx.locked = false
    ctx.to('running')
    expect(audio.noise.state()).toMatchObject({ playing: 'pink', mine: true })
    // 不准自動播放的：等使用者在這個分頁按一下（按的時候才解鎖得了）
    audio.noise.want('off', 50)
    FakeCtx.locked = true
    ctx.state = 'suspended'
    audio.noise.want('brown', 50)
    expect(audio.noise.state()).toMatchObject({ playing: 'off', mine: false })
    FakeCtx.locked = false
    fire('keydown')
    expect(audio.noise.state()).toMatchObject({ playing: 'brown', mine: true })
    await settle()
    expect(ctx.state).toBe('running')
  })

  it('音訊被系統打斷（iOS 切走時的 interrupted）：還記著在放；回來點一下就恢復、接著放', async () => {
    const ctx = ctxNow()
    audio.noise.want('rain', 50)
    const bed = ctx.sources.at(-1)
    FakeCtx.locked = true
    ctx.to('interrupted')
    expect(audio.noise.state()).toMatchObject({ playing: 'rain', mine: true })
    const n = ctx.resumes
    FakeCtx.locked = false
    fire('pointerdown')
    expect(ctx.resumes).toBeGreaterThan(n)
    await settle()
    expect(ctx.state).toBe('running')
    // 同一段接著放，不重新開始
    expect(audio.noise.state()).toMatchObject({ playing: 'rain', mine: true })
    expect(ctx.sources.at(-1)).toBe(bed)
    expect(bed.stopAt).toBeUndefined()
  })

  it('自己在放、音訊卻停了（被打斷、還沒恢復）：不再記「還在」，讓放得出聲音的分頁接手；恢復了再接著記', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 10, 16, 9, 0))
      const ctx = ctxNow()
      audio.noise.want('rain', 50)
      const at = JSON.parse(localStorage.getItem(KEY)).at
      FakeCtx.locked = true
      ctx.to('interrupted')
      vi.advanceTimersByTime(20000)
      expect(JSON.parse(localStorage.getItem(KEY)).at).toBe(at)
      // 恢復了：馬上再記一次，之後照常
      FakeCtx.locked = false
      ctx.to('running')
      expect(Date.now() - JSON.parse(localStorage.getItem(KEY)).at).toBeLessThan(1000)
      vi.advanceTimersByTime(12000)
      expect(Date.now() - JSON.parse(localStorage.getItem(KEY)).at).toBeLessThan(6000)
    } finally {
      audio.noise.want('off', 50)
      vi.useRealTimers()
    }
  })

  it('localStorage 讀不到、寫不進去（隱私模式、空間滿了）：沒辦法跟別的分頁商量，就自己放；之後寫得進去了照常商量', () => {
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      audio.noise.want('brown', 50)
      expect(audio.noise.state()).toMatchObject({ playing: 'brown', mine: true })
      audio.noise.want('off', 50)
      expect(audio.noise.state()).toMatchObject({ playing: 'off' })
    } finally {
      delete localStorage.setItem
    }
    localStorage.getItem = () => {
      throw new Error('SecurityError')
    }
    try {
      audio.noise.want('rain', 50)
      expect(audio.noise.state()).toMatchObject({ playing: 'rain', mine: true })
      audio.noise.want('off', 50)
    } finally {
      delete localStorage.getItem
    }
    // 都好了：別的分頁在放就不搶（寫不進去時的「自己放」不會一直留著）
    localStorage.setItem(KEY, JSON.stringify({ id: 'other', at: Date.now() }))
    audio.noise.want('pink', 50)
    expect(audio.noise.state()).toMatchObject({ playing: 'off', mine: false })
  })
})
