// 訂閱服務：扣款日怎麼算、換算成每月多少、到目前大約付了多少、這個月還要付多少（純函式，store 和介面共用，不碰 DOM）。
//
// 一個訂閱：{ id, name, price, cur, every, unit, start, trial, cat, remind, pay, url, note, status, end, paid0, createdAt }
//   start：第一次扣款的日子（免費試用的話就是試用結束、開始收費那天）；之後每 every 個 unit（週／月／年）扣一次。
//     月、年照開始那天的日期扣，那個月沒有那一天（31 號、2/29）就在月底扣
//   status：active（訂閱中）| cancelled（取消了）。取消了的 end 是「不再扣款」的那一天：end 之前的扣款照算
//   paid0：重新訂閱以前那一段已經付過的金額（跟 price 同一種幣別）
//   remind：扣款前幾天提醒（0＝當天、-1＝不提醒）

export const SUB_UNITS = {
  week: { label: '週', per: '週' },
  month: { label: '個月', per: '月' },
  year: { label: '年', per: '年' },
}

// 匯率是「1 單位外幣大約多少新台幣」，只用來換算合計；預設值是大概的數字，設定裡可以自己改
export const CURRENCIES = {
  TWD: { sign: 'NT$', label: '新台幣', rate: 1, digits: 0 },
  USD: { sign: 'US$', label: '美元', rate: 31, digits: 2 },
  JPY: { sign: '¥', label: '日圓', rate: 0.21, digits: 0 },
  EUR: { sign: '€', label: '歐元', rate: 34, digits: 2 },
  HKD: { sign: 'HK$', label: '港幣', rate: 4, digits: 2 },
  CNY: { sign: 'CN¥', label: '人民幣', rate: 4.3, digits: 2 },
  GBP: { sign: '£', label: '英鎊', rate: 40, digits: 2 },
}

export const SUB_CATS = {
  video: { label: '影音', kanji: '映', color: '#f3a0b8' },
  music: { label: '音樂', kanji: '音', color: '#b9a7e6' },
  ai: { label: 'AI・工具', kanji: '具', color: '#8ec5e8' },
  cloud: { label: '雲端', kanji: '雲', color: '#93d4c4' },
  game: { label: '遊戲', kanji: '遊', color: '#f1c97c' },
  read: { label: '閱讀・學習', kanji: '讀', color: '#d4b48c' },
  life: { label: '生活', kanji: '生', color: '#9fd6a8' },
  other: { label: '其他', kanji: '他', color: '#b8bfcc' },
}

export const REMIND_DAYS = [0, 1, 3, 7]

// ── 日期（YYYY-MM-DD，本地時間）──
const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parts = (date) => date.split('-').map(Number)
const plusDays = (date, n) => {
  const [y, m, d] = parts(date)
  return fmt(new Date(y, m - 1, d + n))
}
const between = (a, b) => {
  const [y1, m1, d1] = parts(a)
  const [y2, m2, d2] = parts(b)
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000)
}

// 第 k 次扣款（k 從 0 開始）的日子
export function chargeAt(sub, k) {
  const [y, m, d] = parts(sub.start)
  if (sub.unit === 'week') return fmt(new Date(y, m - 1, d + 7 * sub.every * k))
  const total = m - 1 + (sub.unit === 'year' ? 12 : 1) * sub.every * k
  const yy = y + Math.floor(total / 12)
  const mm = total % 12
  const last = new Date(yy, mm + 1, 0).getDate()
  return fmt(new Date(yy, mm, Math.min(d, last)))
}

// 第一個在 date 當天或之後的扣款是第幾次（先用平均天數估，再往後找）
function indexFrom(sub, date) {
  if (date <= sub.start) return 0
  const per = (sub.unit === 'week' ? 7 : sub.unit === 'month' ? 30.44 : 365.25) * sub.every
  let k = Math.max(0, Math.floor(between(sub.start, date) / per) - 1)
  while (chargeAt(sub, k) < date) k++
  return k
}

// 最後一個會扣款的日子（含），沒有終點是 null
const lastDay = (sub) => (sub.status === 'cancelled' && sub.end ? plusDays(sub.end, -1) : null)

