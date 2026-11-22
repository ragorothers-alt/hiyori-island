// 兩台都改過時自動合併（三方合併）。base：上次兩邊同步好的那一份；mine：這台現在的；theirs：雲端（或同步檔）上的。
// 只有一邊改的地方照那一邊；兩邊都改了同一個地方才要決定：
//   累計的數字（經驗值、金平糖、統計、每天的紀錄、花開過幾朵、習慣每天的次數、專案每天的專注分鐘）：兩邊各自加的都算
//     （base + 這邊加的 + 那邊加的）；最高紀錄、連續天數、回神紀錄（兩台會記到同一則，見 store.js 的 keepTallies）取比較大的
//   其他：用比較晚改的那一邊（整份的 updatedAt），記成一處「兩邊都改了」
// 清單（任務、日程、專案、里程碑、筆記…有 id 的）照 id 一筆一筆合：一邊新增的留著；一邊刪掉、另一邊沒動的刪掉；
// 一邊刪掉、另一邊改過的留著（不丟資料，也算一處兩邊都改了）。沒有 id 的清單（星期幾、紀錄過的日子）當成集合：兩邊加的都留、刪的刪掉。
// 一起變的幾個欄位（日程的日期和時段、任務的日期和時段）一起看：兩邊都動了就整組用比較晚改的那一邊，不會拼出 14:00 開始、12:00 結束。
// 合不了的回傳 null（交給使用者選邊）：沒有 base、其中一邊整份換過（匯入、還原備份、重置：tallyGen 不一樣）
import { BOND_POINTS, giftCoins } from './data/bond.js'
import { XP } from './theme.js'
import { dateStr } from './store/util.js'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// 回神紀錄（自動記的，兩台記到同一則時兩邊都會加）、一天只算一次的：取比較大的
const DAY_MAX = new Set(['nudges', 'backs', 'onTask', 'leaves', 'plan', 'review'])
// 只有在其中一邊整組改了才換的欄位（兩邊都改了：整組用比較晚改的那一邊）
const GROUPS = {
  events: [['date', 'start', 'end', 'allDay', 'endDate', 'link']],
  tasks: [['date', 'at', 'dur', 'ongoing']],
  routines: [['start', 'end'], ['repeat', 'startDate']],
  habits: [['days', 'target', 'unit']],
}
// 兩邊都改了就整個用比較晚改的那一邊（不拆開來合）：計時（跨裝置的計時是一整個狀態）
const ATOMIC = new Set(['timer'])
// 最後一次改的時間、哪一天做過：取比較晚的
const LATEST = new Set(['updatedAt', 'editedAt', 'lastActive', 'visit', 'petDay', 'gift', 'weekCard', 'logDay', 'paid', 'morning', 'evening', 'week', 'pullActed', 'mottoActed'])

