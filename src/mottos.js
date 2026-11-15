// 警語（自己寫給自己的話）：記下幾句，App 輪流放在面板上方，醒著的時候每隔一段時間提醒一句。
// 一句：{ id, text, on, createdAt }；on 是 false 的先收著（不輪播、不提醒）。純函式，時間由呼叫端傳入
// store.js 也引入這個檔案：自己算分鐘，不繞回去
const toMin = (s) => {
  const [h, m] = String(s).split(':').map(Number)
  return h * 60 + m
}

export const MOTTO_MAX = 30
export const MOTTO_LEN = 60
// 多久提醒一次（分鐘，0 = 不提醒）：很容易分心的話，10～20 分鐘就拉自己回來一次
export const MOTTO_EVERY = [0, 10, 15, 20, 30, 60, 120, 180]
// 面板上方那一句多久換一句
export const MOTTO_ROTATE = 15
// 交給手機排的提醒最多幾則：排到明天就寢最多兩整段醒著的時間（作息幾乎整天醒著時近 48 小時），每 10 分鐘一則是 288 則
export const PLAN_MAX = 300
// 到點晚了這麼久還沒通知的就不發了（過時的提醒沒有用）；交給手機的那一串也留著這段時間內還沒處理的
export const MOTTO_LATE = 10 * 60000

// 還沒寫過的人可以點一下就加
export const MOTTO_EXAMPLES = ['先做最重要的那一件', '完成比完美重要', '累了就休息，不是放棄', '手機放遠一點', '今天比昨天進步一點就好', '別跟別人比，跟昨天的自己比']

export const activeMottos = (list = []) => list.filter((m) => m.on)
// 拿出來的那幾句裡的第 i 句（i 一直往上加，繞回來）
export const mottoOf = (on, i) => on[(((Math.trunc(i) || 0) % on.length) + on.length) % on.length]

// 現在輪到哪一句：每 MOTTO_ROTATE 分鐘換一句，同一段時間每個畫面看到的都一樣；shift 是使用者自己按「下一句」的次數
export function mottoAt(list, now = Date.now(), shift = 0) {
  const on = activeMottos(list)
  if (!on.length) return null
  return mottoOf(on, Math.floor(now / (MOTTO_ROTATE * 60000)) + shift)
}

// 醒著嗎（作息的起床到就寢；就寢在午夜後也算得對）
export function awake(rhythm, mins) {
  const wake = toMin(rhythm?.wake || '07:00')
  const sleep = toMin(rhythm?.sleep || '23:00')
  return wake <= sleep ? mins >= wake && mins < sleep : mins >= wake || mins < sleep
}

// ── 定時提醒排在什麼時候（頁面開著時的檢查、交給手機排的都照這個算，兩邊才對得上）──
const minsOf = (t) => {
  const d = new Date(t)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}
// 那一刻（毫秒）醒著嗎（照這台裝置的時區）
export const awakeAt = (rhythm, t) => awake(rhythm, minsOf(t))
// 那天的 mins（一天裡的第幾分鐘）：k 是往後幾天。夏令時間回撥那天同一個鐘點有兩次，這裡是第一次
const clockAt = (d, k, mins) => +new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, 0, mins)
// 夏令時間回撥那天同一個鐘點第二次出現的那一刻（沒有第二次是 null）：照接下來幾小時內時區差了多少算
// （大多回撥一小時，也有半小時的，例如澳洲的豪勳爵島）
const again = (a) => {
  const shift = new Date(a + 3 * 3600000).getTimezoneOffset() - new Date(a).getTimezoneOffset()
  if (!(shift > 0)) return null
  const b = a + shift * 60000
  return minsOf(b) === minsOf(a) ? b : null
}
// t 之後第一次到一天裡的第 mins 分鐘；orEqual：剛好就是那一刻也算
function upcoming(t, mins, orEqual) {
  const d = new Date(t)
  const after = (x) => x != null && (x > t || (orEqual && x === t))
  for (const k of [0, 1]) {
    const a = clockAt(d, k, mins)
    if (after(a)) return a
    if (after(again(a))) return again(a)
  }
  return clockAt(d, 2, mins)
}
// t 以前（含）最近一次到一天裡的第 mins 分鐘
function previous(t, mins) {
  const d = new Date(t)
  for (const k of [0, -1]) {
    const a = clockAt(d, k, mins)
    const b = again(a)
    if (b != null && b <= t) return b
    if (a <= t) return a
  }
  return clockAt(d, -2, mins)
}

// from（上一次提醒的時間）之後的下一次：過 every 分鐘；那時在睡覺的話，起床後 every 分鐘
// （每天第一次是起床後過了一個間隔，不會一起床就響）
export function nextMotto(from, every, rhythm) {
  const t = from + every * 60000
  if (awakeAt(rhythm, t)) return t
  const wake = upcoming(t, toMin(rhythm?.wake || '07:00'), true)
  const first = wake + every * 60000
  // 醒著的時間比間隔還短（作息設得很特別）：起床那一刻提醒
  return awakeAt(rhythm, first) ? first : wake
}

// t 所在的醒著那一段（t 在睡覺的話是接下來那一段）幾點結束（就寢的時間）
export function windowEnd(rhythm, t) {
  const from = awakeAt(rhythm, t) ? t : upcoming(t, toMin(rhythm?.wake || '07:00'), true)
  return upcoming(from, toMin(rhythm?.sleep || '23:00'), false)
}

