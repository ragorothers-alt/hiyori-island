import { afterEach, expect, it, vi } from 'vitest'
import { settingsMethods } from '../src/ui/settingsPage.js'

vi.mock('../src/ui/cloud.js', () => ({ CloudView: class { render() {} } }))

afterEach(() => {
  localStorage.removeItem('hiyori-backup')
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function render(backups) {
  localStorage.setItem('hiyori-backup', JSON.stringify(backups))
  const list = {}
  vi.stubGlobal('document', { querySelector: () => list })
  settingsMethods.renderSync.call({})
  return list.innerHTML
}

it('同分鐘的兩份備份各自列出任務、專案、最後修改到秒和最新加入的任務，還原鈕也指向那份摘要', () => {
  const at = new Date(2026, 10, 22, 9, 35, 45).getTime()
  const first = { updatedAt: at, tasks: [{ title: '<早會>', createdAt: 2 }, { title: '較早加入', createdAt: 1 }], projects: [{}] }
  const second = { updatedAt: at - 4000, tasks: [{ title: '交作業', createdAt: 3 }], projects: [] }
  const html = render([first, second].map(state => ({ state, from: 'import', savedAt: at, at })))
  const rows = html.split('被取代的資料').slice(1)
  expect(rows).toHaveLength(2)
  for (const [i, count, time, title] of [[0, '2 件任務・1 個專案', '09:35:45', '&lt;早會&gt;'], [1, '1 件任務・0 個專案', '09:35:41', '交作業']]) {
    expect(rows[i]).toContain(count)
    expect(rows[i]).toContain(time)
    expect(rows[i]).toContain(title)
    expect(rows[i]).toContain(`aria-describedby="backupSummary${i}"`)
  }
})

it('舊版的單份備份沒記修改時間或任務時，仍可看清內容', () => {
  const html = render({ from: 'local', at: 0, state: {} })
  expect(html).toContain('0 件任務・0 個專案')
  expect(html).toContain('沒有修改時間紀錄')
  expect(html).toContain('還沒有任務')
})

it('已經按了還原，另一個分頁才新增備份：再按一次不會還原到別份', () => {
  vi.useFakeTimers()
  const backup = { state: { tasks: [{ title: '原先選的' }] }, from: 'local', at: 10 }
  localStorage.setItem('hiyori-backup', JSON.stringify([backup]))
  let click
  const list = { addEventListener: (_, listener) => { click = listener } }
  vi.stubGlobal('document', { querySelector: () => list })
  const ui = { ...settingsMethods, toast: vi.fn(), store: { replaceOrUndo: vi.fn() } }
  ui.attachCloud({})
  const button = { dataset: { backup: '0' }, classList: { add() {} }, innerHTML: '還原' }
  const event = { target: { closest: (selector) => selector === '[data-backup]' ? button : null } }
  click(event)
  expect(button.innerHTML).toBe('再按一次還原')
  const changed = [{ ...backup, state: { tasks: [{ title: '後來才多出來' }] } }, backup]
  localStorage.setItem('hiyori-backup', JSON.stringify(changed))
  click(event)
  expect(ui.store.replaceOrUndo).not.toHaveBeenCalled()
  expect(JSON.parse(localStorage.getItem('hiyori-backup'))).toEqual(changed)
  expect(ui.toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('再選一次') }))
})
