// 跨裝置的計時（store.state.timer）：跟著同步走的那一份怎麼清洗、怎麼存
import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../src/store.js'
import { migrate } from '../src/store/migrate.js'

const load = (timer) => migrate({ tasks: [], player: {}, timer }).timer

describe('跨裝置的計時', () => {
  beforeEach(() => localStorage.clear())

  it('沒開過同步是 null；別台送的每個欄位都檢查過，不認得的欄位不留', () => {
    expect(migrate({ tasks: [], player: {} }).timer).toBe(null)
    expect(load({ mode: 'focus', by: 'abc12345', v: 'k1', endAt: 1e12, paused: null, focusMin: 999, round: 0, rounds: 3, up: 'yes', ext: true, sid: 'a-b', taskId: '<x>', extra: 1 })).toEqual({
      mode: 'focus', by: 'abc12345', v: 'k1', endAt: 1e12, focusMin: 180, round: 1, rounds: 3, up: false, ext: true, small: false, taskId: null, projectId: null, sid: 'a-b',
    })
    // 暫停中：剩下的毫秒數留著
    expect(load({ mode: 'focus', by: 'abc12345', v: 'k1', paused: 90000, endAt: 1 })).toMatchObject({ paused: 90000 })
  })

  it('不知道是哪一台、哪一次的，模式不對的，不收', () => {
    for (const bad of [{ mode: 'run', by: 'abc12345', v: 'k1' }, { mode: 'idle', v: 'k1' }, { mode: 'idle', by: 'ABC 123', v: 'k1' }, { mode: 'idle', by: 'abc12345', v: 'x'.repeat(30) }, 'focus', [1], null]) {
      expect(load(bad)).toBe(null)
    }
  })

  it('存起來算這台改了資料（會同步出去）；同步拉回、重新讀檔都還在', () => {
    const store = new Store()
    let dirty = 0
    store.on('dirty', () => dirty++)
    const rev = store.state.rev
    store.setTimer({ mode: 'focus', by: 'abc12345', v: 'k2', endAt: 1e12, sid: 's1' })
    expect(dirty).toBe(1)
    expect(store.state.rev).not.toBe(rev)
    store.flushSave()
    expect(new Store().state.timer).toMatchObject({ mode: 'focus', by: 'abc12345', v: 'k2', sid: 's1' })
    const copy = JSON.parse(JSON.stringify(store.state))
    store.replaceState(copy, copy.updatedAt, { soft: true, rev: copy.rev })
    expect(store.state.timer).toMatchObject({ v: 'k2' })
  })
})