// 比對用的字串：鍵照字母排（同一筆在兩台的欄位順序可能不一樣），算過的記著（同一個物件不重算，整份只走一遍）
class Canon {
  constructor() {
    this.memo = new WeakMap()
  }
  of(v) {
    if (v === undefined) return '\u0000'
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
    let s = this.memo.get(v)
    if (s !== undefined) return s
    if (Array.isArray(v)) s = `[${v.map((x) => (x === undefined ? 'null' : this.of(x))).join(',')}]`
    else
      s = `{${Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${this.of(v[k])}`)
        .join(',')}}`
    this.memo.set(v, s)
    return s
  }
}

// 那一天整個不見了等於空的那一天（逐筆合，不是「一邊刪、一邊改」整天留下）
const EMPTY = { life: () => ({ items: [], energy: 0 }) }

// 跨午夜的日程存成兩段（同一個 link）：合併前包成一筆（id 是開始那一段的），整組比；合完再拆回來
function collapseLinks(events) {
  if (!Array.isArray(events)) return events
  const groups = new Map()
  for (const e of events) if (isObj(e) && typeof e.link === 'string' && e.link) (groups.get(e.link) || groups.set(e.link, []).get(e.link)).push(e)
  const out = []
  const done = new Set()
  for (const e of events) {
    if (!isObj(e) || !e.link || !groups.has(e.link)) {
      out.push(e)
      continue
    }
    if (done.has(e.link)) continue
    done.add(e.link)
    const pieces = [...groups.get(e.link)].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start).localeCompare(String(b.start)))
    out.push({ id: pieces[0].id, __pieces: pieces })
  }
  return out
}
const expandLinks = (events) => (Array.isArray(events) ? events.flatMap((e) => (isObj(e) && Array.isArray(e.__pieces) ? e.__pieces : [e])) : events)

// 這個位置的數字兩邊都改了要怎麼合：'sum'（兩邊加的都算）、'max'、'or'（位元）、'once'（兩邊變得一樣就只算一次）；null 是一般的
function numRule(p) {
  const n = p.length
  const [a, b, c] = p
  if (a === 'player') {
    if (n === 2 && (b === 'xp' || b === 'coins')) return 'sum'
    if (n === 2 && b === 'streak') return 'max'
    // お守り：跨日時兩台都會各自用掉同一個（兩邊變得一樣就是同一件事）
    if (n === 2 && b === 'charms') return 'once'
    // 最高紀錄、用掉幾個お守り（跨日時兩台各自算的）：取比較大的
    if (n === 3 && b === 'stats') return /^best/.test(c) || c === 'charmsUsed' ? 'max' : 'sum'
    if (n === 3 && b === 'bond' && c === 'pts') return 'sum'
  }
  if (a === 'history' && n === 3) return DAY_MAX.has(c) ? 'max' : c === 'tagMask' ? 'or' : 'sum'
  if (a === 'history' && n === 4 && c === 'pulls') return 'sum'
  if (a === 'dex' && n === 3) return c === 'n' ? 'sum' : null
  if (a === 'habits' && n === 4 && b === '[]' && (c === 'log' || c === 'urges')) return 'sum'
  if (a === 'habits' && n === 3 && b === '[]' && (c === 'ms' || c === 'msPaid')) return 'max'
  if (a === 'projects' && n === 4 && b === '[]' && c === 'focus') return 'sum'
  // 任務上番茄鐘的顆數、實際做了幾分鐘：兩台各做了幾輪都算
  if (a === 'tasks' && n === 3 && b === '[]' && (c === 'pomos' || c === 'spent')) return 'sum'
  return null
}
// 底下有兩邊加的都要算的數字（'sum'）的位置：兩邊變得一模一樣也要往下看（各做了一件同樣經驗值的任務，是兩件）
const SUMS = [
  ['player', 'xp'], ['player', 'coins'], ['player', 'stats', '*'], ['player', 'bond', 'pts'],
  ['history', '*', '*'], ['history', '*', 'pulls', '*'], ['dex', '*', 'n'],
  ['habits', '[]', 'log', '*'], ['habits', '[]', 'urges', '*'], ['projects', '[]', 'focus', '*'],
  ['tasks', '[]', 'pomos'], ['tasks', '[]', 'spent'],
]
const holdsSums = (path) => SUMS.some((r) => r.length > path.length && path.every((x, i) => r[i] === '*' || r[i] === x))

function mergeNum(rule, b, m, t) {
  const base = typeof b === 'number' ? b : 0
  if (rule === 'sum') return m + t - base
  if (rule === 'max') return Math.max(m, t)
  if (rule === 'or') return m | t
  // お守り：兩邊都少了一樣多是跨日時各自用掉同一個（只算一次）；其他（一邊買、兩邊都買）照加減
  if (rule === 'once') return m === t && m < base ? m : m + t - base
  return undefined
}

class Merger {
  constructor(mineNewer) {
    this.mineNewer = mineNewer
    this.clashes = []
    this.canon = new Canon()
    this.raws = new WeakMap()
  }
  // 一樣嗎：先用瀏覽器內建的轉字串比（快；同一個物件只轉一次），對不上的才照鍵排序再比（欄位順序不一樣不算改過）。
  // 很大的（整串任務、整年的紀錄）對不上就當成不一樣：會往下一筆一筆比，結果一樣
  same(a, b) {
    if (a === b) return true
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return this.canon.of(a) === this.canon.of(b)
    const x = this._raw(a)
    const y = this._raw(b)
    if (x === y) return true
    return x.length === y.length && x.length < 200000 && this.canon.of(a) === this.canon.of(b)
  }
  _raw(v) {
    let s = this.raws.get(v)
    if (s === undefined) this.raws.set(v, (s = JSON.stringify(v)))
    return s
  }
  clash(path) {
    if (this.clashes.length < 50) this.clashes.push(path.filter((x) => x !== '[]').join('.'))
  }
  pick(m, t) {
    return this.mineNewer ? m : t
  }
  // b 是 undefined：兩邊都新增了同一個（同一個 id、同一天的紀錄）
  merge(b, m, t, path) {
    const last = path[path.length - 1]
    const same = (x, y) => this.same(x, y)
    if (typeof m === 'number' && typeof t === 'number') {
      const rule = numRule(path)
      if (rule) {
        if (same(b, m)) return t
        if (same(b, t)) return m
        return mergeNum(rule, b, m, t)
      }
    }
    const box = (Array.isArray(m) && Array.isArray(t)) || (isObj(m) && isObj(t))
    if (same(m, t) && !(box && holdsSums(path))) return m
    if (b !== undefined && same(b, m)) return t
    if (b !== undefined && same(b, t)) return m
    // 兩邊都改了
    // 跨午夜的那一組（collapseLinks 包起來的）：整組用比較晚改的那一邊（不拆開來合，不會只剩半段、多一段）
    if ((isObj(m) && m.__pieces) || (isObj(t) && t.__pieces)) {
      this.clash(path)
      return this.pick(m, t)
    }
    if (path.length === 1 && ATOMIC.has(last)) {
      this.clash(path)
      return this.pick(m, t)
    }
    if (Array.isArray(m) && Array.isArray(t)) return this.list(Array.isArray(b) ? b : [], m, t, path)
    if (isObj(m) && isObj(t)) return this.obj(isObj(b) ? b : {}, m, t, path)
    if (LATEST.has(last)) {
      if (typeof m === 'number' && typeof t === 'number') return Math.max(m, t)
      if (typeof m === 'string' && typeof t === 'string' && DATE_RE.test(m) && DATE_RE.test(t)) return m > t ? m : t
    }
    this.clash(path)
    return this.pick(m, t)
  }
  obj(b, m, t, path) {
    const out = {}
    // 一起變的那幾組：兩邊都動了就整組照比較晚改的那一邊
    const fixed = new Set()
    const groups = path.length === 2 && path[1] === '[]' ? GROUPS[path[0]] : null
    for (const g of groups || []) {
      const moved = (x) => g.some((k) => !this.same(b[k], x[k]))
      if (!moved(m) || !moved(t) || g.every((k) => this.same(m[k], t[k]))) continue
      this.clash([...path, g[0]])
      const src = this.pick(m, t)
      for (const k of g) {
        fixed.add(k)
        if (k in src) out[k] = src[k]
      }
    }
    for (const k of new Set([...Object.keys(m), ...Object.keys(t)])) {
      if (fixed.has(k)) continue
      const inM = k in m
      const inT = k in t
      const inB = k in b
      if (inM && inT) out[k] = this.merge(inB ? b[k] : undefined, m[k], t[k], [...path, k])
      else if (inB && numRule([...path, k]) === 'sum' && typeof b[k] === 'number' && typeof (inM ? m[k] : t[k]) === 'number') {
        // 計數的鍵不見了是那一邊減到 0（習慣某天的次數撤到 0 就拿掉）：當成 0 照加減
        const v = mergeNum('sum', b[k], inM ? m[k] : 0, inT ? t[k] : 0)
        if (v > 0) out[k] = v
      } else if (inB && EMPTY[path.join('.')] && isObj(inM ? m[k] : t[k])) {
        // 那一天的紀錄整個不見了是那一邊刪光了（生活記錄刪掉最後一則）：當成空的那一天逐筆比，另一邊新增的留著、刪掉的不會復活
        const empty = EMPTY[path.join('.')]()
        out[k] = this.merge(b[k], inM ? m[k] : empty, inT ? t[k] : empty, [...path, k])
      } else {
        // 只有一邊有：另一邊刪掉了（base 裡有）或這一邊新增的（base 裡沒有）
        const v = inM ? m[k] : t[k]
        if (!inB) out[k] = v
        else if (!this.same(b[k], v)) {
          // 一邊刪掉、另一邊改過：留著改過的
          this.clash([...path, k])
          out[k] = v
        }
      }
    }
    return out
  }
  list(b, m, t, path) {
    const key = (x) => (isObj(x) && typeof x.id === 'string' && x.id ? `i:${x.id}` : `j:${this.canon.of(x)}`)
    const index = (arr) => {
      const map = new Map()
      for (const x of arr) if (!map.has(key(x))) map.set(key(x), x)
      return map
    }
    const B = index(b)
    const M = index(m)
    const T = index(t)
    const sub = [...path, '[]']
    // 只有一邊有的那一筆要不要留：那一邊新增的留；另一邊刪掉了，這一邊沒動過的不留，改過的留著
    const keep = (k, inBase, v) => {
      if (!inBase) return true
      if (this.same(B.get(k), v)) return false
      this.clash(sub)
      return true
    }
    // 照這台的順序；雲端那邊新增的，插在雲端那邊排在它前面、結果裡也有的那一筆後面（雲端最前面的就放最前面）
    const res = []
    for (const [k, mv] of M) {
      if (T.has(k)) res.push([k, this.merge(B.has(k) ? B.get(k) : undefined, mv, T.get(k), sub)])
      else if (keep(k, B.has(k), mv)) res.push([k, mv])
    }
    const has = new Set(res.map(([k]) => k))
    let anchor = null
    for (const [k, tv] of T) {
      if (has.has(k)) {
        anchor = k
        continue
      }
      if (M.has(k) || !keep(k, B.has(k), tv)) continue
      const i = anchor === null ? 0 : res.findIndex(([x]) => x === anchor) + 1
      res.splice(i, 0, [k, tv])
      has.add(k)
      anchor = k
    }
    return res.map(([, v]) => v)
  }
}

// 兩台各自做了同一件事、各給了一次獎勵（經驗值、金平糖、統計、每天的紀錄都加了兩次）：扣回一份。認得出來的：
//   跨日時各自做的：每天第一次打開的好感度、もち送的金平糖、戒除里程碑（見 store.js 的 _visit、_quitMilestones）
//   一天只給一次的：習慣打卡的獎勵（paidDays 同一天）、本命全清、全部做完、習慣全做完（那天的記號兩邊都從沒有變成有）
//   同一件任務兩台都打勾了（兩邊都給過獎勵；完成時記下的 xpGot 是拿了多少）
function dedupeDaily(base, mine, theirs, out) {
  const both = (f) => {
    const m = f(mine)
    return m !== undefined && m !== false && m === f(theirs) && m !== f(base)
  }
  const p = out.player
  if (!isObj(p)) return
  const stats = isObj(p.stats) ? p.stats : {}
  const less = (o, k, n) => isObj(o) && typeof o[k] === 'number' && (o[k] = Math.max(0, o[k] - n))
  const day = (d) => (isObj(out.history) && isObj(out.history[d]) ? out.history[d] : null)
  // 扣回一份經驗值（和跟著給的金平糖、那一天記的經驗值）
  const gain = (xp, d = null) => {
    less(p, 'xp', xp)
    less(p, 'coins', Math.max(1, Math.round(xp / 5)))
    if (d) less(day(d), 'xp', xp)
  }
  const find = (s, list, id) => (Array.isArray(s?.[list]) ? s[list].find((x) => x?.id === id) : undefined)
  if (both((s) => s.player?.bond?.visit)) less(p.bond, 'pts', BOND_POINTS.visit)
  if (both((s) => s.player?.bond?.gift)) less(p, 'coins', giftCoins(mine.player.bond.gift))
  for (const h of Array.isArray(out.habits) ? out.habits : []) {
    if (both((s) => find(s, 'habits', h?.id)?.msPaid)) gain(XP.quitMilestone)
    const paid = (s) => new Set(find(s, 'habits', h?.id)?.paidDays || [])
    const [pb, pm, pt] = [paid(base), paid(mine), paid(theirs)]
    for (const d of pm) {
      if (!pt.has(d) || pb.has(d)) continue
      gain(XP.habit, d)
      less(stats, 'habitChecks', 1)
      less(day(d), 'habits', 1)
    }
  }
  for (const d of Object.keys(isObj(out.history) ? out.history : {})) {
    const flag = (k) => both((s) => s.history?.[d]?.[k] === true || undefined)
    if (flag('starAll')) {
      gain(XP.starAll, d)
      less(stats, 'starDays', 1)
      less(p.bond, 'pts', BOND_POINTS.starAll)
    }
    if (flag('perfect')) {
      gain(XP.perfectDay, d)
      less(stats, 'perfectDays', 1)
    }
    if (flag('habitAll')) {
      gain(XP.habitAll, d)
      less(p.bond, 'pts', BOND_POINTS.habitAll)
    }
  }
  for (const t of Array.isArray(out.tasks) ? out.tasks : []) {
    const [tb, tm, tt] = [find(base, 'tasks', t?.id), find(mine, 'tasks', t?.id), find(theirs, 'tasks', t?.id)]
    if (!tm?.rewarded || !tt?.rewarded || tb?.rewarded || !Number.isFinite(tm.xpGot) || !Number.isFinite(tm.doneAt)) continue
    const xp = tm.xpGot
    const h = new Date(tm.doneAt).getHours()
    const d = day(dateStr(new Date(tm.doneAt)))
    gain(xp)
    less(d, 'xp', xp)
    less(stats, 'tasksDone', 1)
    if (tm.priority === 3) less(stats, 'highTasksDone', 1)
    if (tm.star) less(stats, 'starsDone', 1)
    if (h < 9) less(stats, 'earlyTasks', 1)
    if (h >= 22) less(stats, 'nightTasks', 1)
    less(d, 'tasks', 1)
    if (tm.priority === 3) less(d, 'high', 1)
    if (h < 12) less(d, 'early', 1)
    if (tm.star) less(d, 'stars', 1)
    if (tm.routineId) less(d, 'routines', 1)
    // 花の図鑑：同一朵花記了兩次（各自開的花不一樣的話，兩朵都留著）
    if (tm.flower && tm.flower === tt.flower && isObj(out.dex?.[tm.flower]) && out.dex[tm.flower].n > 1) out.dex[tm.flower].n--
  }
  // 同一輪番茄鐘兩台都記了（跨裝置的計時同時到點、兩台都開著）：照那一輪記下的（pomoGot）扣回一份
  const sids = (s) => new Set(Array.isArray(s?.pomoSids) ? s.pomoSids : [])
  const [sb, st] = [sids(base), sids(theirs)]
  for (const id of sids(mine)) {
    const g = mine.pomoGot?.[id]
    if (!st.has(id) || sb.has(id) || !isObj(g) || !isObj(theirs.pomoGot?.[id])) continue
    const m = Number(g.m) || 0
    const d = g.d ? day(g.d) : null
    gain(Number(g.xp) || 0, g.d || null)
    less(stats, 'focusMinutes', m)
    less(d, 'focus', m)
    if (g.s) less(d, g.s, m)
    if (!g.x) {
      less(stats, 'pomodoros', 1)
      less(d, 'pomodoros', 1)
      less(p.bond, 'pts', BOND_POINTS.pomodoro)
    }
    const task = g.t && Array.isArray(out.tasks) ? out.tasks.find((x) => x?.id === g.t) : null
    if (task) {
      if (!g.x) less(task, 'pomos', 1)
      less(task, 'spent', Math.round(m))
    }
    const proj = g.p && Array.isArray(out.projects) ? out.projects.find((x) => x?.id === g.p) : null
    if (proj && m && g.d) less(proj.focus, g.d, Math.round(m))
  }
}

// 回傳 { state, clashes }（clashes：兩邊都改了、用了比較晚改的那一邊的位置，最多 50 個）；合不了的回傳 null
export function merge3(base, mine, theirs) {
  if (!isObj(base) || !isObj(mine) || !isObj(theirs)) return null
  const gen = (s) => s.tallyGen || ''
  if (gen(mine) !== gen(base) || gen(theirs) !== gen(base)) return null
  const m = new Merger((mine.updatedAt || 0) >= (theirs.updatedAt || 0))
  const wrap = (x) => (Array.isArray(x.events) ? { ...x, events: collapseLinks(x.events) } : x)
  const state = m.obj(wrap(base), wrap(mine), wrap(theirs), [])
  state.events = expandLinks(state.events)
  dedupeDaily(base, mine, theirs, state)
  state.updatedAt = Math.max(mine.updatedAt || 0, theirs.updatedAt || 0)
  // 合好的這一份包含兩邊的這一版（和它們之前的）：之後同步看得出來，不會再合一次
  const lin = (x) => (Array.isArray(x.lineage) ? x.lineage : [])
  state.lineage = [...new Set([...lin(theirs), theirs.rev, ...lin(mine), mine.rev].filter((x) => typeof x === 'string' && x))].slice(-64)
  delete state.rev
  return { state, clashes: m.clashes }
}
