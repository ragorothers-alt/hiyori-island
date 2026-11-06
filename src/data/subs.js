// 新增訂閱時名稱欄的建議（打字時跳出來），打的名稱對得上時也順便選好分類（還沒自己選過分類時）
export const KNOWN_SUBS = [
  { name: 'Netflix', cat: 'video' },
  { name: 'Disney+', cat: 'video' },
  { name: 'YouTube Premium', cat: 'video' },
  { name: 'Amazon Prime Video', cat: 'video' },
  { name: 'friDay影音', cat: 'video' },
  { name: 'Hami Video', cat: 'video' },
  { name: 'Spotify', cat: 'music' },
  { name: 'Apple Music', cat: 'music' },
  { name: 'KKBOX', cat: 'music' },
  { name: 'YouTube Music', cat: 'music' },
  { name: 'ChatGPT Plus', cat: 'ai' },
  { name: 'Claude Pro', cat: 'ai' },
  { name: 'Gemini', cat: 'ai' },
  { name: 'Microsoft 365', cat: 'ai' },
  { name: 'Adobe Creative Cloud', cat: 'ai' },
  { name: 'Notion', cat: 'ai' },
  { name: 'GitHub Copilot', cat: 'ai' },
  { name: 'iCloud+', cat: 'cloud' },
  { name: 'Google One', cat: 'cloud' },
  { name: 'Dropbox', cat: 'cloud' },
  { name: 'Nintendo Switch Online', cat: 'game' },
  { name: 'PlayStation Plus', cat: 'game' },
  { name: 'Xbox Game Pass', cat: 'game' },
  { name: 'Kindle Unlimited', cat: 'read' },
  { name: 'Readmoo', cat: 'read' },
  { name: 'Duolingo', cat: 'read' },
  { name: '健身房', cat: 'life' },
  { name: 'Uber One', cat: 'life' },
  { name: 'foodpanda pro', cat: 'life' },
  { name: '電信月租', cat: 'life' },
]

// 名稱對得上建議清單的分類（不分大小寫，打了開頭幾個字就算）；對不上是 null
export function guessCat(name) {
  const n = String(name || '').trim().toLowerCase()
  if (n.length < 2) return null
  const hit = KNOWN_SUBS.find((k) => k.name.toLowerCase() === n) || KNOWN_SUBS.find((k) => k.name.toLowerCase().startsWith(n))
  return hit ? hit.cat : null
}
