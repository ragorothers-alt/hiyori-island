// RDATE、VTIMEZONE 不展開；未知 RRULE 只保留首筆，避免把不懂的規則變成錯誤日程。
const DAY = 86400000
const weekdays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const pad = (n) => String(n).padStart(2, '0')
const stamp = (p) => {
  const d = new Date(0)
  d.setUTCFullYear(p[0], p[1] - 1, p[2])
  d.setUTCHours(p[3] || 0, p[4] || 0, p[5] || 0, 0)
  return +d
}
const parts = (ms) => {
  const d = new Date(ms)
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
}
const dateOf = (p) => `${String(p[0]).padStart(4, '0')}-${pad(p[1])}-${pad(p[2])}`
const timeOf = (p) => `${pad(p[3])}:${pad(p[4])}`
const textOf = (s = '', limit = 80) => s.replace(/\\([nN,;\\])/g, (_, c) => /n/i.test(c) ? '\n' : c).trim().slice(0, limit)

function property(line) {
  // 引號中的冒號和分號屬於參數，不能拿來切屬性。
  const m = /^((?:[^":]|"[^"]*")*):(.*)$/.exec(line)
  if (!m) return null
  const head = m[1].match(/(?:[^;"]|"[^"]*")+/g) || []
  const name = head.shift()?.toUpperCase()
  const params = Object.create(null)
  for (const item of head) {
    const i = item.indexOf('=')
    if (i > 0) params[item.slice(0, i).toUpperCase()] = item.slice(i + 1).replace(/^"|"$/g, '')
  }
  return { name, params, value: m[2] }
}

function clock(target) {
  const cache = new Map()
  const formatter = (zone) => {
    if (!cache.has(zone)) {
      try {
        cache.set(zone, new Intl.DateTimeFormat('en-GB', {
          timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }))
      } catch { cache.set(zone, null) }
    }
    return cache.get(zone)
  }
  if (!formatter(target)) target = 'UTC'
  const local = (ms, zone = target) => {
    const values = Object.fromEntries(formatter(zone).formatToParts(ms).map((x) => [x.type, x.value]))
    return ['year', 'month', 'day', 'hour', 'minute', 'second'].map((k) => Number(values[k]))
  }
  const instant = (p, zone) => {
    const wall = stamp(p)
    if (zone === 'UTC') return wall
    const offsets = new Set([-36, 0, 36].map((h) => {
      const at = wall + h * 3600000
      return stamp(local(at, zone)) - at
    }))
    const choices = [...offsets].map((offset) => wall - offset)
    const exact = choices.filter((at) => stamp(local(at, zone)) === wall)
    // 秋季重疊選較早的一次；春季不存在的時間向後移過缺口，維持可預測的換算。
    return exact.length ? Math.min(...exact) : Math.max(...choices)
  }
  const read = (prop) => {
    if (!prop) return null
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i.exec(prop.value)
    if (!m) return null
    const p = m.slice(1, 7).map((s) => Number(s || 0))
    const allDay = !m[4]
    if (prop.params.VALUE && prop.params.VALUE.toUpperCase() !== (allDay ? 'DATE' : 'DATE-TIME')) return null
    if (p[0] < 1 || p[0] > 9999 || parts(stamp(p)).some((v, i) => v !== p[i])) return null
    const zone = m[7] ? 'UTC' : formatter(prop.params.TZID) && prop.params.TZID ? prop.params.TZID : target
    return { p, allDay, zone, ms: allDay ? stamp(p) : instant(p, zone) }
  }
  return { read, local, instant }
}

function duration(value) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value || '')
  if (!m || !m.slice(1).some(Boolean)) return null
  const n = (+m[1] * 7 || 0) * DAY + (+m[2] || 0) * DAY + (+m[3] || 0) * 3600000 + (+m[4] || 0) * 60000 + (+m[5] || 0) * 1000
  return Number.isFinite(n) ? n : null
}

function ruleOf(value, start, read) {
  if (!value) return null
  const r = Object.create(null)
  for (const item of value.toUpperCase().split(';')) {
    const [key, v, extra] = item.split('=')
    if (!v || extra || key in r) return null
    r[key] = v
  }
  if (Object.keys(r).some((k) => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST'].includes(k))) return null
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ)) return null
  const positive = (s) => /^\d+$/.test(s) && Number.isSafeInteger(+s) && +s > 0
  if ((r.INTERVAL && !positive(r.INTERVAL)) || (r.COUNT && !positive(r.COUNT))) return null
  if (r.BYDAY && !['WEEKLY', 'MONTHLY'].includes(r.FREQ)) return null
  if (r.BYMONTHDAY && r.FREQ !== 'MONTHLY') return null
  if (r.BYMONTH && r.FREQ !== 'YEARLY') return null
  const days = r.BYDAY?.split(',')
  if (days?.some((s) => !(r.FREQ === 'WEEKLY' ? /^(MO|TU|WE|TH|FR|SA|SU)$/ : /^[+-]?[1-5](MO|TU|WE|TH|FR|SA|SU)$/).test(s))) return null
  const monthDays = r.BYMONTHDAY?.split(',').map(Number)
  if (monthDays?.some((n) => !Number.isInteger(n) || !n || Math.abs(n) > 31)) return null
  const months = r.BYMONTH?.split(',').map(Number)
  if (months?.some((n) => !Number.isInteger(n) || n < 1 || n > 12)) return null
  const until = r.UNTIL ? read({ value: r.UNTIL, params: { TZID: start.zone } }) : null
  if (r.UNTIL && !until) return null
  return { freq: r.FREQ, interval: +(r.INTERVAL || 1), count: +(r.COUNT || Infinity), until, days, monthDays, months }
}

function * occurrences(start, rule, from, to, span) {
  yield start.p
  if (!rule) return
  const base = stamp(start.p)
  const dow = new Date(base).getUTCDay()
  const monday = base - ((dow + 6) % 7) * DAY
  const weekDays = [...new Set((rule.days || [weekdays[dow]]).map((d) => (weekdays.indexOf(d) + 6) % 7))].sort((a, b) => a - b)
  let period = 0
  let count = 1
  // 日、週可以直接跳到查詢附近，COUNT 仍包含視窗前已經發生的次數。
  const lower = from ? stamp(from.split('-').map(Number)) - span - 2 * DAY : base
  if (rule.freq === 'DAILY') {
    period = Math.max(0, Math.floor((lower - base) / (DAY * rule.interval)))
    count = Math.max(1, period)
  } else if (rule.freq === 'WEEKLY') {
    period = Math.max(0, Math.floor((lower - monday) / (7 * DAY * rule.interval)))
    if (period) count += weekDays.filter((d) => monday + d * DAY > base).length + (period - 1) * weekDays.length
  }
  const upper = to ? stamp(to.split('-').map(Number)) + 3 * DAY : Infinity
  for (let loops = 0; loops < 5000 && count < rule.count; loops++, period++) {
    let candidates = []
    let anchor
    if (rule.freq === 'DAILY') {
      anchor = base + period * rule.interval * DAY
      candidates = [parts(anchor)]
    } else if (rule.freq === 'WEEKLY') {
      anchor = monday + period * rule.interval * 7 * DAY
      candidates = weekDays.map((d) => parts(anchor + d * DAY))
    } else {
      const year = start.p[0] + (rule.freq === 'YEARLY' ? period * rule.interval : 0)
      const month = rule.freq === 'MONTHLY' ? start.p[1] + period * rule.interval : 1
      anchor = stamp([year, month, 1])
      const ym = parts(anchor)
      for (const mo of rule.freq === 'YEARLY' ? [...new Set(rule.months || [start.p[1]])].sort((a, b) => a - b) : [ym[1]]) {
        const y = ym[0]
        const last = parts(stamp([y, mo + 1, 1]) - DAY)[2]
        for (let d = 1; d <= last; d++) {
          const p = [y, mo, d, ...start.p.slice(3)]
          const wd = weekdays[new Date(stamp(p)).getUTCDay()]
          const byDate = !rule.monthDays || rule.monthDays.some((n) => d === (n > 0 ? n : last + n + 1))
          const byDay = !rule.days || rule.days.some((s) => {
            const n = parseInt(s)
            return s.endsWith(wd) && (n > 0 ? Math.ceil(d / 7) === n : -Math.ceil((last - d + 1) / 7) === n)
          })
          if (byDate && byDay && (rule.monthDays || rule.days || d === start.p[2])) candidates.push(p)
        }
      }
    }
    if (anchor > upper || !Number.isFinite(anchor)) break
    for (const p of candidates) {
      if (p[0] > 9999) return
      if (stamp(p) <= base) continue
      if (count >= rule.count) return
      count++
      yield p
    }
  }
}

export function parseICS(text, options = {}) {
  const empty = { name: '', events: [] }
  try {
    if (typeof text !== 'string') return empty
    const { from, to, tz = Intl.DateTimeFormat().resolvedOptions().timeZone } = options || {}
    const c = clock(tz)
    const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && c.read({ value: s.replaceAll('-', ''), params: {} })
    if ((from !== undefined && !validDate(from)) || (to !== undefined && !validDate(to)) || (from && to && from > to)) return empty
    const lines = text.slice(0, 2000000).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
    const records = []
    const stack = []
    let current = null
    let name = ''
    let calendar = false
    for (const line of lines) {
      const prop = property(line)
      if (!prop) continue
      if (prop.name === 'BEGIN') {
        const type = prop.value.toUpperCase()
        if (type === 'VCALENDAR' && !stack.length) calendar = true
        if (type === 'VEVENT' && stack.at(-1) === 'VCALENDAR') current = Object.create(null)
        stack.push(type)
      } else if (prop.name === 'END') {
        const type = prop.value.toUpperCase()
        if (stack.at(-1) !== type) { current = null; continue }
        if (type === 'VEVENT' && current) { records.push(current); current = null }
        stack.pop()
      } else if (current && stack.at(-1) === 'VEVENT') {
        const list = current[prop.name] ||= []
        list.push(prop)
      } else if (stack.at(-1) === 'VCALENDAR' && prop.name === 'X-WR-CALNAME') name = textOf(prop.value, Infinity)
    }
    if (!calendar) return empty
    const first = (r, key) => r[key]?.[0]
    const value = (r, key) => first(r, key)?.value
    const keyOf = (s) => s.allDay ? dateOf(s.p) : String(s.ms)
    const groups = new Map()
    for (const r of records) {
      const uid = value(r, 'UID')
      if (!uid) continue
      if (!groups.has(uid)) groups.set(uid, { master: null, overrides: new Map() })
      const group = groups.get(uid)
      if (r['RECURRENCE-ID']) {
        const rid = c.read(first(r, 'RECURRENCE-ID'))
        if (rid) group.overrides.set(keyOf(rid), r)
      } else group.master = r
    }
    const events = []
    const build = (r, p, original, uid) => {
      if (value(r, 'STATUS')?.toUpperCase() === 'CANCELLED') return
      const s = c.read(first(r, 'DTSTART'))
      if (!s) return
      const endProp = first(r, 'DTEND')
      const e = c.read(endProp)
      if (endProp && (!e || e.allDay !== s.allDay)) return
      const length = duration(value(r, 'DURATION'))
      if (!endProp && r.DURATION && length === null) return
      const span = e ? e.ms - s.ms : length ?? (s.allDay ? DAY : 3600000)
      const ms = s.allDay ? stamp(p) : c.instant(p, s.zone)
      if (!Number.isFinite(+new Date(ms + span))) return
      const local = s.allDay ? p : c.local(ms)
      const date = dateOf(local)
      if (local[0] < 1 || local[0] > 9999) return
      let start = ''
      let end = ''
      let endDate = ''
      if (s.allDay) {
        const last = parts(ms + Math.max(DAY, Math.ceil(span / DAY) * DAY) - DAY)
        if (last[0] > 9999) return
        endDate = dateOf(last)
        if ((from && endDate < from) || (to && date > to)) return
        if (endDate === date) endDate = ''
      } else {
        if ((from && date < from) || (to && date > to)) return
        start = timeOf(local)
        const finish = c.local(ms + span)
        end = dateOf(finish) > date ? '23:59' : timeOf(finish)
        if (span <= 0 || end <= start) {
          const minute = Math.min(1439, local[3] * 60 + local[4] + 30)
          end = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
        }
        // 23:59 已沒有可表示的更晚分鐘，跳過才能保持 App 的正長度時段約束。
        if (end <= start) return
      }
      events.push({ uid: `${uid}::${original}`, title: textOf(value(r, 'SUMMARY')) || '（沒有標題）', date, start, end, allDay: s.allDay, endDate, location: textOf(value(r, 'LOCATION')) })
    }
    for (const [uid, { master, overrides }] of groups) {
      if (events.length >= 2000) break
      if (master && value(master, 'STATUS')?.toUpperCase() !== 'CANCELLED') {
        const s = c.read(first(master, 'DTSTART'))
        if (s) {
          const excluded = new Set()
          const excludedDays = new Set()
          for (const prop of master.EXDATE || []) for (const v of prop.value.split(',')) {
            const ex = c.read({ ...prop, value: v })
            if (ex) {
              if (ex.allDay) excludedDays.add(dateOf(ex.p))
              else excluded.add(keyOf(ex))
            }
          }
          const rule = ruleOf(value(master, 'RRULE'), s, c.read)
          const e = c.read(first(master, 'DTEND'))
          const span = s.allDay ? Math.max(DAY, e ? e.ms - s.ms : duration(value(master, 'DURATION')) || DAY) : DAY
          for (const p of occurrences(s, rule, from, to, span)) {
            const occurrence = { ...s, p, ms: s.allDay ? stamp(p) : c.instant(p, s.zone) }
            if (rule?.until && (rule.until.allDay ? dateOf(p) > dateOf(rule.until.p) : occurrence.ms > rule.until.ms)) break
            const key = keyOf(occurrence)
            if (!excluded.has(key) && !excludedDays.has(dateOf(p)) && !overrides.has(key)) build(master, p, key, uid)
            if (events.length >= 2000) break
          }
        }
      }
      // 例外獨立套用，原始日期在視窗外但改期進來的那次也不會遺失。
      if (!master || value(master, 'STATUS')?.toUpperCase() !== 'CANCELLED') for (const [key, r] of overrides) {
        if (events.length >= 2000) break
        const s = c.read(first(r, 'DTSTART'))
        if (s) build(r, s.p, key, uid)
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid))
    return { name, events }
  } catch { return empty }
}
