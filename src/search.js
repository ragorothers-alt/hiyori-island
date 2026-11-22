// 找找看：任務（哪一天的都找，含子任務、說明）、日程（含備註）、專案（名稱、里程碑、筆記…，見 projectSearch.js）、
// 生活記錄（記下的那一句）。純函式，介面在 src/ui/search.js。
// 空白隔開的幾個字都要在同一筆裡找得到；不分大小寫和全形半形
import { fold, queryTerms, searchProjects, snippet } from './projectSearch.js'

// 每一類最多列幾筆（再多就要再打幾個字縮小）
export const LIMIT = { task: 30, event: 20, project: 10, life: 20 }

// 一筆裡的幾個欄位（[哪裡, 文字, 分數]）都找過：每個字都要在其中一欄找得到；回傳 { score, hit }，沒找到是 null。
// hit：不是在標題找到的（子任務、說明、備註）就截出那一段給人看
function match(fields, terms) {
  const folded = fields.filter(([, text]) => text).map(([kind, text, w]) => ({ kind, text, f: fold(text), w }))
  let score = 0
  let hit = null
  for (const term of terms) {
    let best = null
    for (const x of folded) if (x.f.includes(term) && (!best || x.w > best.w)) best = x
    if (!best) return null
    score += best.w + (best.f.startsWith(term) ? 5 : 0)
    if (best.w < 100 && !hit) hit = { kind: best.kind, text: snippet(best.text, terms) }
  }
  // 標題整個就是打的字：排最前面
  if (folded[0] && folded[0].w === 100 && folded[0].f === terms.join(' ')) score += 50
  return { score, hit }
}

// 離今天多近：還沒做的、今天和接下來的在前（越近越前），過去的照新到舊
const near = (date, today) => (date >= today ? Date.parse(date) - Date.parse(today) : 4e12 + (Date.parse(today) - Date.parse(date)))

// state：store.state；today：今天。回傳 { task: [...], event: [...], project: [...], life: [...], total }；沒打字是 null
export function searchAll(state, query, { today, external = [] } = {}) {
  const terms = queryTerms(query)
  if (!terms.length) return null
  const out = { task: [], event: [], project: [], life: [], total: 0 }

  for (const t of state.tasks || []) {
    const m = match([['名稱', t.title, 100], ...(t.subs || []).map((s) => ['子任務', s.title, 40]), ['說明', t.note, 20]], terms)
    if (m) out.task.push({ kind: 'task', item: t, ...m })
  }
  // 還沒做的在前；同樣的照分數、再照日期（逾期的也算還沒做，排在今天前面）；做完的照完成的時間新到舊
  out.task.sort((a, b) => {
    const x = a.item
    const y = b.item
    if (x.done !== y.done) return x.done ? 1 : -1
    if (x.done) return b.score - a.score || (y.doneAt || 0) - (x.doneAt || 0)
    return b.score - a.score || (x.ongoing ? 1 : 0) - (y.ongoing ? 1 : 0) || String(x.date).localeCompare(String(y.date))
  })

  // 跨過午夜存成兩段的日程只列第一段；匯入的行事曆（唯讀）也找
  const seen = new Set()
  for (const e of [...(state.events || []), ...external]) {
    if (e.link) {
      if (seen.has(e.link)) continue
      seen.add(e.link)
    }
    const m = match([['名稱', e.title, 100], ['備註', e.note, 20]], terms)
    if (m) out.event.push({ kind: 'event', item: e, ...m })
  }
  out.event.sort((a, b) => b.score - a.score || near(a.item.date, today) - near(b.item.date, today) || String(a.item.start).localeCompare(String(b.item.start)))

  for (const r of searchProjects(state.projects || [], query) || []) out.project.push({ kind: 'project', item: r.p, score: r.score, hit: r.hit })

  for (const [date, day] of Object.entries(state.life || {})) {
    for (const x of day?.items || []) {
      const m = match([['生活記錄', x.text, 100]], terms)
      if (m) out.life.push({ kind: 'life', item: x, date, ...m })
    }
  }
  out.life.sort((a, b) => b.date.localeCompare(a.date) || String(b.item.t || '').localeCompare(String(a.item.t || '')))

  for (const k of Object.keys(LIMIT)) {
    out.total += out[k].length
    out[k] = out[k].slice(0, LIMIT[k])
  }
  return out
}
