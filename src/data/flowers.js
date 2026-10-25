// 花の図鑑：任務完成時開出的花。稀有度與出現條件在這裡定義。
// look：shape 花瓣形狀（round／pointed／heart／thin／star）、petals 每層片數、inner 內層片數（0 = 單層）、
//       colors [外層, 內層]、core 花心、glow 夜光強度、open 綻放後花瓣仰角（越大越像杯狀）、size 整體大小、rainbow 七彩花瓣
// when(c)：這朵花在什麼情況下有機會開。c = { tag, priority, star, pomos, hour, season, streak, late, perfect, routine }

export const RARITIES = {
  common: { label: '常見', chance: 1, color: '#9fb0c4' },
  uncommon: { label: '少見', chance: 0.25, color: '#76c3a0' },
  rare: { label: '稀有', chance: 0.07, color: '#7fa9e6' },
  legend: { label: '傳說', chance: 0.015, color: '#eab04f' },
}
export const RARITY_ORDER = ['legend', 'rare', 'uncommon', 'common']

const night = (h) => h >= 20 || h < 4

export const FLOWERS = [
  // ── 常見：依分類，外觀沿用分類顏色 ──
  { key: 'kikyo', rarity: 'common', name: '桔梗', jp: 'ききょう', desc: '五角形的星形花瓣，靜靜地、筆直地向上開。', hint: '完成「工作」任務', when: (c) => c.tag === 'work',
    look: { shape: 'pointed', petals: 5, colors: ['#8ec5e8', '#cfe7f6'], core: '#f4f0d0' } },
  { key: 'sumire', rarity: 'common', name: '菫', jp: 'すみれ', desc: '低低地開在路邊，安靜卻很耐看。', hint: '完成「學習」任務', when: (c) => c.tag === 'study',
    look: { shape: 'round', petals: 5, colors: ['#b9a7e6', '#e4dbf7'], core: '#ffe08a' } },
  { key: 'nadeshiko', rarity: 'common', name: '撫子', jp: 'なでしこ', desc: '花瓣邊緣細細碎碎，像被輕輕撫過。', hint: '完成「生活」任務', when: (c) => c.tag === 'life',
    look: { shape: 'heart', petals: 5, colors: ['#f5adc2', '#fde1ea'], core: '#fff3c4' } },
  { key: 'shirotsume', rarity: 'common', name: '白詰草', jp: 'しろつめくさ', desc: '一團圓圓的小白花，草地上最常見的朋友。', hint: '完成「健康」任務', when: (c) => c.tag === 'health',
    look: { shape: 'thin', petals: 14, colors: ['#e9f6e8', '#93d4b0'], core: '#c8ebd2', open: 0.55 } },
  { key: 'nanohana', rarity: 'common', name: '菜の花', jp: 'なのはな', desc: '小小的四瓣黃花，一開就是一整片春天。', hint: '完成「靈感」任務', when: (c) => c.tag === 'idea',
    look: { shape: 'round', petals: 4, colors: ['#f3cf7f', '#fbe8b5'], core: '#f0b955' } },

  // ── 少見 ──
  { key: 'asagao', rarity: 'uncommon', name: '牽牛花', jp: 'あさがお', desc: '薄薄的花瓣捲成小喇叭，盛著清晨的光。', hint: '清晨五點起，九點前收尾', when: (c) => c.hour >= 5 && c.hour < 9,
    look: { shape: 'round', petals: 5, colors: ['#8fa8f0', '#eef1ff'], core: '#ffffff', open: 0.9 } },
  { key: 'tsukimiso', rarity: 'uncommon', name: '月見草', jp: 'つきみそう', desc: '淡黃花瓣在夜色裡舒展，像一盞小燈。', hint: '晚八點起，晨四點前收尾', when: (c) => night(c.hour),
    look: { shape: 'heart', petals: 4, colors: ['#fff1a8', '#fffbe0'], core: '#f6d873', glow: 0.7 } },
  { key: 'sakurasou', rarity: 'uncommon', name: '櫻草', jp: 'さくらそう', desc: '粉色花瓣圍成小小一圈，春風來就輕搖。', hint: '春風裡，完成手邊的小事', when: (c) => c.season === 'spring',
    look: { shape: 'heart', petals: 5, colors: ['#f7b6cf', '#ffe3ee'], core: '#fff4c9' } },
  { key: 'himawari', rarity: 'uncommon', name: '向日葵', jp: 'ひまわり', desc: '金黃花瓣圍著圓圓花心，把夏日的光留住。', hint: '夏日蟬聲裡收好一件事', when: (c) => c.season === 'summer',
    look: { shape: 'thin', petals: 16, colors: ['#f6cf5a', '#f9de86'], core: '#9c6d4c', size: 1.15 } },
  { key: 'kosumosu', rarity: 'uncommon', name: '波斯菊', jp: 'コスモス', desc: '細細花莖托著粉色花瓣，在秋風裡輕輕搖。', hint: '秋風拂過，手邊小事收尾', when: (c) => c.season === 'autumn',
    look: { shape: 'pointed', petals: 8, colors: ['#f19bc0', '#fbd6e6'], core: '#f6cf5a' } },
  { key: 'tsubaki', rarity: 'uncommon', name: '山茶花', jp: 'つばき', desc: '層層紅花瓣攏著金黃花心，冬天也暖暖的。', hint: '冬日冷風裡完成一件事', when: (c) => c.season === 'winter',
    look: { shape: 'round', petals: 6, inner: 5, colors: ['#e9707f', '#fbd0d6'], core: '#f8d36c' } },
  { key: 'hasu', rarity: 'uncommon', name: '蓮花', jp: 'はす', desc: '粉白花瓣一層層舒開，像把安靜捧在掌心。', hint: '完成綁過番茄鐘的任務', when: (c) => c.pomos >= 1,
    look: { shape: 'pointed', petals: 8, inner: 6, colors: ['#f8c6d6', '#fff0f4'], core: '#f4dc7a', open: 0.75 } },
  { key: 'tanpopo', rarity: 'uncommon', name: '蒲公英', jp: 'たんぽぽ', desc: '細細黃花瓣擠成一團，小事也有自己的光。', hint: '輕輕收好低優先的小事', when: (c) => c.priority === 1,
    look: { shape: 'thin', petals: 18, colors: ['#f7d35e', '#fbe594'], core: '#f2c240', size: 0.9 } },
  { key: 'ajisai', rarity: 'uncommon', name: '繡球花', jp: 'あじさい', desc: '藍紫小花挨著彼此，聚成一團柔柔的雲。', hint: '讓一件例行任務開花', when: (c) => c.routine,
    look: { shape: 'round', petals: 12, inner: 8, colors: ['#a9b8f0', '#d7c9f3'], core: '#c9d6fa', open: 0.6 } },
  { key: 'ayame', rarity: 'uncommon', name: '鳶尾花', jp: 'あやめ', desc: '紫色花瓣輕輕展開，像風裡一隻停住的蝶。', hint: '把高優先的事穩穩收好', when: (c) => c.priority === 3,
    look: { shape: 'pointed', petals: 6, colors: ['#9a8fe0', '#f5e7a8'], core: '#f3d36b', open: 0.15 } },

  // ── 稀有 ──
  { key: 'kinsenka', rarity: 'rare', name: '金盞花', jp: 'きんせんか', desc: '細長花瓣疊成金色圓盤，把心上的事照亮。', hint: '選作本命的小事完成時', when: (c) => c.star,
    look: { shape: 'thin', petals: 14, inner: 10, colors: ['#f7b552', '#fbd98c'], core: '#e8913f', glow: 0.4 } },
  { key: 'higanbana', rarity: 'rare', name: '彼岸花', jp: 'ひがんばな', desc: '纖細紅花瓣向外彎起，在秋風裡織一圈光。', hint: '秋日裡，收好高優先的事', when: (c) => c.season === 'autumn' && c.priority === 3,
    look: { shape: 'thin', petals: 6, colors: ['#e8556a', '#f48b98'], core: '#e8556a', open: -0.25, size: 1.1 } },
  { key: 'botan', rarity: 'rare', name: '牡丹', jp: 'ぼたん', desc: '粉色花瓣層層交疊，像慢慢展開的一封信。', hint: '完成累計兩回以上番茄鐘的任務', when: (c) => c.pomos >= 2,
    look: { shape: 'round', petals: 10, inner: 8, colors: ['#f5a3b8', '#ffd9e2'], core: '#ffe9a6', open: 0.55, size: 1.2 } },
  { key: 'suisen', rarity: 'rare', name: '水仙', jp: 'すいせん', desc: '白色花瓣托著金色小盞，替冷天添些暖意。', hint: '冬日早上十點前收好小事', when: (c) => c.season === 'winter' && c.hour < 10,
    look: { shape: 'pointed', petals: 6, inner: 6, colors: ['#fffdf5', '#f7d24f'], core: '#f2b93a' } },
  { key: 'yuri', rarity: 'rare', name: '百合', jp: 'ゆり', desc: '潔白花瓣輕輕仰起，像替相伴的日子留白。', hint: '每天完成任務，連續七天以上', when: (c) => c.streak >= 7,
    look: { shape: 'pointed', petals: 6, colors: ['#fffaf0', '#fde7ef'], core: '#f1c35b', open: 0.8, size: 1.15 } },
  { key: 'gekkabijin', rarity: 'rare', name: '曇花', jp: '月下美人', desc: '層層白瓣在深夜裡舒開，把月光輕輕捧起。', hint: '晚十至晨二點前，本命或綁過番茄鐘', when: (c) => (c.hour >= 22 || c.hour < 2) && (c.star || c.pomos >= 1),
    look: { shape: 'pointed', petals: 12, inner: 8, colors: ['#ffffff', '#f3f7ff'], core: '#fff3c0', glow: 1 } },
  { key: 'yotsuba', rarity: 'rare', name: '四葉幸運草', jp: 'よつばのクローバー', desc: '四片心形綠葉靠在一起，藏著剛好的幸運。', hint: '每件小事，都可能藏著幸運', when: () => true,
    look: { shape: 'heart', petals: 4, colors: ['#8fd49a', '#c6ecc9'], core: '#b4e3a6' } },
  { key: 'fuji', rarity: 'rare', name: '紫藤', jp: 'ふじ', desc: '淡紫花瓣低低垂成花串，晚些開也很溫柔。', hint: '錯過期限的小事，也完成了', when: (c) => c.late >= 1,
    look: { shape: 'pointed', petals: 10, inner: 6, colors: ['#b8a3e8', '#e3d8f8'], core: '#f6e6a3', open: -0.1 } },

  // ── 傳說 ──
  { key: 'niji', rarity: 'legend', name: '虹之花', jp: 'にじのはな', desc: '七片彩色花瓣圍成一圈，把虹留在小島上。', hint: '每件小事，都可能遇見奇蹟', when: () => true,
    look: { shape: 'round', petals: 7, colors: ['#ffffff', '#ffffff'], core: '#fff6d8', rainbow: true, glow: 0.5, size: 1.15 } },
  { key: 'hoshibana', rarity: 'legend', name: '星燈花', jp: 'ほしあかりのはな', desc: '小小花瓣在夜裡發亮，像星星落在花圃裡。', hint: '晚八至晨四點前，收好本命', when: (c) => night(c.hour) && c.star,
    look: { shape: 'star', petals: 5, inner: 5, colors: ['#fff6c8', '#ffe27a'], core: '#ffffff', glow: 1.4, size: 1.15 } },
  { key: 'kinzakura', rarity: 'legend', name: '金霞櫻', jp: 'きんがすみざくら', desc: '金色櫻瓣緩緩舒開，像把好日子輕輕收好。', hint: '今天完美收尾，或連續滿三十天', when: (c) => c.perfect || c.streak >= 30,
    look: { shape: 'heart', petals: 5, inner: 5, colors: ['#f6cf6a', '#fff0b8'], core: '#ffffff', glow: 0.9, size: 1.2 } },
]

export const flowerOf = (key) => FLOWERS.find((f) => f.key === key)
export const COMMON_BY_TAG = { work: 'kikyo', study: 'sumire', life: 'nadeshiko', health: 'shirotsume', idea: 'nanohana' }

function hash01(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000003) / 1000003
}

// 決定開出哪一朵花：同一個任務永遠開出同一朵（seed 用任務 id），本命任務的稀有機率加倍。
// 抽到的稀有度若沒有符合條件的花，就往下一級找。
export function rollFlower(c, seed) {
  const r = hash01(seed + ':rarity')
  const pick = hash01(seed + ':kind')
  const boost = c.star ? 2 : 1
  let start = RARITY_ORDER.length - 1
  let acc = 0
  for (let i = 0; i < RARITY_ORDER.length - 1; i++) {
    acc += RARITIES[RARITY_ORDER[i]].chance * boost
    if (r < acc) {
      start = i
      break
    }
  }
  for (let i = start; i < RARITY_ORDER.length; i++) {
    const pool = FLOWERS.filter((f) => f.rarity === RARITY_ORDER[i] && f.when(c))
    if (pool.length) return pool[Math.floor(pick * pool.length)].key
  }
  return COMMON_BY_TAG[c.tag] || 'nadeshiko'
}
