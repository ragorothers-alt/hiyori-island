// ひより町：六棟建築各自綁一個功能，依那個功能的累積使用量從 0 階長到 5 階；2 階起店長搬進來。
// 階段全由 store 的累積統計推算（舊存檔一打開就有對應的小鎮），store 只記「已經慶祝到第幾階」。

const n = (v) => (Number.isFinite(v) ? v : 0)

export const BUILDINGS = [
  {
    key: 'florist', name: '花屋', jp: 'はなや', icon: '花', feature: '完成任務', unit: '件任務',
    steps: [1, 15, 60, 150, 300], value: (s) => n(s.tasksDone), resident: 'poko',
    stages: ['小花車', '花攤', '小花店', '雙層花店', '花園花店'],
  },
  {
    key: 'library', name: '圖書館', jp: 'としょかん', icon: '書', feature: '專注', unit: '分鐘專注',
    steps: [25, 250, 1000, 2500, 5000], value: (s) => n(s.focusMinutes), resident: 'hosuke',
    stages: ['共享書箱', '小書屋', '小圖書館', '附閱覽室的圖書館', '星空書塔'],
  },
  {
    key: 'clock', name: '時計台', jp: 'とけいだい', icon: '時', feature: '完成日程、套用排程', unit: '次日程與排程',
    steps: [1, 10, 40, 100, 200], value: (s) => n(s.eventsDone) + n(s.plansApplied), resident: 'kurumi',
    stages: ['時鐘街燈', '時鐘小亭', '時計台', '鐘樓', '大時計台'],
  },
  {
    key: 'bathhouse', name: '錢湯', jp: 'せんとう', icon: '湯', feature: '習慣打卡、忍住', unit: '次習慣打卡',
    steps: [1, 20, 80, 200, 400], value: (s) => n(s.habitChecks) + n(s.urgesResisted), resident: 'yuzu',
    stages: ['足湯', '小湯屋', '錢湯', '附露天風呂的錢湯', '大錢湯'],
  },
  {
    key: 'cafe', name: '喫茶店', jp: 'きっさてん', icon: '茶', feature: '生活記錄、記睡眠', unit: '筆生活記錄',
    steps: [1, 15, 60, 150, 300], value: (s) => n(s.lifeEntries) + n(s.sleepLogs), resident: 'shiratama',
    stages: ['咖啡推車', '咖啡小亭', '喫茶店', '雙層喫茶店', '花園喫茶店'],
  },
  {
    key: 'post', name: '郵便局', jp: 'ゆうびんきょく', icon: '郵', feature: '寫每日回顧', unit: '篇回顧',
    steps: [1, 5, 20, 50, 100], value: (s) => n(s.reviews), resident: 'kon',
    stages: ['郵筒', '小郵亭', '郵便局', '附倉庫的郵便局', '郵便塔'],
  },
]
export const MAX_STAGE = 5
// 長到這一階，店長就搬進來
export const MOVE_IN = 2

export const RESIDENTS = {
  poko: { key: 'poko', name: 'ぽこ', kind: 'tanuki', animal: '狸貓', home: 'florist', role: '花屋老闆', color: '#8bbf7a' },
  hosuke: { key: 'hosuke', name: 'ほうすけ', kind: 'owl', animal: '貓頭鷹', home: 'library', role: '圖書館館長', color: '#c7a27c' },
  kurumi: { key: 'kurumi', name: 'くるみ', kind: 'squirrel', animal: '松鼠', home: 'clock', role: '時計台管理員', color: '#d9895b' },
  yuzu: { key: 'yuzu', name: 'ゆず', kind: 'capybara', animal: '水豚', home: 'bathhouse', role: '錢湯老闆', color: '#e8b55a' },
  shiratama: { key: 'shiratama', name: 'しらたま', kind: 'rabbit', animal: '兔子', home: 'cafe', role: '喫茶店老闆', color: '#e6a3b4' },
  kon: { key: 'kon', name: 'こん', kind: 'fox', animal: '狐狸', home: 'post', role: '郵便局局長', color: '#e8894e' },
}

// 小鎮等級＝六棟階段總和（0–30）
export const TOWN_TITLES = [
  [0, '還是一片雲'],
  [1, '小聚落'],
  [5, '小村子'],
  [10, '村莊'],
  [15, '小鎮'],
  [21, '熱鬧的小鎮'],
  [27, '花開的小鎮'],
  [30, 'ひより町'],
]

export const buildingOf = (key) => BUILDINGS.find((b) => b.key === key)

// 某棟建築現在幾階、累積多少、離下一階還差多少
export function buildingStage(b, stats = {}) {
  const value = Math.max(0, Math.floor(b.value(stats)))
  let stage = 0
  while (stage < b.steps.length && value >= b.steps[stage]) stage++
  const next = stage < b.steps.length ? b.steps[stage] : null
  const prev = stage ? b.steps[stage - 1] : 0
  return { key: b.key, stage, value, next, prev, progress: next == null ? 1 : (value - prev) / (next - prev) }
}

export function townTitle(rank) {
  let title = TOWN_TITLES[0][1]
  for (const [min, t] of TOWN_TITLES) if (rank >= min) title = t
  return title
}

// 整個小鎮：各建築階段、等級、稱號、已經搬進來的居民
export function townOf(stats = {}) {
  const buildings = BUILDINGS.map((b) => buildingStage(b, stats))
  const rank = buildings.reduce((a, b) => a + b.stage, 0)
  const residents = BUILDINGS.filter((b, i) => buildings[i].stage >= MOVE_IN).map((b) => b.resident)
  return { buildings, rank, max: BUILDINGS.length * MAX_STAGE, title: townTitle(rank), residents }
}

// 從各建築階段（{ key: stage }）比對出新長大的建築與新搬來的居民
export function townChanges(seen, now) {
  const grew = []
  const movedIn = []
  for (const b of BUILDINGS) {
    const from = seen[b.key] ?? 0
    const to = now[b.key] ?? 0
    if (to > from) {
      grew.push({ key: b.key, from, stage: to })
      if (from < MOVE_IN && to >= MOVE_IN) movedIn.push({ key: b.resident, home: b.key })
    }
  }
  return { grew, movedIn }
}
