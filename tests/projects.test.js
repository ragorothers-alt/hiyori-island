// 專案的細節：進度日誌、筆記、里程碑細項、任務歸屬、匯出
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, addDays } from '../src/store.js'
import { parseQuick, describeQuick } from '../src/parse.js'
import { XP } from '../src/theme.js'
import {
  activity, msProgress, noteHTML, noteSnippet, noteTitle, noteTodos, projectMarkdown, projectProgress, projectStats, projectTimeline,
  textHTML, toggleNoteLine, latestLog,
} from '../src/projects.js'

const TODAY = '2026-11-02'
let store

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 2, 10))
  localStorage.clear()
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0, coins: 0 } }))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const newProject = (milestones = ['一', '二']) => store.addProject({ name: '畢業專題', milestones })
const roundTrip = () => {
  const text = store.exportJSON()
  const other = new Store()
  other.importJSON(text)
  return other
}

describe('進度日誌', () => {
  it('寫進度：每個專案每天第一則給經驗，同一天第二則照記不再給', () => {
    const p = newProject()
    const xp0 = store.player.xp
    const a = store.addProjectLog(p.id, { text: '整理文獻', mins: 45 })
    expect(store.player.xp).toBe(xp0 + XP.projectLog)
    store.addProjectLog(p.id, { text: '再補一段' })
    expect(store.player.xp).toBe(xp0 + XP.projectLog)
    expect(p.logs.map((l) => l.text)).toEqual(['整理文獻', '再補一段'])
    expect(a).toMatchObject({ date: TODAY, mins: 45 })
    expect(store.stats.projectLogs).toBe(2)
    // 隔天又能領一次
    vi.setSystemTime(new Date(2026, 10, 3, 9))
    store.addProjectLog(p.id, { text: '隔天' })
    expect(store.player.xp).toBe(xp0 + XP.projectLog * 2)
  })

  it('一天最多算 3 個專案的經驗', () => {
    const ps = [1, 2, 3, 4].map((i) => store.addProject({ name: `專案${i}` }))
    const xp0 = store.player.xp
    for (const p of ps) store.addProjectLog(p.id, { text: '推進' })
    expect(store.player.xp).toBe(xp0 + XP.projectLog * 3)
  })

  it('空白的不收；只記時間也算一則；不能記未來，可以補記以前', () => {
    const p = newProject()
    expect(store.addProjectLog(p.id, { text: '   ' })).toBeNull()
    expect(store.addProjectLog(p.id, { mins: 30 })).toMatchObject({ text: '', mins: 30 })
    expect(store.addProjectLog(p.id, { text: '明天的事', date: addDays(TODAY, 1) }).date).toBe(TODAY)
    expect(store.addProjectLog(p.id, { text: '上週', date: addDays(TODAY, -7) }).date).toBe(addDays(TODAY, -7))
    // 日期舊的排前面
    expect(p.logs[0].text).toBe('上週')
  })

  it('標記的里程碑要存在；刪掉里程碑時進度留著、拿掉標記', () => {
    const p = newProject()
    const m = p.milestones[0]
    const l = store.addProjectLog(p.id, { text: 'A', ms: m.id })
    expect(store.addProjectLog(p.id, { text: 'B', ms: 'nope' }).ms).toBeNull()
    store.deleteMilestone(p.id, m.id)
    expect(p.logs.find((x) => x.id === l.id)).toMatchObject({ text: 'A', ms: null })
  })

  it('修改和刪除；字和時間都清空就當成刪掉', () => {
    const p = newProject()
    const l = store.addProjectLog(p.id, { text: '原本', mins: 15 })
    store.updateProjectLog(p.id, l.id, { text: '改過', mins: 60, date: addDays(TODAY, -1) })
    expect(p.logs[0]).toMatchObject({ text: '改過', mins: 60, date: addDays(TODAY, -1) })
    store.updateProjectLog(p.id, l.id, { text: '', mins: 0 })
    expect(p.logs).toHaveLength(0)
  })
})

