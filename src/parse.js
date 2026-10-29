// 一行快速輸入：把「明天下午3點到5點 設計週會 #工作 !高 每週一」拆成結構化資料。
// 有時間 → 日程；沒時間 → 任務。純函式，today 由呼叫端傳入，方便測試。
import { addDays, parseDate, dateStr, minToHHMM } from './store.js'

const TAG_ALIASES = {
  work: ['工作', 'work', '公事'],
  study: ['學習', '学习', 'study', '讀書', '唸書'],
  life: ['生活', 'life', '家事'],
  health: ['健康', 'health', '運動', '运动'],
  idea: ['靈感', '灵感', 'idea', '點子'],
}
const WD = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
const CN_NUM = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }
const num = (s) => (s in CN_NUM ? CN_NUM[s] : parseInt(s, 10))

const PERIOD = '(上午|早上|早晨|中午|下午|傍晚|晚上|凌晨|夜裡)?'
const HOUR = '(\\d{1,2}|十[一二]?|[一二兩两三四五六七八九十])'
// 一個時間點：14:30、下午3點、3點半、3點15分、晚上8點、9am
const TIME = `${PERIOD}\\s*(?:${HOUR}\\s*[:：]\\s*(\\d{2})|${HOUR}\\s*[點点時时](半|\\d{1,2}\\s*分?)?|(\\d{1,2})\\s*(am|pm|AM|PM))`

function toMinutes(period, h, m, guessPm = false) {
  if (h > 24 || m > 59) return null
  // 沒寫上午／下午時：1～6 點在行事曆裡幾乎都是指下午
  if (!period && guessPm && h >= 1 && h <= 6) h += 12
  if (period) {
    if (/下午|傍晚|晚上|夜裡/.test(period) && h < 12) h += 12
    else if (period === '中午' && h < 11) h += 12
    else if (/凌晨|上午|早上|早晨/.test(period) && h === 12) h = 0
  }
  if (h === 24) h = 0
  return h * 60 + m
}

function readTime(match, offset, evening = false) {
  // offset：TIME 在整個正規式中的第一個群組位置
  const g = (i) => match[offset + i]
  const period = g(0)
  let h
  let m = 0
  let guess = false
  if (g(1) != null) {
    h = num(g(1))
    m = parseInt(g(2), 10)
    guess = !g(1).startsWith('0') && h < 10
  } else if (g(3) != null) {
    guess = true
    h = num(g(3))
    const tail = g(4)
    if (tail === '半') m = 30
    else if (tail) m = parseInt(tail, 10) || 0
  } else {
    h = parseInt(g(5), 10)
    if (/pm/i.test(g(6)) && h < 12) h += 12
    if (/am/i.test(g(6)) && h === 12) h = 0
    return { period: 'x', minutes: toMinutes(null, h, m) }
  }
  // 「今晚 9點」：沒寫時段就當晚上
  if (!period && evening && h < 12) return { period: '晚上', minutes: toMinutes('晚上', h, m) }
  return { period, minutes: toMinutes(period, h, m, guess) }
}

