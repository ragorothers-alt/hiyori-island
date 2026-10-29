// もち和ふじ共同的好感度：摸摸、專注、回顧、每天來看看她們都會累積。每升一級解鎖一件衣裝（兩人都能穿）或一個新動作。

// 每次加多少（摸摸一天最多算 petDailyMax 次）
export const BOND_POINTS = { visit: 2, pet: 1, petDailyMax: 5, pomodoro: 3, review: 4, starAll: 3, habitAll: 2 }

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
  { key: 'none', name: '季節髮飾', jp: 'いつもの', desc: '耳邊的小櫻花，隨著季節悄悄換色。' },
  { key: 'crown', name: '花冠', jp: 'はなかんむり', desc: '小花沿著髮梢綻放，貓耳也探出來賞花。' },
  { key: 'straw', name: '麥稈草帽', jp: 'むぎわらぼうし', desc: '兩耳間的小草帽，繫著出遊的好心情。' },
  { key: 'kitsune', name: '狐狸面具', jp: 'きつねのおめん', desc: '小狐面斜掛髮側，露出祭典裡的笑臉。' },
  { key: 'hachimaki', name: '日式頭帶', jp: 'はちまき', desc: '繫好額前的頭帶，今天也一起加油。' },
  { key: 'kanzashi', name: '星星髮簪', jp: 'ほしのかんざし', desc: '星星別在耳邊，垂下兩串溫柔的星光。' },
  { key: 'wagasa', name: '紅色和傘', jp: 'あかいわがさ', desc: '小手握著紅和傘，陪你走過晴天細雨。' },
]
export const outfitOf = (key) => OUTFITS.find((o) => o.key === key)

// 解鎖的新動作
export const BOND_ACTS = {
  water: { name: '花間澆水', desc: 'もち偶爾跑進花圃，替你的花澆上一點清水。' },
  sit: { name: '並肩專注', desc: '專注時兩人坐在小木屋紙窗邊，影子映在窗上陪著你。' },
  gift: { name: '每日小禮', desc: 'ふじ每天在你初次來訪時，送上幾顆收在掌心的金平糖。' },
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