// ── 先停一下：開會、吃飯、跟朋友在一起時先不提醒，時間到了自己恢復（settings.mottoPause 是停到幾點，0 是沒停）──
// 停著的時候到點的那幾則不念、不通知（照樣輪過去），停完照原本的間隔接下去
export const PAUSE_HOUR = 3600000
// 停到幾點最晚是多久以後：「今天先停」最多停到這一段醒著的時間結束（不到一天），再多就是壞掉的資料
export const PAUSE_MAX = 26 * 3600000
// kind：'hour' 先停 1 小時、'today' 今天先停（停到就寢）。睡覺的時間裡本來就不提醒，「今天先停」回傳 null
export function pauseUntil(kind, rhythm, now) {
  if (kind === 'hour') return now + PAUSE_HOUR
  if (kind === 'today') return awakeAt(rhythm, now) ? windowEnd(rhythm, now) : null
  return null
}
// 「停到幾點」怎麼寫：今天的寫 HH:MM，日曆上的明天（就寢在午夜後）寫「明天 HH:MM」
export function pauseText(until, now) {
  const d = new Date(until)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return new Date(now).toDateString() === d.toDateString() ? hm : `明天 ${hm}`
}
// 現在停著嗎：停到幾點（毫秒），沒停是 0
export const pausedUntil = (settings, now) => {
  const v = Number(settings?.mottoPause) || 0
  return v > now ? v : 0
}
// 設定裡的那一段「先停」：{ from 從幾點開始停, until 停到幾點, cut 是不是提早恢復的 }（已經過了也照算）。
// from 是 0 的（剛加這個功能時存的）當成一直停著到 until
export const pauseOf = (settings) => ({
  from: Number(settings?.mottoPauseFrom) || 0,
  until: Number(settings?.mottoPause) || 0,
  cut: !!settings?.mottoPauseCut,
})
// 從 prev 那一則往後的下一則：{ at, skip }。skip：停著的時候（pause.from 到 pause.until 之間）到點的，不念、不通知。
// 開始停之前到點的照常（例如手機已經通知過、頁面還沒跟上的那一則，從通知上按了先停：那一則不算跳過）。
// skipped：prev 那一則就是停著時跳過的。停的那段真的跳過了一則的話，停完的那一刻（醒著的話）補提醒一次，
// 之後從那裡照間隔接下去——「先停 1 小時」就是一小時後再提醒；停的那段本來就沒有要提醒的，照原本的時間。
// cut：自己按了「現在就恢復」（停到的時間改成按下去的那一刻）：停著時到點的照樣算跳過，但不補（正看著 App）
export function stepMotto(prev, skipped, every, rhythm, pause = null) {
  const t = nextMotto(prev, every, rhythm)
  const from = pause?.from || 0
  const until = pause?.until || 0
  if (t >= from && t < until) return { at: t, skip: true }
  if (skipped && !pause?.cut && prev < until && t > until && awakeAt(rhythm, until)) return { at: until, skip: false }
  return { at: t, skip: false }
}

// t 算在哪一天醒著的那一段，回傳那一段幾點結束：醒著就是這一段；睡覺的時間裡，前半段算剛結束的那一段
// （過了就寢還沒睡），後半段算接下來那一段（快起床了）
function dayEnd(rhythm, t) {
  if (awakeAt(rhythm, t)) return windowEnd(rhythm, t)
  const slept = previous(t, toMin(rhythm?.sleep || '23:00'))
  const wake = upcoming(t, toMin(rhythm?.wake || '07:00'), true)
  return t - slept <= wake - t ? slept : windowEnd(rhythm, wake)
}
// 交給手機的那一串排到幾點：明天就寢（「今天」照上面 dayEnd 算：過了就寢還沒睡的，明天是日曆上的下一天）
export const planUntil = (rhythm, now) => windowEnd(rhythm, dayEnd(rhythm, now) + 60000)
// 交給手機的那一串什麼時候要重排：會影響排法的東西都放進來（間隔、作息、拿出來的警語、上次念到哪、
// 專注到幾點、先停到幾點、現在該做的那件、排到幾點）。沒變就不用重送
export const planKey = ({ every, rhythm, mottos, last, quietUntil = 0, pause = null, task = '', now }) =>
  JSON.stringify([every, rhythm?.wake, rhythm?.sleep, last?.at, last?.i, !!last?.skip, quietUntil, pause?.from || 0, pause?.until || 0, !!pause?.cut, task, planUntil(rhythm, now), activeMottos(mottos).map((m) => m.text)])

// 從上一次提醒（last：{ at, i, skip }，i 是下一則輪到拿出來的第幾句，skip 是那一則停著沒念）往後，排到明天就寢的提醒：[{ at, text }]。
// since 以前的（已經過去、處理過的）、quietUntil 以前的（專注中不打擾）、停著時到點的（pause：{ from, until, cut }，見 stepMotto）不排，
// 但那一句照樣輪過去（跟頁面開著時一樣，兩邊才對得上）。since 可以比現在早一點：到點了、還沒通知的那一則留著交給手機。
// 只排到明天：兩天都沒打開 App 的話就不再提醒（不會一直響下去）
export function planMottos(list, every, rhythm, last, now, { quietUntil = 0, pause = null, since = now, max = PLAN_MAX } = {}) {
  const on = activeMottos(list)
  if (!(every > 0) || !on.length || !(last?.at > 0)) return []
  const until = planUntil(rhythm, now)
  const out = []
  let t = last.at
  let skip = !!last.skip
  let i = Number(last.i) || 0
  for (let k = 0; k < 2000 && out.length < max; k++) {
    const n = stepMotto(t, skip, every, rhythm, pause)
    t = n.at
    skip = n.skip
    if (t > until) break
    const m = mottoOf(on, i++)
    if (!skip && t > since && t > quietUntil && awakeAt(rhythm, t)) out.push({ at: t, text: m.text })
  }
  return out
}
