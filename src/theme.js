// 共用色票與遊戲常數 —— 日系清透：水色、桜色、若葉、藤色、山吹

export const TAGS = [
  { id: 'work', label: '工作', color: '#8ec5e8' },
  { id: 'study', label: '學習', color: '#b9a7e6' },
  { id: 'life', label: '生活', color: '#f5adc2' },
  { id: 'health', label: '健康', color: '#93d4b0' },
  { id: 'idea', label: '靈感', color: '#f3cf7f' },
]
export const tagOf = (id) => TAGS.find((t) => t.id === id) || TAGS[2]

export const PRIORITIES = { 1: { label: '低', xp: 10 }, 2: { label: '中', xp: 15 }, 3: { label: '高', xp: 25 } }

export const EVENT_COLORS = ['#94cbea', '#f4b2c5', '#a9dcc0', '#c7b7ee', '#f5d38e', '#9fd6d4']
export const PROJECT_COLORS = ['#f2a3b8', '#88bfe4', '#97d1b1', '#bfa9e6', '#f1c487', '#85cdcb']

export const XP = {
  event: 10,
  milestone: 25,
  project: 120,
  pomodoro: 15,
  quest: 30,
  perfectDay: 40,
  review: 10,
  starAll: 30,
  weekly: 100,
  onTime: 60,
  // 習慣打卡、今天的習慣全做完、忍住一次衝動、戒除里程碑、生活記錄（每天前 3 筆）、記錄睡眠、排好今天的時段
  habit: 5,
  habitAll: 15,
  urge: 3,
  quitMilestone: 20,
  life: 3,
  sleep: 5,
  plan: 10,
}

// 本命：每天最多挑 3 件，完成給雙倍 XP
export const MAX_STARS = 3
// お守り：漏掉一天時自動保住連續天數，最多帶 2 個
export const CHARM = { price: 50, max: 2 }
// 一天完成超過這個數量後，任務 XP 減半（鼓勵休息，也避免灌任務刷分）
export const SOFT_CAP = 8

// 晚間回顧的心情：用天氣表示
export const MOODS = [
  { key: 'sunny', kanji: '晴', name: '晴朗', desc: '很棒的一天', color: '#f3c46b' },
  { key: 'rainbow', kanji: '虹', name: '彩虹', desc: '雨過天晴', color: '#e7a3cf' },
  { key: 'star', kanji: '星', name: '星空', desc: '平靜安穩', color: '#a9a3e6' },
  { key: 'cloudy', kanji: '曇', name: '多雲', desc: '普普通通', color: '#aab6c8' },
  { key: 'rain', kanji: '雨', name: '小雨', desc: '有點低落', color: '#8fb6dc' },
]
export const moodOf = (key) => MOODS.find((m) => m.key === key)

export const FOCUS_MIN = 25
export const BREAK_MIN = 5
// 同時進行的專案上限；島上只有 TOWER_SLOTS 塊空地（scene/island.js 的 LAYOUT.slots），其他專案先在清單裡等空地
export const MAX_PROJECTS = 30
export const TOWER_SLOTS = 8

// 等級解鎖的島嶼裝飾（scene/decor.js 依 key 建立）
export const UNLOCKS = [
  { level: 1, key: 'sakura', name: '大櫻花樹', jp: 'さくら' },
  { level: 2, key: 'lantern', name: '石燈籠', jp: 'とうろう' },
  { level: 3, key: 'torii', name: '鳥居', jp: 'とりい' },
  { level: 4, key: 'bridge', name: '太鼓橋', jp: 'たいこばし' },
  { level: 5, key: 'hydrangea', name: '繡球花叢', jp: 'あじさい' },
  { level: 6, key: 'sakura2', name: '第二棵櫻花', jp: 'にほんめ' },
  { level: 7, key: 'shrine', name: '小祠', jp: 'ほこら' },
  { level: 8, key: 'chochin', name: '漂浮燈籠', jp: 'ちょうちん' },
  { level: 9, key: 'lilies', name: '睡蓮與錦鯉', jp: 'すいれん' },
  { level: 10, key: 'islet', name: '浮空小島', jp: 'うきしま' },
  // Lv10 之後：每兩級擴建一次
  { level: 12, key: 'sakuraGrow', name: '櫻花樹長大了', jp: 'おおざくら' },
  { level: 14, key: 'waterfall', name: '島緣瀑布', jp: 'たき' },
  { level: 16, key: 'bonbori', name: '夜櫻雪洞', jp: 'ぼんぼり' },
  { level: 18, key: 'teahouse', name: '茶屋浮島', jp: 'ちゃや' },
  { level: 20, key: 'shrineUp', name: '小祠變成神社', jp: 'じんじゃ' },
  { level: 22, key: 'cranes', name: '紙鶴群', jp: 'つる' },
  { level: 24, key: 'rainbow', name: '彩虹橋', jp: 'にじ' },
  { level: 26, key: 'tsukimidai', name: '賞月台', jp: 'つきみだい' },
  { level: 28, key: 'whale', name: '雲鯨', jp: 'くもくじら' },
  { level: 30, key: 'skytree', name: '星之大樹', jp: 'ほしのたいじゅ' },
]

export const xpNeed = (level) => 80 + (level - 1) * 45

export function levelFromXp(total) {
  let level = 1
  let rest = total
  while (rest >= xpNeed(level)) {
    rest -= xpNeed(level)
    level++
  }
  return { level, cur: rest, need: xpNeed(level) }
}

export const WEEK_JP = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']
export const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六']
