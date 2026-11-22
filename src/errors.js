// 沒接住的錯誤：記在這台（最近幾筆，只有訊息、在哪個檔案第幾行、版本和時間，不含任務、筆記這些內容），
// 回報問題時附上（設定裡的「意見回饋」）。開場就壞掉（載入畫面一直不收）時，載入畫面換成「開不起來」，
// 可以重新整理、把存檔原文另存一份、回報。
const KEY = 'hiyori-errors'
const MAX = 8
// 瀏覽器、外掛常見的雜訊和預期中的失敗（離線時抓不到、使用者還沒點過頁面時不能出聲、取消的請求）：不算
const NOISE = /ResizeObserver loop|Script error\.?$|Failed to fetch|NetworkError|Load failed|The user aborted|cancell?ed/i
const BENIGN = new Set(['AbortError', 'NotAllowedError', 'NotSupportedError', 'QuotaExceededError', 'TimeoutError'])

export function readErrors() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => x && typeof x.m === 'string') : []
  } catch {
    return []
  }
}

// 一筆錯誤 → { m: 訊息, w: 檔名:行號 }；不是自己的程式（外掛、別的網站）丟的回 null
function describe(err, file = '', line = 0, always = false) {
  const name = err?.name || ''
  if (BENIGN.has(name)) return null
  const msg = String(err?.message ?? err ?? '').slice(0, 160)
  if (!msg || NOISE.test(msg)) return null
  const stack = String(err?.stack || '')
  // 錯誤是從哪個檔案丟出來的：事件給的檔名，不然看 stack 的第一個「網址:行:欄」（https、外掛的 chrome-extension:// 都算）
  const src = file || stack.match(/[a-z][\w+.-]*:\/\/[^\s)]+?:\d+:\d+/i)?.[0] || ''
  // 外掛（chrome-extension://、moz-extension://）、別的網域的程式：不是我們的
  if (!always && (/-extension:\/\//i.test(src) || (src && !src.startsWith(location.origin)))) return null
  const where = src ? `${src.replace(location.origin, '').replace(/^.*\/assets\//, '').replace(/[?#].*$/, '')}${line && !/:\d+:\d+$/.test(src) ? `:${line}` : ''}` : ''
  return { m: `${name && name !== 'Error' && !msg.startsWith(name) ? `${name}: ` : ''}${msg}`, w: where.slice(0, 80) }
}

// 記下一筆（一樣的訊息只留最新那次）；回傳記了沒有。always：不管是誰丟的都記（開場失敗）
export function noteError(err, { file = '', line = 0, version = '', always = false } = {}) {
  const d = describe(err, file, line, always)
  if (!d) return null
  const list = readErrors().filter((x) => x.m !== d.m)
  list.push({ ...d, v: version, at: Date.now() })
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)))
  } catch {}
  return d
}

// 回報問題時附上的那一段（最近幾筆）
export function errorDigest() {
  return readErrors()
    .slice(-5)
    .map((x) => {
      const d = new Date(x.at)
      return `- ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}・${x.v || '?'}・${x.m}${x.w ? `（${x.w}）` : ''}`
    })
    .join('\n')
}

// 全域：沒接住的錯誤、沒處理的 Promise 拒絕。onNew：這次開啟第一次記到時叫一次（介面說一聲）
export function watchErrors({ version = '', onNew = null } = {}) {
  let told = false
  const got = (d) => {
    if (!d || told) return
    told = true
    onNew?.(d)
  }
  addEventListener('error', (e) => {
    // 圖片、script 載不到的 error 事件沒有 message（target 是那個元素）：不算
    if (!e.message && !e.error) return
    got(noteError(e.error || e.message, { file: e.filename, line: e.lineno, version }))
  })
  addEventListener('unhandledrejection', (e) => got(noteError(e.reason, { version })))
}

// 開場就壞掉：載入畫面還在的話換成「開不起來」，給重新整理、另存存檔、回報
export function bootFailed(err, { version = '', saveKey = '', feedback = '' } = {}) {
  noteError(err, { version, always: true })
  console.error('[hiyori] 開場失敗', err)
  const loader = document.getElementById('loader')
  if (!loader || loader.classList.contains('done')) return false
  loader.classList.add('failed')
  loader.innerHTML = `<div class="loader-mochi"><i></i><i></i></div>
    <p>小島開不起來</p>
    <small>資料都還在這台上。先重新整理看看；還是不行的話，先把存檔另存一份，再回報給我們</small>
    <div class="loader-acts">
      <button type="button" data-boot="reload">重新整理</button>
      <button type="button" data-boot="save">另存存檔</button>
      <button type="button" data-boot="report">回報問題</button>
    </div>`
  loader.addEventListener('click', (e) => {
    const b = e.target.closest('[data-boot]')
    if (!b) return
    if (b.dataset.boot === 'reload') location.reload()
    else if (b.dataset.boot === 'save') {
      let raw = ''
      try {
        raw = localStorage.getItem(saveKey) || ''
      } catch {}
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([raw || '{}'], { type: 'application/json' }))
      a.download = `hiyori-rescue-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } else if (feedback) {
      const body = `## 開不起來\n\n（發生了什麼、在做什麼的時候）\n\n---\n版本：${version}\n畫面：${innerWidth}×${innerHeight}\n最近的錯誤：\n${errorDigest()}`
      window.open(`${feedback}?title=${encodeURIComponent('開不起來：')}&body=${encodeURIComponent(body)}`, '_blank', 'noopener')
    }
  })
  return true
}
