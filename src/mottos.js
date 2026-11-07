// 警語（自己寫給自己的話）：記下幾句，App 輪流放在面板上方，醒著的時候每隔一段時間提醒一句。
// 一句：{ id, text, on, createdAt }；on 是 false 的先收著（不輪播、不提醒）。純函式，時間由呼叫端傳入
// store.js 也引入這個檔案：自己算分鐘，不繞回去
const toMin = (s) => {
  const [h, m] = String(s).split(':').map(Number)
  return h * 60 + m
}

export const MOTTO_MAX = 30
export const MOTTO_LEN = 60
// 多久提醒一次（分鐘，0 = 不提醒）
export const MOTTO_EVERY = [0, 30, 60, 120, 180]
// 面板上方那一句多久換一句
export const MOTTO_ROTATE = 15

// 還沒寫過的人可以點一下就加
export const MOTTO_EXAMPLES = ['先做最重要的那一件', '完成比完美重要', '累了就休息，不是放棄', '手機放遠一點', '今天比昨天進步一點就好', '別跟別人比，跟昨天的自己比']

export const activeMottos = (list = []) => list.filter((m) => m.on)

// 現在輪到哪一句：每 MOTTO_ROTATE 分鐘換一句，同一段時間每個畫面看到的都一樣；shift 是使用者自己按「下一句」的次數
export function mottoAt(list, now = Date.now(), shift = 0) {
  const on = activeMottos(list)
  if (!on.length) return null
  const slot = Math.floor(now / (MOTTO_ROTATE * 60000)) + shift
  return on[((slot % on.length) + on.length) % on.length]
}

// 醒著嗎（作息的起床到就寢；就寢在午夜後也算得對）
export function awake(rhythm, mins) {
  const wake = toMin(rhythm?.wake || '07:00')
  const sleep = toMin(rhythm?.sleep || '23:00')
  return wake <= sleep ? mins >= wake && mins < sleep : mins >= wake || mins < sleep
}