describe('筆記', () => {
  it('新增、打字時安靜存（不重畫）、釘選、刪除', () => {
    const p = newProject()
    const n = store.addProjectNote(p.id, { title: '會議', body: '' })
    const onChange = vi.fn()
    store.on('change', onChange)
    store.updateProjectNote(p.id, n.id, { body: '決定用 A 案' }, { quiet: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(new Store().state.projects.find((x) => x.id === p.id)).toBeUndefined() // 還沒寫進存檔（microtask）
    store.saveNow()
    expect(new Store().state.projects.find((x) => x.id === p.id).notes[0].body).toBe('決定用 A 案')
    const at = n.updatedAt
    vi.advanceTimersByTime(5000)
    store.updateProjectNote(p.id, n.id, { pinned: true })
    expect(n.pinned).toBe(true)
    expect(n.updatedAt).toBe(at) // 釘選不算更新內容
    store.deleteProjectNote(p.id, n.id)
    expect(p.notes).toHaveLength(0)
  })

  it('預覽：標題、清單、待辦、連結；HTML 一律跳脫，只認 http(s) 連結', () => {
    const html = noteHTML('# 計畫\n- 第一點\n- [x] 做完了\n- [ ] 還沒\n\n看 https://example.com/a?b=1&c=2\n<script>alert(1)</script>\njavascript:alert(1)\n**重點** `code`')
    expect(html).toContain('<h4>計畫</h4>')
    expect(html).toContain('<li>第一點</li>')
    expect(html).toContain('nb-task on')
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toMatch(/href="javascript/)
    expect(html).toContain('<b>重點</b>')
    expect(html).toContain('<code>code</code>')
    // 引號跑不出屬性
    expect(noteHTML('https://a.com/"onmouseover="x')).not.toContain('" onmouseover')
    expect(textHTML('a\nb <i>')).toBe('a<br>b &lt;i&gt;')
  })

  it('在預覽裡打勾：只切換那一行；待辦數、標題和摘要', () => {
    const body = '買材料\n- [ ] 木板\n- [x] 釘子\n- 不是待辦'
    const next = toggleNoteLine(body, 1)
    expect(next.split('\n')[1]).toBe('- [x] 木板')
    expect(toggleNoteLine(next, 2).split('\n')[2]).toBe('- [ ] 釘子')
    expect(toggleNoteLine(body, 3)).toBe(body)
    expect(noteTodos(next)).toEqual({ done: 2, total: 2 })
    expect(noteTitle({ title: '', body: '\n# 想法\n內容' })).toBe('想法')
    expect(noteSnippet({ title: '', body: '# 想法\n第二行' })).toBe('第二行')
    expect(noteTitle({ title: '', body: '' })).toBe('未命名筆記')
  })
})

describe('里程碑的細項、備註、期限', () => {
  it('細項做完一部分，進度跟著動；最後一項打勾時里程碑完成並給經驗', () => {
    const p = newProject(['寫論文', '口試'])
    const m = p.milestones[0]
    const a = store.addStep(p.id, m.id, '文獻回顧')
    const b = store.addStep(p.id, m.id, '實驗')
    expect(store.progress(p)).toBe(0)
    store.toggleStep(p.id, m.id, a.id)
    // 1 / (2 + 1) 再平分到兩個里程碑
    expect(store.progress(p)).toBeCloseTo(1 / 3 / 2)
    const xp0 = store.player.xp
    store.toggleStep(p.id, m.id, b.id)
    expect(m.done).toBe(true)
    expect(m.doneAt).toBe(Date.now())
    expect(store.player.xp).toBe(xp0 + XP.milestone)
    expect(store.progress(p)).toBe(0.5)
    // 取消其中一項：里程碑回到未完成，再勾回來不重複給經驗
    store.toggleStep(p.id, m.id, a.id)
    expect(m.done).toBe(false)
    store.toggleStep(p.id, m.id, a.id)
    expect(m.done).toBe(true)
    expect(store.player.xp).toBe(xp0 + XP.milestone)
  })

  it('細項全做完但里程碑被取消時，進度不會到 100%（房子不會蓋完）', () => {
    const p = newProject(['唯一'])
    const m = p.milestones[0]
    const a = store.addStep(p.id, m.id, '只有一步')
    store.toggleStep(p.id, m.id, a.id)
    expect(store.progress(p)).toBe(1)
    store.toggleMilestone(p.id, m.id)
    expect(m.done).toBe(false)
    expect(store.progress(p)).toBeLessThan(1)
    expect(msProgress(m)).toBe(0.5)
  })

  it('刪掉最後沒做完的細項：剩下的都做完了就算完成', () => {
    const p = newProject(['唯一', '另一個'])
    const m = p.milestones[0]
    const a = store.addStep(p.id, m.id, '做完的')
    const b = store.addStep(p.id, m.id, '不做了')
    store.toggleStep(p.id, m.id, a.id)
    store.deleteStep(p.id, m.id, b.id)
    expect(m.done).toBe(true)
  })

  it('改名、備註、期限、上下移動；空白的名字不改', () => {
    const p = newProject(['一', '二', '三'])
    const [a, b] = p.milestones
    store.updateMilestone(p.id, a.id, { title: '  ', note: '要附上圖表', due: addDays(TODAY, 3) })
    expect(a).toMatchObject({ title: '一', note: '要附上圖表', due: addDays(TODAY, 3) })
    store.updateMilestone(p.id, a.id, { due: '' })
    expect(a.due).toBe('')
    store.moveMilestone(p.id, b.id, -1)
    expect(p.milestones.map((m) => m.title)).toEqual(['二', '一', '三'])
    store.moveMilestone(p.id, b.id, -1)
    expect(p.milestones.map((m) => m.title)).toEqual(['二', '一', '三'])
  })
})

describe('任務歸在專案', () => {
  it('新增時歸屬要存在；專注的分鐘記到專案上；刪掉專案時任務留著', () => {
    const p = newProject()
    const t = store.addTask({ title: '畫流程圖', project: p.id, date: TODAY })
    expect(store.addTask({ title: '亂指', project: 'nope' }).project).toBeNull()
    store.completePomodoro(25, t.id)
    store.completePomodoro(50, t.id)
    expect(p.focus[TODAY]).toBe(75)
    expect(projectStats(p, store.state.tasks)).toMatchObject({ focus: 75, tasksTotal: 1, tasksDone: 0 })
    store.updateTask(t.id, { project: 'nope' })
    expect(t.project).toBeNull()
    store.updateTask(t.id, { project: p.id })
    store.deleteProject(p.id)
    expect(store.state.tasks.find((x) => x.id === t.id)).toMatchObject({ title: '畫流程圖', project: null })
  })

  it('一行輸入的 @專案（開頭幾個字就夠，對不上就留在標題裡）', () => {
    const projects = [{ id: 'p1', name: '作品集 網站' }, { id: 'p2', name: '英文' }]
    const a = parseQuick('切版 @作品集 明天', { today: TODAY, projects })
    expect(a).toMatchObject({ title: '切版', project: 'p1', date: addDays(TODAY, 1) })
    expect(describeQuick(a, TODAY)).toContain('專案・作品集 網站')
    const b = parseQuick('寄給 a@b.com', { today: TODAY, projects })
    expect(b.project).toBeUndefined()
    expect(b.title).toBe('寄給 a@b.com')
    expect(parseQuick('背單字 @英文', { today: TODAY }).title).toBe('背單字 @英文')
  })

  it('清範例：範例專案裡加了細項、改了目標就算自己的；只是打勾的照樣清掉', () => {
    localStorage.clear()
    const s = new Store()
    const [folio, intro] = s.state.projects
    s.addStep(folio.id, folio.milestones[3].id, '自己加的細項')
    s.toggleMilestone(intro.id, intro.milestones[0].id)
    s.clearSamples()
    expect(s.state.projects.map((p) => p.id)).toEqual([folio.id])
    // 存檔再讀回來也還記得
    const again = new Store()
    again.importJSON(s.exportJSON())
    expect(again.state.projects.find((p) => p.id === folio.id).mine).toBe(true)
    localStorage.clear()
    const t = new Store()
    t.setProjectGoal(t.state.projects[1].id, '我的目標')
    t.clearSamples()
    expect(t.state.projects.map((p) => p.name)).toEqual(['認識ひより小島'])
  })

  it('清範例：範例專案被清掉時，歸在它底下的自己的任務只拿掉歸屬；寫了自己筆記的範例專案留著', () => {
    localStorage.clear()
    const s = new Store()
    const [folio, intro] = s.state.projects
    expect(folio.id.startsWith('ex-')).toBe(true)
    s.addProjectNote(folio.id, { title: '我的', body: '自己寫的' })
    const t = s.addTask({ title: '我的任務', project: intro.id })
    s.clearSamples()
    expect(s.state.projects.map((p) => p.id)).toEqual([folio.id])
    expect(s.state.tasks.find((x) => x.id === t.id).project).toBeNull()
  })
})

describe('存檔、匯入與時間軸', () => {
  it('匯出再匯入：目標、日誌、筆記、細項、專注都還在，壞掉的值被清掉', () => {
    const p = newProject(['一'])
    store.setProjectGoal(p.id, '六月前交出去')
    store.addProjectLog(p.id, { text: '開工', mins: 30, ms: p.milestones[0].id })
    store.addProjectNote(p.id, { title: '想法', body: '- [ ] 問老師' })
    store.addStep(p.id, p.milestones[0].id, '第一步')
    const t = store.addTask({ title: '任務', project: p.id })
    store.completePomodoro(25, t.id)
    const q = roundTrip().state.projects.find((x) => x.name === '畢業專題')
    expect(q.goal).toBe('六月前交出去')
    expect(q.logs[0]).toMatchObject({ text: '開工', mins: 30, ms: q.milestones[0].id })
    expect(q.notes[0]).toMatchObject({ title: '想法', body: '- [ ] 問老師', pinned: false })
    expect(q.milestones[0].steps[0]).toMatchObject({ title: '第一步', done: false })
    expect(q.focus[TODAY]).toBe(25)

    // 舊存檔（沒有這些欄位）和壞掉的值
    const raw = JSON.parse(store.exportJSON())
    const rp = raw.projects.find((x) => x.name === '畢業專題')
    delete rp.goal
    rp.logs = [{ id: 'l1', text: '', mins: 0 }, { id: 'l2', text: 'ok', mins: 99999, date: 'bad', ms: 'gone' }, 'junk']
    rp.focus = { bad: 5, [TODAY]: -3, '2026-11-01': 20 }
    rp.milestones[0].steps = [{ title: '' }, { title: 'x', done: 1 }]
    raw.tasks.push({ id: 't9', title: '孤兒', project: 'not-there' })
    const other = new Store()
    other.importJSON(JSON.stringify(raw))
    const op = other.state.projects.find((x) => x.name === '畢業專題')
    expect(op.goal).toBe('')
    expect(op.logs).toHaveLength(1)
    expect(op.logs[0]).toMatchObject({ text: 'ok', mins: 1440, date: TODAY, ms: null })
    expect(op.focus).toEqual({ '2026-11-01': 20 })
    expect(op.milestones[0].steps).toEqual([expect.objectContaining({ title: 'x', done: true })])
    expect(other.state.tasks.find((x) => x.title === '孤兒').project).toBeNull()
  })

  it('日期、時間、id 只認字串：陣列不會混進存檔把排序弄壞', () => {
    const bad = {
      version: 2, tasks: [{ id: 't1', title: 'x', date: ['2026-11-02'], at: ['09:00'], project: ['p1'] }], player: { xp: 123 },
      projects: [{ id: 'p1', name: '真的專案', milestones: [], logs: [{ id: 'l1', text: 'one', date: '2026-11-01' }, { id: 'l2', text: 'two', date: ['2026-11-02'] }] }],
      dates: [{ id: 'd1', title: '考試', date: ['2026-12-01'] }],
    }
    const other = new Store()
    expect(() => other.importJSON(JSON.stringify(bad))).not.toThrow()
    expect(other.player.xp).toBe(123)
    const p = other.state.projects.find((x) => x.id === 'p1')
    expect(p.logs.map((l) => [l.text, l.date])).toEqual([['one', '2026-11-01'], ['two', TODAY]])
    expect(other.state.tasks[0]).toMatchObject({ date: TODAY, at: null, project: null })
    expect(other.state.dates).toEqual([])
  })

  it('時間軸：依日期分組、新的在前，帶進里程碑、任務、專注、開工', () => {
    const p = newProject(['一'])
    store.addProjectLog(p.id, { text: '昨天的', date: addDays(TODAY, -1) })
    vi.advanceTimersByTime(60000)
    store.addProjectLog(p.id, { text: '今天的', mins: 20 })
    const t = store.addTask({ title: '任務', project: p.id })
    store.completePomodoro(25, t.id)
    vi.advanceTimersByTime(60000)
    store.toggleTask(t.id)
    vi.advanceTimersByTime(60000)
    store.toggleMilestone(p.id, p.milestones[0].id)
    const days = projectTimeline(p, store.state.tasks)
    expect(days.map((d) => d.date)).toEqual([TODAY, addDays(TODAY, -1)])
    expect(days[0].items.map((i) => i.kind)).toEqual(['done', 'ms', 'task', 'log', 'start'])
    expect(days[0]).toMatchObject({ logMins: 20, focus: 25 })
    expect(latestLog(p).text).toBe('今天的')
    const heat = activity(p, store.state.tasks, TODAY, 14)
    expect(heat).toHaveLength(14)
    expect(heat.at(-1)).toMatchObject({ date: TODAY })
    expect(heat.at(-1).level).toBeGreaterThan(0)
    expect(heat.at(-3).level).toBe(0)
  })

  it('匯出成 Markdown', () => {
    const p = newProject(['一', '二'])
    store.setProjectGoal(p.id, '交出去')
    store.addStep(p.id, p.milestones[0].id, '細項')
    store.toggleMilestone(p.id, p.milestones[1].id)
    store.addProjectNote(p.id, { title: '筆記', body: '內容' })
    store.addProjectLog(p.id, { text: '推進', mins: 90 })
    store.addTask({ title: '任務', project: p.id, date: TODAY })
    const md = projectMarkdown(p, store.state.tasks)
    expect(md).toContain('# 畢業專題')
    expect(md).toContain(`進度 ${Math.round(projectProgress(p) * 100)}%`)
    expect(md).toContain('> 交出去')
    expect(md).toContain('- [ ] 一')
    expect(md).toContain('  - [ ] 細項')
    expect(md).toMatch(/- \[x\] 二（完成於 11\/2）/)
    expect(md).toContain('### 筆記')
    expect(md).toContain('- 推進（1 小時 30 分）')
    expect(md).toContain('- [ ] 任務（11/2）')
  })
})
