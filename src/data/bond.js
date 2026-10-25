// もち的好感度：摸摸、專注、回顧、每天來看看牠都會累積。每升一級解鎖一件衣裝或一個新動作。

// 每次加多少（摸摸一天最多算 petDailyMax 次）
export const BOND_POINTS = { visit: 2, pet: 1, petDailyMax: 5, pomodoro: 3, review: 4, starAll: 3 }

export const BOND_LEVELS = [
  { level: 1, need: 0, name: '初次見面', reward: null },
  { level: 2, need: 12, name: '記得彼此', reward: { outfit: 'crown' } },
  { level: 3, need: 35, name: '熟悉腳步', reward: { act: 'water' } },
  { level: 4, need: 70, name: '並肩小坐', reward: { outfit: 'straw' } },
  { level: 5, need: 115, name: '安心相伴', reward: { act: 'sit' } },
  { level: 6, need: 170, name: '分享日常', reward: { outfit: 'kitsune' } },
  { level: 7, need: 240, name: '默契漸深', reward: { act: 'gift' } },
  { level: 8, need: 320, name: '心事相託', reward: { outfit: 'hachimaki' } },
  { level: 9, need: 410, name: '無話不談', reward: { outfit: 'kanzashi' } },
  { level: 10, need: 520, name: '最好的朋友', reward: { outfit: 'wagasa' } },
]

// 衣裝（模型在 scene/outfits.js）。none = 只戴原本的季節小花髮飾
export const OUTFITS = [
  { key: 'none', name: '季節髮飾', jp: 'いつもの', desc: '頭上那朵小花，會跟著季節換顏色。' },
  { key: 'crown', name: '花冠', jp: 'はなかんむり', desc: '小花繞成一圈，輕輕停在圓圓的頭頂。' },
  { key: 'straw', name: '麥稈草帽', jp: 'むぎわらぼうし', desc: '麥稈織成小草帽，頭頂多了一片涼蔭。' },
  { key: 'kitsune', name: '狐狸面具', jp: 'きつねのおめん', desc: '白色小狐面輕輕一戴，探頭看看花圃。' },
  { key: 'hachimaki', name: '日式頭帶', jp: 'はちまき', desc: '白頭帶輕輕繫好，前額留著一輪紅日。' },
  { key: 'kanzashi', name: '星星髮簪', jp: 'ほしのかんざし', desc: '一顆小星星別在頭邊，走動時輕輕晃。' },
  { key: 'wagasa', name: '紅色和傘', jp: 'あかいわがさ', desc: '撐開一把小紅傘，把細雨聲留在傘面。' },
]
export const outfitOf = (key) => OUTFITS.find((o) => o.key === key)

// 解鎖的新動作
export const BOND_ACTS = {
  water: { name: '花間澆水', desc: '偶爾跳進花圃，替你的花澆上一點清水。' },
  sit: { name: '並肩專注', desc: '專注時坐到那件任務的花旁，安靜陪著你。' },
  gift: { name: '每日小禮', desc: '每天初次來訪，送你幾顆收在掌心的金平糖。' },
}

// 解鎖某個動作或衣裝需要的好感度等級
export const actLevel = (act) => BOND_LEVELS.find((l) => l.reward?.act === act)?.level ?? 99
export const outfitLevel = (key) => (key === 'none' ? 1 : (BOND_LEVELS.find((l) => l.reward?.outfit === key)?.level ?? 99))

export function bondLevel(pts) {
  let cur = BOND_LEVELS[0]
  for (const l of BOND_LEVELS) if (pts >= l.need) cur = l
  const next = BOND_LEVELS[cur.level] || null
  return { ...cur, pts, next: next?.need ?? null }
}
