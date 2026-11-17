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
只想重跑幾個情境時設 `$env:HIYORI_ONLY = '早晨,排下一週'`（標題含這幾個字的才跑，逗號分開）。

不用通行碼也能檢查腳本：

```powershell
$env:HIYORI_AI_DRY = '1'
npm run try:fuji
Remove-Item Env:HIYORI_AI_DRY
```

DRY 完全不連網，用空動作回應跑完資料整理、清洗、套用、撤銷與報告。它不能證明 Claude 的回答品質或真實動作能撤銷。沒有通行碼且沒開 DRY 時整組跳過。

真實模式依序送出 25 句對話與 4 次 morning、capture、evening，共 31 次 Worker 請求，會計入 Worker 每日上限；Worker 內部可能重試 Claude。每次最多等 210 秒，失敗也繼續下一句；只有被 Worker 每分鐘的次數上限擋下（429 too many requests）時，等 65 秒再送（最多兩次）。

每句使用同一份範例島 JSON 重建獨立 Store，各情境透過 prepare 額外準備任務、習慣與打卡、專案、先記下來的事、匯入日程或撤銷紀錄；使用當下真實時間。不會操作瀏覽器裡的小島。自動檢查回話與實際變更，仍需人工閱讀內容判斷品質。多輪情境用 extra.history 傳入前文；新增情境的日期依 store.today 推算，不固定年份。

完整 Markdown（送出資料、Worker 原始 JSON、清洗後動作、變更、撤銷差異與錯誤）寫到系統暫存目錄的 `hiyori-fuji-live.md`（`HIYORI_AI_DRY=1` 的是 `hiyori-fuji-live-dry.md`，不會蓋掉真的那份），最後會印完整路徑；每次覆寫，需保留請自行複製。通行碼不存檔、不印出；報告中的回應若含通行碼也會遮蔽。

撤銷比較包含任務、日程、專案、習慣、設定、作息等內容，忽略時間戳、統計／獎勵進度、同步版本與 agent 紀錄，但保留 agent.memory。列表順序也比較；差異不會讓報告測試失敗，腳本本身出錯才會失敗。清洗數量以整個動作為單位，欄位被修正或部分刪除請對照原始與清洗 JSON。

平常 `npx vitest run` 只收 `tests/**/*.test.js`，不會執行這份 live 報告。

## 自動檢查與情境期待

`live/checks.js` 是不寫資料、不連網的純函式。套用後、撤銷前執行 slot、fill、due、sample、weekday、say、dropped；撤銷後補 undo。每項回傳 `{ id, ok, detail }`：

- slot：這次實際排入時段的任務不撞非全天日程（包含匯入日程）或其他未完成任務；自己整理另檢查起床／就寢與三餐。未填 dur 一律以 30 分鐘計，端點相接不算重疊。
- fill：自己整理中新排入時段的普通任務，每日不超過送出資料 free 總分鐘的七成加 15 分鐘；本命與 priority 3 排除，原已有時段的重排不計。
- due：自己整理動過或新增的任務（含分段）不能超過截止日。
- sample：自己整理不能替送出資料標為 sample 的範例專案新增任務、里程碑細項或本命；套用前保留真實專案 id，避免名稱或 mine 變動影響判斷。
- weekday：檢查回話中日期附星期的常見寫法，以及今天／明天括號中的日期；使用離 today 最近且前後半年內的有效年份，包含跨年。
- say：原始回話 chat 最多 200 字，其他最多 90 字，空字串略過；不能含 JSON 或單一英文字母接數字的代號。
- dropped：清洗丟掉的動作數必須為零（包含 split）。
- undo：使用現有 comparable 比較撤銷前後資料是否一致。

情境可加 `expect({ store, result, data, act, entry })`，在撤銷前回傳同格式的陣列。只回答的情境使用 appliedDiff 檢查資料不動，允許 next 導覽建議；模糊要求與大量刪習慣另檢查提問與可點回答。其餘期待涵蓋多輪改下午、習慣打卡、截止日、急件優先、筆記轉任務、尊重撤銷、不刪任務、中英混用與專注進度。

報告總表「檢查」欄全過顯示 ✓，否則列出 ✗ 與項目名；總表下面集中列失敗原因，每個情境詳細段落列出全部檢查。終端最後印「檢查：N 項不通過」。檢查失敗不讓 Vitest 失敗，只有腳本故障會失敗。DRY 為空動作，需要打卡、排程、追問或新增資料的 expect 失敗是正常的。

離線驗證：

```powershell
npx vitest run tests/liveChecks.test.js
$env:HIYORI_AI_DRY='1'
npx vitest run --config vitest.live.config.js
Remove-Item Env:HIYORI_AI_DRY
npx vitest run
```

檢查是規則近似：slot 不檢查額外 buffer、以 awake 的午夜截斷規則處理跨夜，且依需求連已完成的非全天日程也算衝突；fill 使用請求前 free，未列出的日期視為沒有空檔；weekday 只辨識列出的日期寫法。代號檢查可能把 A1 等自然名稱當成 id，JSON 外觀也可能是使用者引用的內容。expect 的問句、能力說明與任務名稱比對是啟發式，需配合報告人工確認。undo 仍沿用既有忽略欄位，並非逐位元還原整份 state。
