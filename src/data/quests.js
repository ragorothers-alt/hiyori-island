// 每日任務池：每天依日期抽 3 個（簡單、普通、挑戰各一），同一天固定不變。
// val(d)：從當天紀錄算進度。need(ctx)：抽選當下這個任務是否做得到（例如今天沒有日程就不抽「完成 2 個日程」）。
// ctx = { hour, events, routineTasks, projects }

const bits = (n) => {
  let c = 0
  for (; n; n &= n - 1) c++
  return c
}

export const DAILY_QUESTS = [
  // 簡單
  { id: 'tasks3', tier: 'easy', goal: 3, val: (d) => d.tasks, title: '讓三朵花綻放', sub: '完成 3 個任務' },
  { id: 'star1', tier: 'easy', goal: 1, val: (d) => d.stars, title: '讓本命開花', sub: '完成 1 件本命' },
  { id: 'pet3', tier: 'easy', goal: 3, val: (d) => d.pets, title: '輕碰三回', sub: '摸摸もち 3 次' },
  { id: 'step1', tier: 'easy', goal: 1, val: (d) => d.events + d.milestones, title: '向前一步', sub: '完成 1 個日程或里程碑', need: (x) => x.events > 0 || x.projects > 0 },
  { id: 'early2', tier: 'easy', goal: 2, val: (d) => d.early, title: '晨光裡的兩朵花', sub: '中午前完成 2 個任務', need: (x) => x.hour < 10 },
  // 普通
  { id: 'focus2', tier: 'normal', goal: 2, val: (d) => d.pomodoros, title: '靜心兩回', sub: '完成 2 個番茄鐘' },
  { id: 'high1', tier: 'normal', goal: 1, val: (d) => d.high, title: '照顧心上的花', sub: '完成 1 個高優先任務' },
  { id: 'tags3', tier: 'normal', goal: 3, val: (d) => bits(d.tagMask), title: '花圃添三色', sub: '完成 3 種分類的任務' },
  { id: 'plan', tier: 'normal', goal: 1, val: (d) => d.plan, title: '晨間選三朵', sub: '中午前選好 3 件本命', need: (x) => x.hour < 10 },
  { id: 'review', tier: 'normal', goal: 1, val: (d) => d.review, title: '收好今日微光', sub: '留下今天的回顧' },
  { id: 'event2', tier: 'normal', goal: 2, val: (d) => d.events, title: '走過兩段時光', sub: '完成 2 個日程', need: (x) => x.events >= 2 },
  { id: 'routine2', tier: 'normal', goal: 2, val: (d) => d.routines, title: '熟悉的小節奏', sub: '完成 2 個例行任務', need: (x) => x.routineTasks >= 2 },
  // 挑戰
  { id: 'tasks5', tier: 'hard', goal: 5, val: (d) => d.tasks, title: '五朵花的風景', sub: '完成 5 個任務' },
  { id: 'focus50', tier: 'hard', goal: 50, val: (d) => d.focus, title: '靜坐一段時光', sub: '專注累計 50 分鐘' },
  { id: 'starAll', tier: 'hard', goal: 1, val: (d) => (d.starAll ? 1 : 0), title: '三朵本命齊開', sub: '完成全部 3 件本命' },
]
export const QUEST_TIERS = ['easy', 'normal', 'hard']
export const questOf = (id) => DAILY_QUESTS.find((q) => q.id === id)

// 每週挑戰：每週一依週次抽一個。val(w)：從這週七天的紀錄算進度
// w = { activeDays, tasks, focus, starAllDays, reviews, perfectDays, questsClaimed, rare }
export const WEEKLY_QUESTS = [
  { id: 'w_days5', goal: 5, val: (w) => w.activeDays, title: '五日花開的小徑', sub: '這週有 5 天完成任務' },
  { id: 'w_tasks20', goal: 20, val: (w) => w.tasks, title: '二十朵花的庭院', sub: '這週完成 20 個任務' },
  { id: 'w_focus150', goal: 150, val: (w) => w.focus, title: '靜心灌溉一週', sub: '這週專注累計 150 分鐘' },
  { id: 'w_starAll2', goal: 2, val: (w) => w.starAllDays, title: '兩回本命滿開', sub: '這週有 2 天完成全部 3 件本命' },
  { id: 'w_review4', goal: 4, val: (w) => w.reviews, title: '四張心情書籤', sub: '這週有 4 天留下回顧' },
  { id: 'w_perfect2', goal: 2, val: (w) => w.perfectDays, title: '收好兩日繁花', sub: '這週有 2 個完美的一天' },
  { id: 'w_quests8', goal: 8, val: (w) => w.questsClaimed, title: '八枚小小印章', sub: '這週領取 8 次每日任務獎勵' },
  { id: 'w_rare1', goal: 1, val: (w) => w.rare, title: '偶遇珍稀花影', sub: '這週開出 1 朵稀有以上的花' },
]
export const weeklyOf = (id) => WEEKLY_QUESTS.find((q) => q.id === id)