// 下次扣款的日子（today 當天也算）；取消了、或之後不會再扣就是 null
export function nextCharge(sub, today) {
  const d = chargeAt(sub, indexFrom(sub, today))
  const last = lastDay(sub)
  if (sub.status === 'cancelled' && !last) return null
  return last && d > last ? null : d
}

// from～to（都含）之間的扣款日
export function chargesBetween(sub, from, to) {
  const last = lastDay(sub)
  if (sub.status === 'cancelled' && !last) return []
  const end = last && last < to ? last : to
  const out = []
  for (let k = indexFrom(sub, from); out.length < 400; k++) {
    const d = chargeAt(sub, k)
    if (d > end) break
    out.push(d)
  }
  return out
}

// 到 today 為止扣過幾次（today 當天的也算）
export function paidCount(sub, today) {
  const last = lastDay(sub)
  const upto = last && last < today ? last : today
  if (upto < sub.start) return 0
  return indexFrom(sub, plusDays(upto, 1))
}
// 到 today 為止大約付了多少（照現在的價格算，加上重新訂閱以前付的），跟 price 同一種幣別
export const paidSoFar = (sub, today) => paidCount(sub, today) * sub.price + (sub.paid0 || 0)

// 換算成每個月大約多少（跟 price 同一種幣別）
export function monthlyOf(sub) {
  const per = sub.unit === 'week' ? 52 / 12 : sub.unit === 'year' ? 1 / 12 : 1
  return (sub.price * per) / sub.every
}

// 換成新台幣
export const rateOf = (cur, rates = {}) => (cur === 'TWD' ? 1 : rates[cur] > 0 ? rates[cur] : CURRENCIES[cur]?.rate || 1)
export const toTWD = (amount, cur, rates) => amount * rateOf(cur, rates)

// 金額的寫法：NT$ 390、US$ 20、US$ 9.99、¥ 1,200
export function fmtMoney(amount, cur = 'TWD') {
  const c = CURRENCIES[cur] || CURRENCIES.TWD
  const whole = Math.abs(amount - Math.round(amount)) < 0.005
  const digits = whole ? 0 : c.digits
  return `${c.sign} ${amount.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}
// 換算後的新台幣（整數，前面加「約」）
export const fmtTWD = (amount) => `NT$ ${Math.round(amount).toLocaleString('zh-TW')}`

// 「每月」「每 3 個月」「每年」「每 2 週」
export const cycleLabel = (sub) => (sub.every === 1 ? `每${SUB_UNITS[sub.unit].per}` : `每 ${sub.every} ${SUB_UNITS[sub.unit].label}`)

// 付款方式欄位看起來像卡號（8 個以上連續數字）：不收，提醒寫「信用卡」這樣就好
export const looksLikeCardNumber = (text) => /\d{8,}/.test(String(text || '').replace(/[\s-]/g, ''))

// 月底那天
const monthEnd = (date) => {
  const [y, m] = parts(date)
  return fmt(new Date(y, m, 0))
}

// 整體的數字：訂閱中的每月／每年合計（換成新台幣）、這個月還要付多少、接下來 days 天內的扣款、各分類的比例、取消了每月省下多少
export function subsSummary(list, today, rates, days = 30) {
  const active = list.filter((s) => s.status === 'active')
  const cancelled = list.filter((s) => s.status === 'cancelled')
  const monthly = active.reduce((a, s) => a + toTWD(monthlyOf(s), s.cur, rates), 0)
  const byCat = {}
  for (const s of active) byCat[s.cat] = (byCat[s.cat] || 0) + toTWD(monthlyOf(s), s.cur, rates)
  const until = plusDays(today, days)
  const upcoming = []
  for (const s of list) for (const date of chargesBetween(s, today, until)) upcoming.push({ sub: s, date, days: between(today, date) })
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || toTWD(b.sub.price, b.sub.cur, rates) - toTWD(a.sub.price, a.sub.cur, rates))
  const end = monthEnd(today)
  let monthLeft = 0
  for (const s of list) monthLeft += chargesBetween(s, today, end).length * toTWD(s.price, s.cur, rates)
  const saved = cancelled.reduce((a, s) => a + toTWD(monthlyOf(s), s.cur, rates), 0)
  return { count: active.length, monthly, yearly: monthly * 12, monthLeft, upcoming, byCat, saved, cancelled: cancelled.length }
}
