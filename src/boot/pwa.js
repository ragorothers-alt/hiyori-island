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
  let updateAsked = false
  const askUpdate = (saved) => {
    if (updateAsked) return
    updateAsked = true
    ui.toast({
      icon: '新', title: '有新版本了', ms: 30000,
      sub: saved ? '手上還有沒打完的字，收好再按「重新整理」' : '這次的變更沒能存進去（空間可能滿了），先到「紀錄」匯出備份再重新整理',
      action: { label: '重新整理', run: () => { store.flushSave(); location.reload() } },
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
  let installEvt = null
  const installRow = document.getElementById('installRow')
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installEvt = e
    installRow.hidden = false
  })
  addEventListener('appinstalled', () => {
    installRow.hidden = true
    ui.toast({ icon: '島', title: '已安裝到桌面', sub: '之後可以像 App 一樣直接打開小島' })
  })
  document.getElementById('installBtn').onclick = async () => {
    if (!installEvt) return
    installEvt.prompt()
    await installEvt.userChoice.catch(() => {})
    installEvt = null
    installRow.hidden = true
  }
}
