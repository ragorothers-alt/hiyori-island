// 同步的上限（index.js 用）。放在這裡而不是 index.js：Worker 的主檔匯出的東西都會被當成進入點，
// 匯出一般的數字會讓本機的 wrangler dev 開不起來

// base64 字元數；D1 每列上限 2 MB
export const MAX_DATA = 1_500_000
// 被大量亂建 vault 時的保護（可以用 [vars] 改）：一天最多建立幾個、整個資料庫最多放多少（base64 字元數）。
// 擋的是新建立，已經在用的 vault 照常同步
export const CREATE_DAILY = 300
export const MAX_TOTAL = 400_000_000
// 舊的 vault（加上 auth 以前建的）到這天以前，第一次帶 auth 寫入時記下那一把；之後還沒記的就不再收寫入
// （只知道 vault id 的人不能再趁還沒記下時搶先登記）。可以用 [vars] LEGACY_UNTIL（毫秒）改
export const LEGACY_UNTIL = Date.UTC(2027, 0, 1)
