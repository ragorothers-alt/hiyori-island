// 生活記錄的種類：一個漢字當印章
export const LIFE_KINDS = [
  { key: 'meal', kanji: '食', label: '飲食', color: '#f5b38e', hint: '吃了什麼？' },
  { key: 'move', kanji: '動', label: '運動', color: '#93d4b0', hint: '散步、伸展、跑步…' },
  { key: 'mood', kanji: '心', label: '心情', color: '#f4b2c5', hint: '現在的心情' },
  { key: 'spend', kanji: '錢', label: '花費', color: '#f3cf7f', hint: '買了什麼？' },
  { key: 'rest', kanji: '憩', label: '休息', color: '#9fd6d4', hint: '午睡、發呆、泡茶…' },
  { key: 'note', kanji: '記', label: '筆記', color: '#b9a7e6', hint: '想記下的事' },
]
export const lifeKindOf = (key) => LIFE_KINDS.find((k) => k.key === key) || LIFE_KINDS[LIFE_KINDS.length - 1]

// 今天的精神／體力：1～5
export const ENERGY = ['', '好累', '有點累', '普通', '不錯', '元氣滿滿']
// 精神 1–5 的顏色：好累（灰藍）→ 元氣滿滿（櫻色）
export const ENERGY_COLORS = ['', '#a9b8d6', '#98cbe0', '#9fd6b8', '#f1c97c', '#f3a0b8']
// 那天的精神和一路記下的心情（生活記錄的「心」，照時間排）：今日反思、小日記寫回顧時一起看
export const feelOf = (day) => ({ energy: Math.round(day?.energy) || 0, moods: (day?.items || []).filter((x) => x.kind === 'mood' && x.text) })
