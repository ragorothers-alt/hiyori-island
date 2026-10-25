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
}

// 本命：每天最多挑 3 件，完成給雙倍 XP
export const MAX_STARS = 3
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
export const MAX_PROJECTS = 8

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
