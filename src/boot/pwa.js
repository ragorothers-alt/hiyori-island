// PWA：正式版註冊 Service Worker（開發時不註冊，避免快取干擾）、開著的時候部署了新版就重新整理（或問一聲）、
// 請瀏覽器保留這個網站的資料、「安裝到桌面」那一列（從 main.js 搬過來）
// 部署新版後自動重新整理過的時間（sessionStorage）：短時間內不重複整理
const RELOADED_KEY = 'hiyori-reloaded'
// 已經請過瀏覽器保留資料（不會跳出詢問的瀏覽器以外，只請一次）
const PERSIST_KEY = 'hiyori-persist-asked'

export function installPwa({ store, ui }) {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[hiyori] SW 註冊失敗', e))
  }
  // 開著的時候部署了新版：新的 Service Worker 接手後清掉了舊版的檔案，伺服器上也換成新的了，
  // 這個舊頁面第一次要載入的畫面（切回小島、日曆…）會找不到。重新整理一次換成新版；
  // 離線時不試（那是真的連不上），30 秒內也只試一次，免得一直重新整理
  // 存檔沒寫進去（空間滿了）或手上有打到一半的字時不自動重新整理：留一顆按鈕，讓使用者收好再按
  // updateAsked：問過一次了（之後都改成問，不自動重新整理）；同一張還在畫面上就不再跳一張，收掉了再遇到時再問
  let updateAsked = false
  let askEl = null
  const askUpdate = (saved) => {
    updateAsked = true
    if (askEl?.isConnected) return
    const draft = saved && ui.hasDraft()
    askEl = ui.toast({
      icon: '新', title: '有新版本了', ms: 30000,
      sub: !saved ? '這次的變更沒能存進去（空間可能滿了），先到「設定」匯出資料再重新整理' : draft ? '手上還有沒打完的字，收好再按「重新整理」' : '按「重新整理」換上新版',
      // 跟其他「重新載入」同一顆：存不進去時不載入。這張已經說了「收好再按」的，按了就換；
      // 沒說的（那時手上沒字），之後才打了字再按的話照樣先問
      action: { label: '重新整理', run: () => ui._reloadApp({ force: draft }) },
    })
  }
  addEventListener('vite:preloadError', (e) => {
    if (!navigator.onLine) return
    let last = 0
    try {
      last = Number(sessionStorage.getItem(RELOADED_KEY)) || 0
    } catch {}
    if (Date.now() - last < 30000) return
    // 載入失敗的那幾處看到這個就不再叫人「連上網路」
    if (e.payload) e.payload.updating = true
    const safe = () => store.flushSave() !== false && !ui.hasDraft()
    if (updateAsked || !safe()) return askUpdate(store.flushSave() !== false)
    try {
      sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
    } catch {}
    ui.toast({ icon: '新', title: '有新版本了', sub: '重新整理一下，換上新版…' })
    // 等的這一下又開始打字：改成問
    setTimeout(() => (safe() ? location.reload() : askUpdate(store.flushSave() !== false)), 1200)
  })
  // 請瀏覽器在空間吃緊時不要清掉這個網站的資料（iPhone 沒加到主畫面時，Safari 也可能把太久沒開的網站資料清掉）。
  // Chrome 系和安裝成 App 時不會跳出詢問，開機就請；其他瀏覽器（Safari 一般分頁、Firefox 會跳出權限詢問）
  // 等到第一次動手加了自己的東西（不只範例）時才請，只請一次：那時正在操作，詢問也看得懂是為了什麼
  if (navigator.storage?.persist) {
    const ask = () => navigator.storage.persisted().then((on) => on || navigator.storage.persist()).catch(() => {})
    let asked = false
    try {
      asked = !!localStorage.getItem(PERSIST_KEY)
    } catch {}
    if (navigator.userAgentData || matchMedia('(display-mode: standalone)').matches) ask()
    else if (!asked) {
      const mine = () => {
        const s = store.state
        return s.tasks.length + s.events.length + s.projects.length + s.habits.length > store.sampleCount()
      }
      const off = store.on('dirty', () => {
        if (!mine()) return
        off()
        try {
          localStorage.setItem(PERSIST_KEY, '1')
        } catch {}
        ask()
      })
    }
  }
  // 安裝到桌面：瀏覽器給了安裝的機會（beforeinstallprompt）就是一顆「安裝」；沒給、或按過取消了（瀏覽器不會馬上再給），
  // 那一列照樣留著，改成「怎麼安裝」寫出這個瀏覽器的做法。已經是安裝好的 App（從桌面打開、Android 的 App）不列
  let installEvt = null
  const installRow = document.getElementById('installRow')
  const installBtn = document.getElementById('installBtn')
  const installInfo = installRow.querySelector('small')
  installInfo.setAttribute('aria-live', 'polite')
  const installed = () => !!window.HiyoriNative || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  const showInstall = () => {
    installRow.hidden = installed()
    installBtn.textContent = installEvt ? '安裝' : '怎麼安裝'
    installBtn.classList.toggle('on', !!installEvt)
  }
  showInstall()
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installEvt = e
    showInstall()
  })
  addEventListener('appinstalled', () => {
    installEvt = null
    installRow.hidden = true
    ui.toast({ icon: '島', title: '已安裝到桌面', sub: '之後可以像 App 一樣直接打開小島' })
  })
  installBtn.onclick = async () => {
    if (!installEvt) {
      installInfo.textContent = installSteps(navigator.userAgent, navigator.maxTouchPoints > 1)
      return
    }
    // 先拿走：安裝的視窗還開著時又按一下，不會對同一個事件再叫一次（瀏覽器會丟錯）
    const evt = installEvt
    installEvt = null
    try {
      await evt.prompt()
      await evt.userChoice
    } catch {}
    showInstall()
  }
}

// 這個瀏覽器怎麼安裝成 App（瀏覽器沒給安裝的機會、或按過取消時）
// touch：有觸控（iPad 的 Safari 預設裝成電腦版的樣子，名稱跟 Mac 一樣，只能看有沒有觸控分辨）
export function installSteps(ua = '', touch = false) {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (/Mobile\//.test(ua) || touch))) return '用 Safari 打開這一頁，按下方的「分享」→「加入主畫面」'
  if (/Android/.test(ua)) return '瀏覽器右上角的「⋮」→「安裝應用程式」（或「加到主畫面」）'
  if (/Firefox\//.test(ua)) return 'Firefox 電腦版不能安裝成 App：改用 Chrome 或 Edge 打開這一頁，再按網址列右邊的安裝圖示'
  if (/Safari\//.test(ua) && !/Chrome\/|Edg\//.test(ua)) return 'Safari 選單的「檔案」→「加入 Dock」'
  return '網址列右邊的安裝圖示（或右上角選單裡的「安裝ひより日和」、「將這個網站安裝為應用程式」）'
}
