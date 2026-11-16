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
import { PLAN } from './data/projectTown.js'

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
  // 寫專案進度：每個專案每天第一則（一天最多 3 個專案）
  projectLog: 5,
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

// 想分心時想去做的事（專注頁「先等一分鐘」上點一下記下來）：說得出是什麼念頭，比較容易放下；
// 週報、習慣洞察看得出最常把你拉走的是什麼。label 會接在「想去…」「先不…」後面；tip：常常是它的時候的小建議；
// now：點了它的那一刻，「先等一分鐘」上寫的、現在就做得到的一件小事
export const PULLS = [
  { id: 'phone', label: '滑手機', tip: '專注時把手機翻過來、放到伸手拿不到的地方；想滑的時候先等一分鐘，多半就過去了。', now: '先把手機翻過來、放到伸手拿不到的地方，等這一分鐘過去。' },
  { id: 'msg', label: '看訊息', tip: '專注前先把訊息回一輪，專注時關掉通知，休息時再一起看。', now: '訊息等休息時一起回；真的很急，回完那一則就回來。' },
  { id: 'video', label: '看影片', tip: '想看的先寫進「先記下來」，休息或做完再看；專注時別開著影片網站的分頁。', now: '想看的先記下來，休息時再看；影片的分頁先關掉。' },
  { id: 'snack', label: '吃點東西', tip: '專注前先把水和點心準備好放在旁邊；真的餓了就去吃，不用硬撐。', now: '真的餓了就去拿，拿了馬上回來；只是嘴饞的話，先喝口水。' },
  { id: 'web', label: '查別的事', tip: '想查的先寫進「先記下來」，這一輪做完再一起查。', now: '想查的先記下來，這一輪做完再一起查。' },
  { id: 'rest', label: '休息一下', tip: '常常想休息的話，一輪短一點、休息長一點，反而撐得比較久。', now: '先伸個懶腰、慢慢呼吸三次；真的撐不住就按暫停，好好休息。' },
]
export const pullOf = (id) => PULLS.find((p) => p.id === id) || null

// 重要日子的種類（日程頁的倒數、日曆上的記號）
export const DATE_KINDS = {
  exam: { label: '考試', kanji: '考' },
  deadline: { label: '截止', kanji: '期' },
  day: { label: '紀念', kanji: '祝' },
}
// 顯示用：倒數裡還會出現專案的里程碑期限（不能自己新增這種）
export const DUE_KINDS = { ...DATE_KINDS, milestone: { label: '里程碑', kanji: '標' } }
export const FOCUS_MIN = 25
export const BREAK_MIN = 5
// 每天的專注目標（分鐘；0 是不設）：計時設定裡選，專注頁上方寫著還差多少，跨過去的那一輪慶祝一下
export const FOCUS_GOALS = [0, 60, 90, 120, 180]
// 「1 小時」「1.5 小時」「45 分」
export const goalText = (m) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10} 小時` : `${m} 分`)
// 專注了多久：「1 小時 15 分」「2 小時」「45 分」
export const minText = (m) => {
  const h = Math.floor(m / 60)
  return h ? `${h} 小時${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`
}
// 同時進行的專案上限；專案町最多 TOWER_SLOTS 塊地（data/projectTown.js，隨城鎮等級陸續開放），其他專案先在清單裡等空地
export const MAX_PROJECTS = 30
export const TOWER_SLOTS = PLAN.lots.length

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
