// 推播伺服器（worker/src/push.js）用的假 Durable Object：每個名字一個 PushHub，各自的儲存和 alarm
import { PushHub } from '../../worker/src/index.js'

export function fakeEnv(extra = {}) {
  const objs = new Map()
  const env = {
    ...extra,
    PUSH: {
      idFromName: (name) => name,
      get(name) {
        if (!objs.has(name)) {
          const map = new Map()
          const state = {
            alarm: null,
            storage: {
              get: async (k) => map.get(k),
              put: async (k, v) => void map.set(k, v),
              delete: async (k) => map.delete(k),
              deleteAll: async () => map.clear(),
              setAlarm: async (at) => void (state.alarm = at),
              deleteAlarm: async () => void (state.alarm = null),
            },
          }
          objs.set(name, { state, map, hub: new PushHub(state, env) })
        }
        return { fetch: (url, init) => objs.get(name).hub.fetch(new Request(url, init)) }
      },
    },
  }
  // 排著的計時器（不含保管金鑰的那一個）
  const timers = () => [...objs.entries()].filter(([name, o]) => name !== 'vapid' && o.map.has('timer')).map(([, o]) => o)
  return { env, objs, timers }
}