export function parseQuick(input, { today = dateStr() } = {}) {
  let text = ` ${input} `
  const out = { title: '', kind: 'task', date: null, start: null, end: null, priority: null, tag: null, repeat: null, star: false, chips: [] }
  const take = (re, fn) => {
    text = text.replace(re, (...m) => {
      const r = fn(...m)
      return r === false ? m[0] : ' '
    })
  }

  // 標籤 #工作
  take(/[#＃](\S+)/g, (_, name) => {
    const key = Object.keys(TAG_ALIASES).find((k) => TAG_ALIASES[k].includes(name.toLowerCase()))
    if (!key) return false
    out.tag = key
  })
  // 本命 ★ 或 !本命
  take(/★|[!！]\s*本命/g, () => {
    out.star = true
  })
  // 優先度 !高 !! ！
  take(/[!！]\s*(高|中|低)|([!！]{1,3})(?=\s)/g, (_, word, bangs) => {
    out.priority = word ? { 高: 3, 中: 2, 低: 1 }[word] : bangs.length === 3 ? 3 : bangs.length === 2 ? 2 : 1
  })
  // 重複：每天、平日、每週一三五
  take(/每天|每日|天天/g, () => {
    out.repeat = { type: 'daily' }
  })
  take(/平日|工作日|週一到週五|周一到周五/g, () => {
    out.repeat = { type: 'weekdays' }
  })
  take(/每(?:個)?(?:週|周|星期|禮拜|礼拜)([一二三四五六日天、]+)/g, (_, ds) => {
    const days = [...new Set([...ds].filter((c) => c in WD).map((c) => WD[c]))]
    if (!days.length) return false
    out.repeat = { type: 'weekly', days }
  })

  // 日期
  const dow = parseDate(today).getDay()
  take(/大後天|大后天/g, () => (out.date = addDays(today, 3)))
  take(/後天|后天/g, () => (out.date = addDays(today, 2)))
  take(/明天|明日/g, () => (out.date = addDays(today, 1)))
  let evening = false
  take(/今天|今日|今晚/g, (m) => {
    out.date = today
    if (m === '今晚') evening = true
  })
  take(/(\d{1,2})\s*天後/g, (_, n) => (out.date = addDays(today, +n)))
  take(/(下)?(?:週|周|星期|禮拜|礼拜)([一二三四五六日天])/g, (_, next, d) => {
    const target = WD[d]
    if (next) {
      const monday = addDays(today, -((dow + 6) % 7))
      out.date = addDays(monday, ((target + 6) % 7) + 7)
    } else {
      out.date = addDays(today, (target - dow + 7) % 7)
    }
  })
  take(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g, (_, y, m, d) => {
    out.date = dateStr(new Date(+y, +m - 1, +d))
  })
  take(/(?<![\d:：])(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*(?:日|號|号)?(?![\d:：])/g, (_, m, d) => {
    if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return false
    const y = parseDate(today).getFullYear()
    let ds = dateStr(new Date(y, +m - 1, +d))
    // 已經過了一個月以上，就當成明年
    if (ds < addDays(today, -30)) ds = dateStr(new Date(y + 1, +m - 1, +d))
    out.date = ds
  })

  // 時間區間：下午3點到5點、14:00-15:30
  const range = new RegExp(`${TIME}\\s*(?:-|~|〜|～|–|到|至)\\s*${TIME}`)
  const rm = text.match(range)
  if (rm) {
    const a = readTime(rm, 1, evening)
    const b = readTime(rm, 8, evening)
    if (a.minutes != null && b.minutes != null) {
      let end = b.minutes
      // 「下午3點到5點」：結束沒寫時段時沿用開始的時段
      if (!b.period && a.period && end < a.minutes && b.minutes < 720) end = b.minutes + 720
      if (end <= a.minutes) end = Math.min(a.minutes + 60, 1439)
      out.start = a.minutes
      out.end = end
      text = text.replace(rm[0], ' ')
    }
  }
  if (out.start == null) {
    const one = text.match(new RegExp(TIME))
    if (one) {
      const a = readTime(one, 1, evening)
      if (a.minutes != null) {
        out.start = a.minutes
        text = text.replace(one[0], ' ')
      }
    }
  }
  if (out.start != null && out.end == null) {
    let dur = 60
    take(/(\d+(?:\.\d+)?)\s*(?:個)?\s*(?:小時|hr|h)(?![a-z])/gi, (_, n) => (dur = Math.round(parseFloat(n) * 60)))
    take(/(\d+)\s*(?:分鐘|分钟|min|m)(?![a-z])/gi, (_, n) => (dur = +n))
    out.end = Math.min(out.start + Math.max(5, dur), 1439)
  }

  // 沒有時間的任務：「寫報告 1.5小時」「回信 20分鐘」當作預估時間（排時段用）
  if (out.start == null) {
    take(/(\d+(?:\.\d+)?)\s*(?:個)?\s*(?:小時|hr|h)(?![a-z])/gi, (_, n) => (out.dur = Math.min(600, Math.round(parseFloat(n) * 60)) || null))
    take(/(\d+)\s*(?:分鐘|分钟|min)(?![a-z])/gi, (_, n) => (out.dur = Math.min(600, +n) || null))
  }

  if (out.start != null) {
    out.kind = 'event'
    out.start = minToHHMM(out.start)
    out.end = minToHHMM(out.end)
  }
  out.title = text.replace(/\s+/g, ' ').replace(/^[\s,，、:：]+|[\s,，、:：]+$/g, '').trim()
  return out
}

// 給輸入框下方的預覽用
export function describeQuick(p, today) {
  const chips = []
  if (p.kind === 'event') chips.push('日程')
  if (p.date && p.date !== today) {
    const d = parseDate(p.date)
    chips.push(`${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`)
  } else if (p.date) chips.push('今天')
  if (p.start) chips.push(`${p.start}–${p.end}`)
  if (p.repeat) chips.push(p.repeat.type === 'daily' ? '↻ 每天' : p.repeat.type === 'weekdays' ? '↻ 平日' : '↻ 每週' + p.repeat.days.map((d) => '日一二三四五六'[d]).join('、'))
  if (p.priority && p.kind === 'task') chips.push(['', '低', '中', '高'][p.priority] + '優先')
  if (p.dur && p.kind === 'task') chips.push(`預估 ${p.dur >= 60 ? `${+(p.dur / 60).toFixed(1)} 小時` : `${p.dur} 分鐘`}`)
  if (p.star && p.kind === 'task') chips.push('★ 本命')
  return chips
}
