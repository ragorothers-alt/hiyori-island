// Android 殼的即時倒數通知：計時的狀態 → 通知上的樣子（src/native.js）
import { describe, expect, it } from 'vitest'
import { liveTimer, native } from '../src/native.js'

const AT = new Date(2026, 10, 10, 17, 25).getTime()
const done = { at: AT, title: 'ひより · 專注結束', body: '25 分鐘完成，休息一下吧' }
const base = { mode: 'focus', paused: false, counting: false, at: AT, since: null, leftMs: 25 * 60000, round: 1, rounds: 1, target: '' }

describe('Android 殼的即時倒數', () => {
  it('不在殼裡：native 是 null；沒在計時沒有通知', () => {
    expect(native).toBeNull()
    expect(liveTimer(null)).toBeNull()
  })

  it('專注中：倒數到結束的時間，到點時發「專注結束」', () => {
    expect(liveTimer(base, done)).toEqual({ at: AT, title: '專注中', text: '17:25 結束', done: { title: done.title, body: done.body } })
    expect(liveTimer({ ...base, target: '蕭邦練習曲 Op.10 No.4', round: 2, rounds: 3 }, done)).toMatchObject({ title: '專注中 · 蕭邦練習曲 Op.10 No.4', text: '17:25 結束・第 2/3 輪' })
    expect(liveTimer({ ...base, target: '一個名字很長很長很長很長很長很長的任務' }).title).toBe('專注中 · 一個名字很長很長很長很長很長很長的…')
    expect(liveTimer(base).done).toBeNull()
  })

  it('休息中：寫接下來第幾輪', () => {
    expect(liveTimer({ ...base, mode: 'break' }, done)).toMatchObject({ at: AT, title: '休息中', text: '17:25 結束' })
    expect(liveTimer({ ...base, mode: 'break', round: 1, rounds: 3 }).text).toBe('17:25 結束・接著第 2/3 輪')
    expect(liveTimer({ ...base, mode: 'break', round: 3, rounds: 3 }).text).toBe('17:25 結束')
  })

  it('正向計時：從開始的時間往上數，滿 3 小時那一刻才到點', () => {
    const p = liveTimer({ ...base, counting: true, since: AT - 600000, at: AT + 170 * 60000, target: '寫報告' }, done)
    expect(p).toMatchObject({ since: AT - 600000, doneAt: AT + 170 * 60000, title: '正向計時中 · 寫報告' })
    expect(p.at).toBeUndefined()
  })

  it('暫停中：不倒數、不排到點，寫還剩多久', () => {
    const p = liveTimer({ ...base, paused: true, at: null, leftMs: 12 * 60000 + 5000, target: '寫報告' }, null)
    expect(p).toEqual({ title: '暫停中 · 寫報告', text: '還剩 12:05，回到 App 繼續', chip: '暫停' })
    expect(liveTimer({ ...base, paused: true, counting: true, at: null, leftMs: 65000 }).text).toBe('已經 1:05，回到 App 繼續')
  })
})
