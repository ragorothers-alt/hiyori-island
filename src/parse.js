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
// 日曆上真的有這一天（2/30、4/31、13 月都不算）
const realDay = (y, m, d) => {
  const t = new Date(y, m - 1, d)
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d
}

const PERIOD = '(上午|早上|早晨|中午|下午|傍晚|晚上|凌晨|夜裡)?'
const HOUR = '(\\d{1,2}|十[一二]?|[一二兩两三四五六七八九十])'
// 一個時間點：14:30、下午3點、3點半、3點15分、晚上8點、9am
const TIME = `${PERIOD}\\s*(?:${HOUR}\\s*[:：]\\s*(\\d{2})|${HOUR}\\s*[點点時时](半|\\d{1,2}\\s*分?)?|(\\d{1,2})\\s*(am|pm|AM|PM))`
// 幾小時（可以接著幾分）：1.5小時、2個半小時、半小時、1小時30分鐘、1小時30分、2h、1hr 15min
const HOURS = /(?:(\d+(?:\.\d+)?)\s*(?:個)?\s*(半)?|(半)\s*(?:個)?)\s*(?:小時|hr|h)(?![a-z])(?:\s*(\d+)\s*(?:分鐘|分钟|分|min|m)(?![a-z]))?/gi

function toMinutes(period, h, m, guessPm = false) {
  if (h > 24 || m > 59) return null
  // 沒寫上午／下午時：1～6 點在行事曆裡幾乎都是指下午
  if (!period && guessPm && h >= 1 && h <= 6) h += 12
  if (period) {
    if (/下午|傍晚|晚上|夜裡/.test(period) && h < 12) h += 12
    // 「晚上 12 點」是半夜，不是中午
    else if (/晚上|夜裡/.test(period) && h === 12) h = 24
    else if (period === '中午' && h < 11) h += 12
    else if (/凌晨|上午|早上|早晨/.test(period) && h === 12) h = 0
  }
  // 24 點（半夜）回傳 1440 起算：呼叫的那邊換成隔天 0 點，或當成那天的結束
  return h * 60 + m
}

// inherit：區間的結束沒寫時段時，沿用開始那一端的時段
function readTime(match, offset, evening = false, inherit = null) {
  // offset：TIME 在整個正規式中的第一個群組位置
  const g = (i) => match[offset + i]
  const period = g(0) || inherit
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
    // 時段記成上午／下午：區間的另一端沒寫時可以沿用（9am到11 是上午 11 點）
    return { period: /pm/i.test(g(6)) ? '下午' : '上午', minutes: toMinutes(null, h, m) }
  }
  // 「今晚 9點」：沒寫時段就當晚上（今晚 12 點是半夜）
  if (!period && evening && h <= 12) return { period: '晚上', minutes: toMinutes('晚上', h, m) }
  return { period, minutes: toMinutes(period, h, m, guess) }
}

