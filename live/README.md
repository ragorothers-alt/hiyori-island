# 真的和ふじ聊一輪

在專案根目錄用 PowerShell 7 執行（需要已安裝專案依賴）：

```powershell
$env:HIYORI_AI_PASS = Read-Host -MaskInput '通行碼'
npm run try:fuji
Remove-Item Env:HIYORI_AI_PASS
```

## 用本機的 Worker（不用線上的通行碼）

把 Claude API 金鑰放在 `worker/.dev.vars`（自己建，一行 `ANTHROPIC_API_KEY=…`；這個檔案在 `.gitignore` 裡，不會進版本庫），然後：

```powershell
npm run try:fuji:local
```

`live/local.mjs` 會先確認 `.dev.vars` 被 git 忽略、裡面有那一行（不讀出、不印出金鑰），建好本機模擬的資料庫，用 `wrangler dev` 在 `127.0.0.1:8799` 開一個本機 Worker，通行碼每次臨時產生（只在記憶體裡、跟線上的無關），先 ping 一次確認接上 Claude，再跑下面同一份試跑。線上的 Worker 和資料都不會碰到；本機模式下要送去的網址不是本機就直接停。`.dev.vars` 裡不要放 `AI_PASS`。花的是那把金鑰的額度。

## 用線上的 Worker

可先設 `$env:HIYORI_AI_MODEL = 'claude-sonnet-5-5'` 選模型；只接受 `claude-opus-5-5`（預設）、`claude-sonnet-5-5`、`claude-haiku-5-5`。

不用通行碼也能檢查腳本：

```powershell
$env:HIYORI_AI_DRY = '1'
npm run try:fuji
Remove-Item Env:HIYORI_AI_DRY
```

DRY 完全不連網，用空動作回應跑完資料整理、清洗、套用、撤銷與報告。它不能證明 Claude 的回答品質或真實動作能撤銷。沒有通行碼且沒開 DRY 時整組跳過。

真實模式依序送出 15 句對話與 morning、capture，共 17 次 Worker 請求，會計入 Worker 每日上限；Worker 內部可能重試 Claude。每次最多等 210 秒，失敗也繼續下一句，沒有腳本自動重試。

每句使用同一份範例島 JSON 重建獨立 Store，改牙醫時間與 capture 額外準備資料；使用當下真實時間。不會操作瀏覽器裡的小島。請檢查回話、清掉的動作與實際變更；問答、一次大量刪除、模糊要求的預期也列在報告供人判斷，不作通過斷言。

完整 Markdown（送出資料、Worker 原始 JSON、清洗後動作、變更、撤銷差異與錯誤）寫到系統暫存目錄的 `hiyori-fuji-live.md`（`HIYORI_AI_DRY=1` 的是 `hiyori-fuji-live-dry.md`，不會蓋掉真的那份），最後會印完整路徑；每次覆寫，需保留請自行複製。通行碼不存檔、不印出；報告中的回應若含通行碼也會遮蔽。

撤銷比較包含任務、日程、專案、習慣、設定、作息等內容，忽略時間戳、統計／獎勵進度、同步版本與 agent 紀錄，但保留 agent.memory。列表順序也比較；差異不會讓報告測試失敗，腳本本身出錯才會失敗。清洗數量以整個動作為單位，欄位被修正或部分刪除請對照原始與清洗 JSON。

平常 `npx vitest run` 只收 `tests/**/*.test.js`，不會執行這份 live 報告。
