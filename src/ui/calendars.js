import { esc, armConfirm } from './dom.js'
import { icsText } from '../calendars.js'
import { EVENT_COLORS } from '../theme.js'

// 設定裡「匯入行事曆」那一列：貼上 Google 日曆的私密網址、學校課表的 .ics 網址，日程帶進來（唯讀），排程和ふじ都會避開。
// 每一個行事曆：名字、幾個日程、什麼時候更新的（抓不到時寫原因）、開關、馬上更新、刪掉。
// 輸入框不跟著重畫（打到一半的字不會不見），只換清單

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return '剛剛'
  if (m < 60) return `${m} 分鐘前`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} 小時前` : `${Math.round(h / 24)} 天前`
}
const hostOf = (url) => {
  try {
    return new URL(url.replace(/^webcals?:/i, 'https:')).hostname
  } catch {
    return url.slice(0, 30)
  }
}

export class CalendarRow {
  constructor(row, store, calendars, { toast }) {
    this.row = row
    this.store = store
    this.calendars = calendars
    this.toast = toast
    row.innerHTML = `<div><b>匯入行事曆</b><small>把 Google 日曆、學校課表的行程帶進來（只看不改）：時間軸、日曆上看得到，最佳化時程和ふじ排時間都會避開</small></div>
      <ul class="ics-list"></ul>
      <form class="ics-add" autocomplete="off"><input class="cloud-input ics-input" name="url" type="url" inputmode="url" placeholder="https://… 或 webcal://…（.ics）" aria-label="行事曆網址（iCal 格式）" spellcheck="false" /><button class="chip-toggle on" type="submit">加入</button></form>
      <small class="ics-help">Google 日曆：電腦版網頁 → 設定 → 點左邊那個行事曆 →「iCal 格式的私密網址」。這個網址等於鑰匙，不要給別人；只存在你的資料裡（線上同步是加密的）。</small>`
    this.$ = (s) => row.querySelector(s)
    row.addEventListener('submit', (e) => {
      e.preventDefault()
      const input = this.$('.ics-input')
      const url = input.value.trim()
      if (!url) return input.focus()
      const c = this.store.addCalendar({ url, color: this.store.state.calendars.length + 3 })
      if (!c) {
        const dup = this.store.state.calendars.some((x) => x.url === url)
        return this.toast({ icon: '暦', title: dup ? '這個行事曆已經加過了' : '加不進來', sub: dup ? '' : '網址要是 https 或 webcal 開頭的行事曆網址（最多 10 個）' })
      }
      input.value = ''
      this.toast({ icon: '暦', title: '加好了，正在抓日程', sub: hostOf(url) })
      this.calendars.refresh({ force: true }).then(() => {
        const st = this.calendars.status(c.id)
        if (st?.error) this.toast({ icon: '暦', title: '這個行事曆抓不到', sub: icsText(st.error) })
        else if (st) this.toast({ icon: '暦', title: `帶進 ${st.events.length} 個日程`, sub: `${this.store.state.calendars.find((x) => x.id === c.id)?.name || hostOf(url)}・前一週到之後三個月` })
      })
    })
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ics]')
      if (!b) return
      const id = b.dataset.id
      const act = b.dataset.ics
      if (act === 'toggle') {
        const c = this.store.state.calendars.find((x) => x.id === id)
        if (c) this.store.updateCalendar(id, { on: !c.on })
      } else if (act === 'refresh') this.calendars.refresh({ force: true })
      else if (act === 'remove') armConfirm(b, '確定刪掉？', () => this.store.removeCalendar(id))
    })
    calendars.subscribe(() => this.render())
    store.on('change', () => this.render())
    this.render()
  }
  render() {
    const list = this.store.state.calendars
    const key = JSON.stringify(list.map((c) => [c.id, c.name, c.on, c.color, this.calendars.status(c.id)?.at, this.calendars.status(c.id)?.error, this.calendars.status(c.id)?.loading, this.calendars.status(c.id)?.events?.length]))
    if (key === this._key) return
    this._key = key
    this.$('.ics-list').innerHTML = list
      .map((c) => {
        const st = this.calendars.status(c.id)
        const info = !c.on ? '關著（不顯示、排程也不避開）' : st?.loading ? '正在抓…' : st?.error ? `${icsText(st.error)}${st.events?.length ? `（先用上次抓到的 ${st.events.length} 個）` : ''}` : st ? `${st.events.length} 個日程・${ago(st.at)}更新` : '還沒抓'
        return `<li class="${c.on ? '' : 'off'}${st?.error ? ' err' : ''}"><i class="ics-dot" style="--c:${EVENT_COLORS[c.color % EVENT_COLORS.length]}"></i>
          <div><b>${esc(c.name || hostOf(c.url))}</b><small>${esc(info)}</small></div>
          <div class="sync-btns"><button type="button" class="chip-toggle ${c.on ? 'on' : ''}" data-ics="toggle" data-id="${esc(c.id)}" aria-pressed="${c.on}">${c.on ? '顯示中' : '關著'}</button>
          <button type="button" class="chip-toggle" data-ics="refresh" data-id="${esc(c.id)}" ${c.on && !st?.loading ? '' : 'disabled'}>更新</button>
          <button type="button" class="chip-toggle danger" data-ics="remove" data-id="${esc(c.id)}">刪掉</button></div></li>`
      })
      .join('')
  }
}