// projects：[{ id, name }]，給「@專案名」對照用（打開頭幾個字就夠）
export function parseQuick(input, { today = dateStr(), projects = [] } = {}) {
  let text = ` ${input} `
  // 對到專案時才會多 project（id）和 projectName
  const out = { title: '', kind: 'task', date: null, start: null, end: null, priority: null, tag: null, repeat: null, star: false, chips: [] }
  const take = (re, fn) => {
    text = text.replace(re, (...m) => {
      const r = fn(...m)
      return r === false ? m[0] : ' '
    })
  }

  // 專案 @作品集：名字一樣的優先，再來是開頭對得上的（不分大小寫、不管空白）
  if (projects.length) {
    const norm = (s) => s.toLowerCase().replace(/\s+/g, '')
    take(/[@＠](\S+)/g, (_, name) => {
      const q = norm(name)
      const p = projects.find((x) => norm(x.name) === q) || projects.find((x) => norm(x.name).startsWith(q))
      if (!p) return false
      out.project = p.id
      out.projectName = p.name
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
  // 好幾天：11/17到11/19、11/17-19（只寫日的話跟開始同一個月）→ 整天的日程
  const md = (m, d) => {
    const y = parseDate(today).getFullYear()
    const on = (yy) => (realDay(yy, +m, +d) ? dateStr(new Date(yy, +m - 1, +d)) : null)
    let ds = on(y)
    // 已經過了一個月以上（或今年沒有這一天，例如 2/29），就當成明年
    if (!ds || ds < addDays(today, -30)) ds = on(y + 1) || ds
    return ds
  }
  take(/(?<![\d:：])(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*(?:日|號|号)?\s*(?:-|~|〜|～|–|到|至)\s*(?:(\d{1,2})\s*(?:\/|月)\s*)?(\d{1,2})\s*(?:日|號|号)?(?![\d:：])/g, (_, m1, d1, m2, d2) => {
    const a = md(m1, d1)
    // 跨年（12/30到1/2）：1/2 已經過去很久，md 會當成明年，自然接在後面
    const b = a && md(m2 || m1, d2)
    if (!a || !b || b < a || b > addDays(a, 30)) return false
    out.date = a
    out.endDate = b
    out.allDay = true
  })
  // 整天：「11/17 朋友來玩 整天」
  take(/一整天|整天|全天|整日/g, () => {
    out.allDay = true
  })
  take(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g, (_, y, m, d) => {
    if (!realDay(+y, +m, +d)) return false
    out.date = dateStr(new Date(+y, +m - 1, +d))
  })
  take(/(?<![\d:：])(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*(?:日|號|号)?(?![\d:：])/g, (_, m, d) => {
    const ds = md(m, d)
    // 2/30、13/5 這種日曆上沒有的：不當成日期，留在標題裡（不要默默進位成下個月）
    if (!ds) return false
    out.date = ds
  })

  // 時間區間：下午3點到5點、14:00-15:30
  const range = new RegExp(`${TIME}\\s*(?:-|~|〜|～|–|到|至)\\s*${TIME}`)
  const rm = text.match(range)
  if (rm) {
    const a = readTime(rm, 1, evening)
    let b = readTime(rm, 8, evening)
    // 結束沒寫時段（早上5點到6點、凌晨1點到2點）：沿用開始的時段，
    // 不要被「1～6 點多半是下午」猜成下午；rm[8] 是結束的時段、rm[13] 是 am/pm 的數字
    if (a.period && a.minutes != null && !rm[8] && rm[13] == null) {
      if (a.minutes >= 1440) {
        // 晚上12點到1點：結束是隔天凌晨
        b = readTime(rm, 8, false, '凌晨')
        if (b.minutes != null) b.minutes += 1440
      } else {
        b = readTime(rm, 8, false, a.period)
        // 上午11點到1點、上午9點到12點：結束跨過中午
        if (b.minutes != null && b.minutes <= a.minutes && b.minutes + 720 > a.minutes && b.minutes + 720 <= 1440) b.minutes += 720
      }
    }
    if (a.minutes != null && b.minutes != null) {
      let start = a.minutes
      let end = b.minutes
      // 從半夜開始（晚上12點到1點）：整段換到隔天
      if (start >= 1440) {
        out.date = addDays(out.date || today, 1)
        start -= 1440
        if (end >= 1440) end -= 1440
      }
      // 結束在半夜：那天的最後一分鐘
      if (end >= 1440) end = 1439
      if (end <= start) end = Math.min(start + 60, 1439)
      out.start = start
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
        // 「明天晚上12點」：隔天的 0 點
        if (out.start >= 1440) {
          out.date = addDays(out.date || today, 1)
          out.start -= 1440
        }
        text = text.replace(one[0], ' ')
      }
    }
  }
  // 時長：「1小時30分鐘」「1小時30分」「1.5小時」「2個半小時」「半小時」「45分鐘」全部加起來
  // （以前後面的會蓋掉前面的：「1小時30分鐘」變成 30 分鐘）。沒寫是 null
  const takeDur = (mins) => {
    let total = null
    const add = (n) => (total = (total || 0) + n)
    take(HOURS, (_, n, half, half2, m) => add((n ? parseFloat(n) * 60 : 0) + (half || half2 ? 30 : 0) + (m ? +m : 0)))
    take(mins, (_, n) => add(+n))
    return total == null ? null : Math.round(total)
  }
  if (out.start != null && out.end == null) {
    const dur = takeDur(/(\d+)\s*(?:分鐘|分钟|min|m)(?![a-z])/gi) ?? 60
    out.end = Math.min(out.start + Math.max(5, dur), 1439)
  }

  // 沒有時間的任務：「寫報告 1.5小時」「回信 20分鐘」當作預估時間（排時段用）。
  // 單獨的「分」不算（「考到 100分」是分數）；跟在小時後面的「1小時30分」才算
  if (out.start == null) {
    const dur = takeDur(/(\d+)\s*(?:分鐘|分钟|min)(?![a-z])/gi)
    if (dur != null) out.dur = Math.min(600, dur) || null
  }

  if (out.start != null) {
    out.kind = 'event'
    out.start = minToHHMM(out.start)
    out.end = minToHHMM(out.end)
    // 寫了時間就是有時段的日程（「整天」只是順口）
    delete out.allDay
    delete out.endDate
  } else if (out.allDay) {
    // 沒寫日期時跟任務一樣，加在上面選的那天
    out.kind = 'event'
  }
  out.title = text.replace(/\s+/g, ' ').replace(/^[\s,，、:：]+|[\s,，、:：]+$/g, '').trim()
  return out
}

// 給輸入框下方的預覽用
export function describeQuick(p, today) {
  const chips = []
  if (p.kind === 'event') chips.push(p.allDay ? '整天的日程' : '日程')
  if (p.allDay && p.endDate && p.endDate !== p.date) {
    const f = (x) => {
      const d = parseDate(x)
      return `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`
    }
    chips.push(`${f(p.date)}–${f(p.endDate)}`)
  } else if (p.date && p.date !== today) {
    const d = parseDate(p.date)
    chips.push(`${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`)
  } else if (p.date) chips.push('今天')
  if (p.start) chips.push(`${p.start}–${p.end}`)
  if (p.repeat) chips.push(p.repeat.type === 'daily' ? '↻ 每天' : p.repeat.type === 'weekdays' ? '↻ 平日' : '↻ 每週' + p.repeat.days.map((d) => '日一二三四五六'[d]).join('、'))
  if (p.priority && p.kind === 'task') chips.push(['', '低', '中', '高'][p.priority] + '優先')
  if (p.dur && p.kind === 'task') chips.push(`預估 ${p.dur >= 60 ? `${+(p.dur / 60).toFixed(1)} 小時` : `${p.dur} 分鐘`}`)
  if (p.star && p.kind === 'task') chips.push('★ 本命')
  if (p.projectName && p.kind === 'task') chips.push(`專案・${p.projectName}`)
  return chips
}
