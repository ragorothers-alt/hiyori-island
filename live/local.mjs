// 用本機的 Worker 試ふじ一輪：npm run try:fuji:local
// Claude API 金鑰放在 worker/.dev.vars（自己放，一行 ANTHROPIC_API_KEY=…；已經在 .gitignore 裡，不會進版本庫）。
// 這個腳本不讀出、不印出金鑰，只檢查那一行在不在。本機 Worker 的通行碼每次臨時產生一個，只放在記憶體裡、用完就丟，
// 跟線上的通行碼無關。線上的 Worker、線上的資料都不會碰到（資料庫是 wrangler 在本機模擬的那一份）。
// 會花 Claude API 的額度（跟 npm run try:fuji 一樣，大約 17 次呼叫）。
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const workerDir = join(root, 'worker')
const vars = join(workerDir, '.dev.vars')
const PORT = Number(process.env.HIYORI_LOCAL_PORT) || 8799
const base = `http://127.0.0.1:${PORT}`
const logPath = join(tmpdir(), 'hiyori-wrangler-dev.log')
const win = process.platform === 'win32'

const stop = (msg) => {
  console.error(`\n${msg}`)
  process.exit(1)
}

// 金鑰檔：要有、要被 git 忽略、裡面要有 ANTHROPIC_API_KEY 那一行（只看在不在，不讀出值）
if (!existsSync(vars)) {
  stop(`找不到 worker/.dev.vars。自己建一個，裡面一行：\n  ANTHROPIC_API_KEY=你的 Claude API 金鑰\n（這個檔案不會進版本庫）`)
}
if (spawnSync('git', ['check-ignore', '-q', vars], { cwd: root }).status !== 0) {
  stop('worker/.dev.vars 沒有被 .gitignore 排除，先停下來（不要讓金鑰進版本庫）')
}
const text = readFileSync(vars, 'utf8')
if (!/^\s*ANTHROPIC_API_KEY\s*=\s*\S/m.test(text)) stop('worker/.dev.vars 裡沒有 ANTHROPIC_API_KEY=… 那一行')
if (/^\s*AI_PASS\s*=/m.test(text)) stop('worker/.dev.vars 裡不要放 AI_PASS（本機的通行碼由這個腳本臨時產生），把那一行拿掉再跑')

// Windows 的 npx 要經過 shell：整句自己拼好（參數都是固定的字、沒有空白），不讓 Node 警告沒跳脫
const line = (cmd, args) => (win ? [[cmd, ...args].join(' '), []] : [cmd, args])
const run = (cmd, args, opts = {}) => spawnSync(...line(cmd, args), { shell: win, ...opts })

// 本機模擬的資料庫：先把資料表建好（只動 .wrangler 裡本機的那一份）
console.log('準備本機資料庫…')
const mig = run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'hiyori-sync', '--local'], { cwd: workerDir, env: { ...process.env, CI: '1' }, encoding: 'utf8' })
if (mig.status !== 0) stop(`本機資料庫準備失敗：\n${(mig.stderr || mig.stdout || '').slice(-1500)}`)

const pass = randomBytes(24).toString('base64url')
const log = openSync(logPath, 'w')
console.log(`啟動本機 Worker（${base}，紀錄在 ${logPath}）…`)
const dev = spawn(...line('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(PORT), '--var', `AI_PASS:${pass}`]), {
  cwd: workerDir, shell: win, stdio: ['ignore', log, log], env: { ...process.env, CI: '1' },
})
const kill = () => {
  if (dev.exitCode != null) return
  if (win) spawnSync('taskkill', ['/pid', String(dev.pid), '/T', '/F'], { stdio: 'ignore' })
  else dev.kill('SIGTERM')
}
process.on('exit', kill)
process.on('SIGINT', () => process.exit(130))

let code = 1
try {
  // 等它開好（最多 90 秒）
  const until = Date.now() + 90_000
  for (;;) {
    if (dev.exitCode != null) stop(`本機 Worker 沒開起來，看一下 ${logPath}`)
    try {
      await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) })
      break
    } catch {}
    if (Date.now() > until) stop(`本機 Worker 90 秒內沒開好，看一下 ${logPath}`)
    await new Promise((r) => setTimeout(r, 1000))
  }
  // 通行碼和金鑰都接上了：/v1/ai 的 ping 只查模型資料，不花 token
  const ping = await fetch(`${base}/v1/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${encodeURIComponent(pass)}` },
    body: JSON.stringify({ task: 'ping' }),
  }).then((r) => r.json()).catch((e) => ({ error: e.message }))
  if (!ping.ok) stop(`本機 Worker 連不上 Claude：${ping.error || '不明'}${ping.detail ? `（${ping.detail}）` : ''}。金鑰對嗎？`)
  console.log(`本機 Worker 好了（模型 ${ping.model}），開始試ふじ…\n`)
  const r = run('npx', ['vitest', 'run', '--config', 'vitest.live.config.js'], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, HIYORI_AI_PASS: pass, VITE_SYNC_API: base, HIYORI_AI_TARGET: 'local' },
  })
  code = r.status ?? 1
} finally {
  kill()
  closeSync(log)
}
process.exit(code)
