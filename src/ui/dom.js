// 介面共用的小工具：選取元素、跳脫 HTML、圖示、二段式確認

export const $ = (s, el = document) => el.querySelector(s)
export const $$ = (s, el = document) => [...el.querySelectorAll(s)]
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4L19 7"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  today: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
}

// 二段式確認：第一次點擊變成「確定？」，3 秒內再點才執行
export function armConfirm(btn, label, fn) {
  if (btn.dataset.armed) {
    fn()
    return
  }
  const orig = btn.innerHTML
  btn.dataset.armed = '1'
  btn.innerHTML = label
  btn.classList.add('armed')
  setTimeout(() => {
    if (!btn.isConnected) return
    delete btn.dataset.armed
    btn.innerHTML = orig
    btn.classList.remove('armed')
  }, 3000)
}

// 'YYYY-MM-DD' → '10 月 29 日（四）'
export const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六']
export function dateLabel(date, withWeek = true) {
  const d = new Date(date + 'T00:00:00')
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日${withWeek ? `（${WEEK_ZH[d.getDay()]}）` : ''}`
}
