// UI 的方法（從 ui.js 搬過來，掛回 UI.prototype）：設定頁：各項設定、線上同步、資料夾同步、備份和救回來的存檔
import { canHaptics, hapticsOn, IOS } from './haptics.js'
import { dateStr, readRescue, dropRescue } from '../store.js'
import { nativeBack, deskWeb } from '../native.js'
import { $, $$, esc, armConfirm, setHTML, setOn, pickOne, nameToggles } from './dom.js'
import { LATEST } from '../data/latest.js'
import { CloudView } from './cloud.js'
import { readBackups, restoreBackup } from '../sync.js'
import { THEME_INFO, QUALITY_INFO, hhmm } from './shared.js'

export const settingsMethods = {
  // ── 紀錄 ──
  renderSettings() {
    // ふじ的 AI 那一列照現在存著的通行碼畫（別的地方設好的，打開設定就看得到）
    this.aiView?.refresh()
    const on = this.store.state.settings.powerSave
    setOn($('#powerBtn'), on)
    $('#powerBtn').textContent = on ? '開' : '關'
    const theme = this.store.state.settings.theme
    pickOne($$('#themePick button'), (b) => b.dataset.v === theme)
    $('#themeInfo').textContent = THEME_INFO[theme]
    const quality = this.store.state.settings.quality
    pickOne($$('#qualityPick button'), (b) => b.dataset.v === quality)
    $('#qualityInfo').textContent = QUALITY_INFO[quality]
    pickOne($$('#layoutPick button'), (b) => (b.dataset.v === 'app') === !!this.appMode)
    $('#layoutInfo').textContent = this.appMode ? '面板撐滿畫面、小島先休息，像一般 App 一樣用（只改這台裝置）' : '任務在島上開花、兩人在島上陪你（只改這台裝置）'
    const fs = this.store.state.settings.fontScale
    pickOne($$('#fontPick button'), (b) => +b.dataset.v === fs)
    // 震動回饋：手指操作、震得動的裝置才有這一列（每台裝置自己記）
    $('#hapticRow').hidden = !canHaptics()
    const buzz = hapticsOn()
    setOn($('#hapticBtn'), buzz)
    $('#hapticBtn').textContent = buzz ? '開' : '關'
    $('#hapticInfo').textContent = IOS
      ? '打勾、選本命、開始專注時輕輕震一下（iPhone 只有部分 iOS 版本震得動・只改這台裝置）'
      : '打勾、選本命、全部完成、番茄鐘到點時手機輕輕震一下（只改這台裝置）'
    // 通知與提醒的四個總開關；「更多」裡的那幾項在總開關關著時看得到、改得了，只是先不說
    const st = this.store.state.settings
    const master = (id, on) => {
      setOn($(id), on)
      $(id).textContent = on ? '開' : '關'
    }
    master('#remindOnBtn', st.remindOn !== false)
    master('#nudgeOnBtn', st.nudgeOn !== false)
    master('#chatOnBtn', st.chatOn !== false)
    master('#mottoOnBtn', this.store.mottoOn())
    master('#soundSetBtn', st.sound !== false)
    const every = st.mottoEvery
    $('#mottoSetInfo').textContent = !this.store.mottoOn()
      ? '總開關關著（在上面的通知與提醒）'
      : [every > 0 ? `醒著時每 ${every >= 60 ? `${every / 60} 小時` : `${every} 分鐘`}提醒一句` : '不定時提醒', st.mottoBar ? '面板上方輪流放' : '', st.catMotto > 0 ? `專注時貓咪每 ${st.catMotto} 分鐘念一句` : ''].filter(Boolean).join('・')
    $('#nudgeMore').classList.toggle('muted', st.nudgeOn === false)
    const stuck = this.store.state.settings.stuckNudge
    setOn($('#stuckBtn'), stuck)
    $('#stuckBtn').textContent = stuck ? '開' : '關'
    // 專注中叫我回來：只有 Android 的 App 分得出鎖著手機和切去別的 App（網頁沒有這一列）
    $('#awayRow').hidden = !nativeBack()
    const awayOn = this.store.state.settings.awayNudge !== false
    setOn($('#awayBtn'), awayOn)
    $('#awayBtn').textContent = awayOn ? '開' : '關'
    // 桌機的網頁：切到別的分頁太久叫你回來（手機的網頁分不出鎖螢幕和切走，沒有這一列；預設關著，見 main.js 的 tabNudge）
    $('#tabRow').hidden = !deskWeb()
    const tabOn = this.store.state.settings.tabNudge === true
    setOn($('#tabBtn'), tabOn)
    $('#tabBtn').textContent = tabOn ? '開' : '關'
    const backOn = this.store.state.settings.backNudge !== false
    setOn($('#backBtn'), backOn)
    $('#backBtn').textContent = backOn ? '開' : '關'
    const nextOn = this.store.state.settings.nextNudge !== false
    setOn($('#nextBtn'), nextOn)
    $('#nextBtn').textContent = nextOn ? '開' : '關'
    const brief = this.store.state.settings.brief !== false
    setOn($('#briefBtn'), brief)
    $('#briefBtn').textContent = brief ? '開' : '關'
    $('#newsInfo').textContent = `${LATEST.date.slice(5).replace('-', '/')}・${LATEST.title}`
    this.renderNewsDot()
    // 第一次打開時放的範例還在才顯示
    const n = this.store.sampleCount()
    const btn = $('#sampleBtn')
    btn.hidden = !n
    if (n && !btn.dataset.armed) btn.textContent = `清除範例資料（${n} 筆）`
    nameToggles()
  },

  // ── 同步 ──
  // 線上同步（手機也能用）
  attachCloud(cloud) {
    this.cloud = cloud
    this.cloudView = new CloudView($('#cloudRow'), cloud, { toast: (o) => this.toast(o) })
    $('#backupList').addEventListener('click', (e) => {
      const r = e.target.closest('[data-rescue]')
      if (r) return this._rescueAction(r)
      const b = e.target.closest('[data-backup]')
      if (!b) return
      armConfirm(b, '再按一次還原', () => {
        try {
          if (restoreBackup(this.store, +b.dataset.backup)) this.toast({ icon: '戻', title: '已還原備份', sub: '還原前的小島也留了一份，還原錯了可以再換回來' })
        } catch (err) {
          this.toast({ icon: '！', title: '這份備份沒辦法還原', sub: err.message })
        }
        this.renderSync()
      })
    })
    this.renderSync()
  },
  // 分享連結打開時：到設定裡填好同步碼
  offerCloud(code) {
    this.setTab('settings')
    this.cloudView?.offer(code)
  },

  // 資料夾同步（電腦版 Chrome／Edge：資料寫進 OneDrive／Dropbox 裡的檔案）
  attachSync(sync) {
    this.sync = sync
    $('#syncBtns').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-sync]')
      if (!b) return
      const act = b.dataset.sync
      if (act === 'unlink') return armConfirm(b, '再按一次解除', () => sync.unlink())
      try {
        if (act === 'create') await sync.create()
        else if (act === 'choose') await sync.choose()
        else if (act === 'resume') await sync.resume()
        else if (act === 'now') await sync.sync()
        else if (act === 'file' || act === 'local') await sync.resolve(act)
      } catch (err) {
        // 使用者在檔案視窗按了取消
        if (err?.name !== 'AbortError') this.toast({ icon: '！', title: '同步檔沒有連上', sub: err.message })
      }
    })
    this.renderSync()
  },

  // 讀不進來的原始存檔：下載（之後請人幫忙修，或改好再匯入）、再試著讀一次（新版可能讀得懂了）、刪掉
  _rescueAction(btn) {
    const rescue = readRescue()
    if (!rescue) return this.renderSync()
    const how = btn.dataset.rescue
    if (how === 'download') {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([rescue.raw], { type: 'application/json' }))
      a.download = `hiyori-rescue-${dateStr(new Date(rescue.at || Date.now()))}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      return
    }
    if (how === 'retry') {
      return armConfirm(btn, '再按一次換成它', () => {
        try {
          this.store.importJSON(rescue.raw)
          dropRescue()
          this.toast({ icon: '戻', title: '原本的存檔讀進來了', sub: '換掉之前的小島留成了備份，需要的話可以再換回去' })
        } catch (err) {
          this.toast({ icon: '！', title: '還是讀不進來', sub: `${err.message}。可以先下載下來保存` })
        }
        this.renderSync()
      })
    }
    armConfirm(btn, '再按一次刪掉', () => {
      dropRescue()
      this.toast({ icon: '消', title: '刪掉了讀不進來的原始存檔' })
      this.renderSync()
    })
  },

  renderSync() {
    this.cloudView?.render()
    const when = (t) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()} ${hhmm(t)}`
    // 被取代的資料（兩種同步、匯入、重置、還原共用，留最近幾份）：還在選邊時先不顯示
    const choosing = this.cloud?.state === 'conflict' || this.sync?.state === 'conflict'
    const list = choosing ? [] : readBackups()
    const rescue = readRescue()
    $('#backupList').hidden = !list.length && !rescue
    const kb = (s) => `${Math.max(1, Math.round(s.length / 1024))} KB`
    const rescueRow = rescue
      ? `<div class="set-row rescue-row"><div><b>讀不進來的原始存檔</b><small>${rescue.at ? `${when(rescue.at)} ` : ''}打開時讀不進來，另外留著沒有刪（${kb(rescue.raw)}${rescue.error ? `・${esc(rescue.error.slice(0, 80))}` : ''}）。可以下載保存，或再試著讀一次</small></div>` +
        `<div class="sync-btns"><button class="chip-toggle" data-rescue="download">下載</button><button class="chip-toggle" data-rescue="retry">再讀一次</button><button class="chip-toggle" data-rescue="drop">刪除</button></div></div>`
      : ''
    setHTML($('#backupList'), rescueRow + list
      .map((bk, i) => {
        // 匯入、重置、還原前留的：寫什麼時候換掉的；同步、兩個分頁留的：寫那一版是什麼時候的
        const before = { import: '匯入檔案', reset: '重置', restore: '還原備份' }[bk.from]
        const src = { local: '這台', file: '同步檔', tab: '另一個分頁' }[bk.from] || '雲端'
        const info = before
          ? `${when(bk.savedAt)} ${before}前的小島，留著備用`
          : bk.from === 'merge'
            ? `${when(bk.at)} 的這台版本，兩台都改過、自動合在一起之前留的`
            : `${when(bk.at)} 的${src}版本，${bk.from === 'tab' ? '兩個分頁同時改了資料時' : '同步時'}被比較新的資料取代，留著備用`
        const n = list.length > 1 ? `<span class="bk-n">${i + 1} / ${list.length}</span>` : ''
        return `<div class="set-row"><div><b>被取代的資料${n}</b><small>${info}</small></div><button class="chip-toggle" data-backup="${i}">還原</button></div>`
      })
      .join(''))
    const sy = this.sync
    if (!sy) return
    // 手機和 Firefox 不能直接存取檔案：有線上同步就夠了，整列藏起來
    $('#syncRow').hidden = sy.state === 'unsupported'
    const name = esc(sy.fileName)
    const view = {
      unsupported: ['', []],
      off: ['把資料自動存進 OneDrive、Dropbox 等雲端資料夾裡的一個檔案，其他電腦連結同一個檔案就能共用。檔案沒有加密，看得到那個資料夾的人都讀得到內容，請放在只有自己能看的地方', [['create', '建立同步檔', 1], ['choose', '連結既有檔案']]],
      'needs-permission': [`已記住「${name}」，瀏覽器需要你同意一次才能繼續同步`, [['resume', '繼續同步', 1], ['unlink', '解除']]],
      linked: [`已連結「${name}」・${sy.lastSync ? `${hhmm(sy.lastSync)} 同步過` : '同步中…'}`, [['now', '立即同步'], ['unlink', '解除']]],
      conflict: [
        sy.conflict ? `這台和「${name}」都有新的變更（檔案 ${when(sy.conflict.remoteAt)}、這台 ${when(sy.conflict.localAt)}）。要保留哪一邊？另一邊會留一份備份` : '',
        [['file', '用檔案的', 1], ['local', '用這台的', 1]],
      ],
      error: [`同步失敗：${esc(sy.message)}`, [['now', '重試', 1], ['unlink', '解除']]],
    }[sy.state]
    const [info, btns] = view
    $('#syncInfo').innerHTML = info
    $('#syncBtns').innerHTML = btns
      .map(([act, label, on]) => `<button class="chip-toggle ${on ? 'on' : ''}" data-sync="${act}">${label}</button>`)
      .join('')
    $('#syncDot').dataset.state = sy.state
  },

}
