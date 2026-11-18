// Android 殼的即時倒數通知：計時的狀態 → 通知上的樣子（src/native.js）
import { describe, expect, it } from 'vitest'
import { liveTimer, native, nativeFujiClaim, nativeFujiNotes, sendFujiNotes } from '../src/native.js'

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

  it('會自動延長的這一輪：從開始的時間往上數（到點那一刻不跳、不響），鬧鐘排在延長做滿的時間；舊版的殼也排得到（沒有 at）', () => {
    const START = AT - 25 * 60000
    const FLOW_AT = AT + 30 * 60000
    const p = liveTimer({ ...base, flow: 30, start: START, flowAt: FLOW_AT, target: '寫報告' }, done)
    expect(p).toEqual({ since: START, doneAt: FLOW_AT, title: '專注中 · 寫報告', text: '17:25 到點後自動延長・最晚 17:55', done: { title: done.title, body: done.body } })
    expect(p.at).toBeUndefined()
    expect(liveTimer({ ...base, flow: 30, start: START, flowAt: FLOW_AT, round: 1, rounds: 2 }, done).text).toBe('17:25 到點後自動延長・最晚 17:55・第 1/2 輪')
    // 到點後：同一個起點接著往上數（數字不跳），一樣在延長做滿時響
    const ext = liveTimer({ ...base, counting: true, ext: true, flow: 30, since: AT, at: FLOW_AT, start: START, flowAt: FLOW_AT }, done)
    expect(ext).toEqual({ since: START, doneAt: FLOW_AT, title: '自動延長中', text: '告一段落回到 App 按「做完了」・最晚 17:55', done: { title: done.title, body: done.body } })
    // 自己按的延長
    expect(liveTimer({ ...base, counting: true, ext: true, since: AT, at: AT + 180 * 60000 }).title).toBe('加時中')
  })

  it('暫停中：不倒數、不排到點，寫還剩多久', () => {
    const p = liveTimer({ ...base, paused: true, at: null, leftMs: 12 * 60000 + 5000, target: '寫報告' }, null)
    expect(p).toEqual({ title: '暫停中 · 寫報告', text: '還剩 12:05，回到 App 繼續', chip: '暫停' })
    expect(liveTimer({ ...base, paused: true, counting: true, at: null, leftMs: 65000 }).text).toBe('已經 1:05，回到 App 繼續')
  })
})

describe('ふじ在 App 關著時的通知交給手機', () => {
  it('舊版的殼沒有 fujiNotes：不送；新版只送 at／title／body，內容沒變不重送，空的是取消', () => {
    expect(nativeFujiNotes({})).toBe(false)
    expect(sendFujiNotes([{ at: 1, title: 'a', body: 'b' }], {})).toBe(false)
    const got = []
    const bridge = { fujiNotes: (j) => got.push(j) }
    const items = [{ at: AT, title: 'ふじ · 今天的安排', body: '今天 1 件事', kind: 'morning', fuji: true }]
    expect(sendFujiNotes(items, bridge)).toBe(true)
    expect(sendFujiNotes([...items], bridge)).toBe(true)
    expect(got).toEqual([JSON.stringify({ items: [{ at: AT, title: 'ふじ · 今天的安排', body: '今天 1 件事' }] })])
    sendFujiNotes([], bridge)
    expect(got.at(-1)).toBe('')
  })

  it('網頁要自己說其中一則：問手機發過了沒（傳字串）；舊版的殼沒排ふじ的通知、出錯時都由網頁說', () => {
    const asked = []
    expect(nativeFujiClaim(AT, { fujiClaim: (at) => asked.push(at) && true })).toBe(true)
    expect(asked).toEqual([String(AT)])
    expect(nativeFujiClaim(AT, { fujiClaim: () => false })).toBe(false)
    expect(nativeFujiClaim(AT, {})).toBe(true)
    expect(nativeFujiClaim(AT, { fujiClaim: () => { throw new Error('x') } })).toBe(true)
  })
})
