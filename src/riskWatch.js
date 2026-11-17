// 風險變差了才說一次（src/risk.js 算等級）：每台裝置記著每個截止日、每個專案上一次的等級（RISK_KEY）。
// 截止日每次看都比；專案一週看一次（變化比較慢，不用天天念）。
// 同一台開著兩個分頁：每次比之前先重讀存著的，先記下的那個分頁說
import { dueRisks, projectRisks, worse } from './risk.js'
import { weekOf } from './agent.js'

export const RISK_KEY = 'hiyori-risk'
// 算一次要看兩個月的空檔：一分鐘內算過就用那一份
const FRESH = 60000

const blank = () => ({ due: {}, proj: {}, week: '' })
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(RISK_KEY) || 'null')
    if (!v || typeof v !== 'object') return blank()
    const map = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {})
    return { due: map(v.due), proj: map(v.proj), week: typeof v.week === 'string' ? v.week : '' }
  } catch {
    return blank()
  }
}

export function createRiskWatch(store, { now = () => new Date() } = {}) {
  // 存不進 localStorage 時也記得（不會每分鐘說一次）
  let mem = load()
  let cache = null
  let at = 0
  // 現在的風險：{ due: [...], projects: [...] }
  function current(force = false) {
    const n = now()
    if (!force && cache && +n - at < FRESH && cache.today === store.today) return cache
    at = +n
    const today = store.today
    cache = {
      today,
      due: dueRisks({
        tasks: store.state.tasks, eventsOn: (d) => store._busyEvents(d), rhythm: store.state.rhythm, today,
        nowMin: n.getHours() * 60 + n.getMinutes(), ratio: store.estimate()?.ratio || 1,
      }),
      projects: projectRisks({ projects: store.state.projects, tasks: store.state.tasks, today, now: +n }),
    }
    return cache
  }
  // 比上一次差的：{ due: [...], projects: [...] }。現在的等級都記下（變好的也記：之後又變差會再說一次）
  function check() {
    const { due, projects } = current()
    const saved = load()
    // 另一個分頁剛記過的照它的（它已經說過了）
    mem = { due: { ...mem.due, ...saved.due }, proj: { ...mem.proj, ...saved.proj }, week: saved.week || mem.week }
    const out = { due: [], projects: [] }
    const nextDue = {}
    for (const r of due) {
      if (worse(r.level, mem.due[r.date])) out.due.push(r)
      nextDue[r.date] = r.level
    }
    // 過了的、沒有任務了的截止日不留
    mem.due = nextDue
    const wk = weekOf(store.today)
    if (mem.week !== wk) {
      const nextProj = {}
      for (const r of projects) {
        if (worse(r.level, mem.proj[r.id])) out.projects.push(r)
        nextProj[r.id] = r.level
      }
      mem.proj = nextProj
      mem.week = wk
    }
    try {
      localStorage.setItem(RISK_KEY, JSON.stringify({ due: mem.due, proj: mem.proj, week: mem.week }))
    } catch {}
    return out
  }
  return { current, check }
}
