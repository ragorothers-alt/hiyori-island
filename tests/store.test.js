import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Store, QUESTS, addDays, dateStr, minToHHMM, repeatLabel, repeatMatches, toMin,
} from '../src/store.js'
import { levelFromXp, xpNeed } from '../src/theme.js'

const TODAY = '2026-10-25'
let store

function setDate(day, hour = 12) {
  const [year, month, date] = day.split('-').map(Number)
  vi.setSystemTime(new Date(year, month - 1, date, hour))
}

function completeTask(title = '完成一件事', options = {}) {
  const task = store.addTask({ title, ...options })
  store.toggleTask(task.id)
  return task
}

beforeEach(() => {
  vi.useFakeTimers()
  setDate(TODAY)
  localStorage.clear()
  store = new Store()
  // 透過公開匯入介面隔離種子資料，讓每次獎勵的來源都可確定。
  store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0, coins: 0 } }))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('日期、時間與重複規則', () => {
  it('日期以本地年月日補零，省略參數時使用固定的今天', () => {
    expect(dateStr()).toBe(TODAY)
    expect(dateStr(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it.each([
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-02-28', 1, '2028-02-29'],
  ])('日期 %s 加上 %i 天會正確跨月、跨年與處理閏年', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected)
  })

  it.each([
    ['00:00', 0], ['09:05', 545], ['23:59', 1439],
  ])('時間 %s 與分鐘數 %i 可以互相轉換', (time, minutes) => {
    expect(toMin(time)).toBe(minutes)
    expect(minToHHMM(minutes)).toBe(time)
  })

  it('沒有時間時換算為零分鐘', () => {
    expect(toMin()).toBe(0)
    expect(toMin('')).toBe(0)
  })

  it.each([
    ['每天', { type: 'daily', days: [] }, TODAY, true],
    ['平日的週一', { type: 'weekdays', days: [] }, '2026-10-26', true],
    ['平日的週日', { type: 'weekdays', days: [] }, TODAY, false],
    ['指定的週三', { type: 'weekly', days: [1, 3, 5] }, '2026-10-28', true],
    ['未指定的週二', { type: 'weekly', days: [1, 3, 5] }, '2026-10-27', false],
  ])('重複規則會判斷%s是否符合', (_name, repeat, date, expected) => {
    expect(repeatMatches(repeat, date)).toBe(expected)
  })

  it('重複規則顯示中文名稱，週次排序時不改動原始資料', () => {
    const repeat = { type: 'weekly', days: [5, 1, 3] }
    expect(repeatLabel({ type: 'daily' })).toBe('每天')
    expect(repeatLabel({ type: 'weekdays' })).toBe('平日')
    expect(repeatLabel(repeat)).toBe('每週一、三、五')
    expect(repeat.days).toEqual([5, 1, 3])
  })
})

describe('任務經驗值與升級', () => {
  it.each([
    ['低', 1, 10, 2], ['中', 2, 15, 3], ['高', 3, 25, 5],
  ])('完成%s優先（%i）任務獲得 %i XP 與 %i 顆金平糖', (_name, priority, xp, coins) => {
    const onXp = vi.fn()
    store.on('xp', onXp)
    const task = completeTask('寫報告', { priority })

    expect(store.player.xp).toBe(xp)
    expect(store.coins).toBe(coins)
    expect(store.coins).toBeGreaterThanOrEqual(1)
    expect(store.stats.tasksDone).toBe(1)
    expect(store.stats.highTasksDone).toBe(priority === 3 ? 1 : 0)
    expect(store.peekDay(TODAY)).toMatchObject({ tasks: 1, xp })
    expect(onXp).toHaveBeenCalledExactlyOnceWith({ amount: xp, coins, kind: 'task', id: task.id })
  })

  it('任務取消後再次完成不重複增加經驗值、金平糖與完成數', () => {
    const task = completeTask('寫報告', { priority: 3 })
    store.toggleTask(task.id)
    expect(task.done).toBe(false)
    store.toggleTask(task.id)

    expect(task.done).toBe(true)
    expect(task.rewarded).toBe(true)
    expect(store.player.xp).toBe(25)
    expect(store.coins).toBe(5)
    expect(store.stats.tasksDone).toBe(1)
    expect(store.peekDay(TODAY).tasks).toBe(1)
  })

  it('第一級門檻為八十經驗值，之後每級增加四十五', () => {
    expect([1, 2, 3, 4, 10].map(xpNeed)).toEqual([80, 125, 170, 215, 485])
  })

  it.each([
    [0, { level: 1, cur: 0, need: 80 }],
    [79, { level: 1, cur: 79, need: 80 }],
    [80, { level: 2, cur: 0, need: 125 }],
    [204, { level: 2, cur: 124, need: 125 }],
    [205, { level: 3, cur: 0, need: 170 }],
    [400, { level: 4, cur: 25, need: 215 }],
  ])('累計 %i 經驗值會換算為正確等級與級內進度', (xp, expected) => {
    expect(levelFromXp(xp)).toEqual(expected)
  })

  it('剛好達到升級門檻時通知監聽者，未達門檻時不通知', () => {
    store.importJSON(JSON.stringify({ tasks: [], player: { xp: 60, coins: 0 } }))
    const onLevelUp = vi.fn()
    const unsubscribe = store.on('levelUp', onLevelUp)
    completeTask('第一件事', { priority: 1 })
    expect(onLevelUp).not.toHaveBeenCalled()
    completeTask('第二件事', { priority: 1 })

    expect(store.level).toEqual({ level: 2, cur: 0, need: 125 })
    expect(onLevelUp).toHaveBeenCalledExactlyOnceWith({ level: 2, from: 1 })
    unsubscribe()
    store.emit('levelUp', { level: 3, from: 2 })
    expect(onLevelUp).toHaveBeenCalledTimes(1)
  })
})

describe('連續天數與完美的一天', () => {
  it('連續兩天完成任務累計為兩天，同一天多完成任務不增加天數', () => {
    completeTask()
    completeTask('今天第二件事')
    expect(store.streak).toBe(1)
    setDate('2026-10-26')
    store.tick()
    completeTask('隔天的一件事')

    expect(store.streak).toBe(2)
    expect(store.player.lastActive).toBe('2026-10-26')
    expect(store.stats.bestStreak).toBe(2)
  })

  it('中斷一天後重新從一天計算，最佳連續天數仍保留', () => {
    completeTask()
    setDate('2026-10-26')
    store.tick()
    completeTask()
    setDate('2026-10-28')
    store.tick()
    completeTask()

    expect(store.streak).toBe(1)
    expect(store.stats.bestStreak).toBe(2)
  })

  it('隔天還沒完成任務仍顯示昨天的連續天數，隔兩天則顯示零', () => {
    expect(store.streak).toBe(0)
    completeTask()
    setDate('2026-10-26')
    store.tick()
    expect(store.streak).toBe(1)
    setDate('2026-10-27')
    store.tick()
    expect(store.streak).toBe(0)
    expect(store.stats.bestStreak).toBe(1)
  })

  it('當天三個任務全部完成才額外給四十經驗值與一次完美日統計', () => {
    const tasks = ['甲', '乙', '丙'].map((title) => store.addTask({ title, priority: 1 }))
    const onXp = vi.fn()
    store.on('xp', onXp)
    store.toggleTask(tasks[0].id)
    store.toggleTask(tasks[1].id)
    expect(store.stats.perfectDays).toBe(0)
    expect(store.player.xp).toBe(20)
    store.toggleTask(tasks[2].id)

    expect(store.player.xp).toBe(70)
    expect(store.stats.perfectDays).toBe(1)
    expect(store.peekDay(TODAY).perfect).toBe(true)
    expect(onXp).toHaveBeenCalledWith({ amount: 40, coins: 8, kind: 'perfect' })
  })

  it('同一天取消再完成或新增任務再全部完成，都不重複給完美日獎勵', () => {
    const tasks = ['甲', '乙', '丙'].map((title) => store.addTask({ title, priority: 1 }))
    tasks.forEach((task) => store.toggleTask(task.id))
    store.toggleTask(tasks[0].id)
    store.toggleTask(tasks[0].id)
    expect(store.player.xp).toBe(70)
    completeTask('追加任務', { priority: 1 })
    expect(store.player.xp).toBe(80)
    expect(store.stats.perfectDays).toBe(1)
  })

  it('當天只有兩個任務時，即使全部完成也不給完美日獎勵', () => {
    completeTask('甲', { priority: 1 })
    completeTask('乙', { priority: 1 })
    expect(store.player.xp).toBe(20)
    expect(store.stats.perfectDays).toBe(0)
    expect(store.peekDay(TODAY).perfect).toBe(false)
  })
})

describe('每日任務', () => {
  it('每日任務定義包含任務、番茄鐘及日程與里程碑的進度', () => {
    expect(QUESTS.map(({ id, goal }) => ({ id, goal }))).toEqual([
      { id: 'tasks3', goal: 3 }, { id: 'focus2', goal: 2 }, { id: 'step1', goal: 1 },
    ])
    const day = { tasks: 2, pomodoros: 1, events: 2, milestones: 3 }
    expect(QUESTS.map((quest) => quest.val(day))).toEqual([2, 1, 5])
  })

  it('完成三個任務後可領三十經驗值，重複領取無效', () => {
    const onReady = vi.fn()
    const onClaimed = vi.fn()
    store.on('questReady', onReady)
    store.on('questClaimed', onClaimed)
    // 留一個未完成任務，避免完美日獎勵干擾每日任務的差額。
    const tasks = ['甲', '乙', '丙', '待辦'].map((title) => store.addTask({ title, priority: 1 }))
    tasks.slice(0, 3).forEach((task) => store.toggleTask(task.id))
    expect(store.quests().find((quest) => quest.id === 'tasks3')).toMatchObject({ value: 3, ready: true, claimed: false })
    expect(onReady).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'tasks3' }))

    store.claimQuest('tasks3')
    expect(store.player.xp).toBe(60)
    expect(store.coins).toBe(12)
    expect(store.stats.questsClaimed).toBe(1)
    expect(store.quests().find((quest) => quest.id === 'tasks3').claimed).toBe(true)
    store.claimQuest('tasks3')
    expect(store.player.xp).toBe(60)
    expect(store.stats.questsClaimed).toBe(1)
    expect(onClaimed).toHaveBeenCalledTimes(1)
  })

  it('未達目標或不存在的每日任務無法領取獎勵', () => {
    const onClaimed = vi.fn()
    store.on('questClaimed', onClaimed)
    completeTask()
    store.claimQuest('tasks3')
    store.claimQuest('不存在')
    expect(store.player.xp).toBe(15)
    expect(store.stats.questsClaimed).toBe(0)
    expect(store.quests().find((quest) => quest.id === 'tasks3')).toMatchObject({ value: 1, ready: false, claimed: false })
    expect(onClaimed).not.toHaveBeenCalled()
  })

  it('新的一天會重設每日任務進度與領取狀態', () => {
    for (const title of ['甲', '乙', '丙']) completeTask(title)
    store.claimQuest('tasks3')
    setDate('2026-10-26')
    store.tick()
    expect(store.quests().every((quest) => quest.value === 0 && !quest.ready && !quest.claimed)).toBe(true)
  })
})

describe('專案里程碑與落成獎勵', () => {
  it('全部里程碑完成時給每項二十五加落成一百二十經驗值，並發出落成事件', () => {
    const project = store.addProject({ name: '新專案', milestones: ['規劃', '製作', '發佈'] })
    const onDone = vi.fn()
    store.on('projectDone', onDone)
    project.milestones.slice(0, 2).forEach((milestone) => store.toggleMilestone(project.id, milestone.id))
    expect(store.player.xp).toBe(50)
    expect(store.stats.projectsDone).toBe(0)
    expect(onDone).not.toHaveBeenCalled()
    store.toggleMilestone(project.id, project.milestones[2].id)

    expect(store.player.xp).toBe(25 * 3 + 120)
    expect(store.stats.milestonesDone).toBe(3)
    expect(store.stats.projectsDone).toBe(1)
    expect(project.completedAt).toBe(Date.now())
    expect(onDone).toHaveBeenCalledExactlyOnceWith(project)
  })

  it('落成後取消里程碑再完成，不重複發里程碑與落成獎勵', () => {
    const project = store.addProject({ name: '小專案', milestones: ['發佈'] })
    const milestone = project.milestones[0]
    const onDone = vi.fn()
    store.on('projectDone', onDone)
    store.toggleMilestone(project.id, milestone.id)
    const completedAt = project.completedAt
    store.toggleMilestone(project.id, milestone.id)
    store.toggleMilestone(project.id, milestone.id)

    expect(store.player.xp).toBe(145)
    expect(store.stats.milestonesDone).toBe(1)
    expect(store.stats.projectsDone).toBe(1)
    expect(project.completedAt).toBe(completedAt)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('刪掉未完成的里程碑使剩下的都完成時，也會落成', () => {
    const project = store.addProject({ name: '縮小範圍', milestones: ['保留', '刪除'] })
    const onDone = vi.fn()
    store.on('projectDone', onDone)
    store.toggleMilestone(project.id, project.milestones[0].id)
    store.deleteMilestone(project.id, project.milestones[1].id)

    expect(project.milestones).toHaveLength(1)
    expect(store.player.xp).toBe(145)
    expect(store.stats.projectsDone).toBe(1)
    expect(onDone).toHaveBeenCalledExactlyOnceWith(project)
  })

  it('刪掉最後一個里程碑不會讓空專案落成', () => {
    const project = store.addProject({ name: '空專案', milestones: ['待辦'] })
    const onDone = vi.fn()
    store.on('projectDone', onDone)
    store.deleteMilestone(project.id, project.milestones[0].id)
    expect(project.completedAt).toBeNull()
    expect(store.stats.projectsDone).toBe(0)
    expect(store.player.xp).toBe(0)
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('例行公事與跨日', () => {
  it('新增每日任務立即生成今天的實例，選明天會生成一次且沿用屬性', () => {
    const routine = store.addRoutine({ title: '澆花', repeat: { type: 'daily' }, priority: 3, tag: 'health' })
    expect(store.tasksOn(TODAY)).toEqual([
      expect.objectContaining({ title: '澆花', routineId: routine.id, priority: 3, tag: 'health', done: false }),
    ])
    store.selectDate('2026-10-26')
    expect(store.tasksOn('2026-10-26')).toHaveLength(1)
    store.selectDate(TODAY)
    store.selectDate('2026-10-26')
    expect(store.tasksOn('2026-10-26')).toHaveLength(1)
  })

  it.each(['task', 'event'])('刪掉某天的例行 %s 實例後再回訪不會重生', (kind) => {
    store.addRoutine({ kind, title: '例行活動', repeat: { type: 'daily' } })
    const instances = (date) => kind === 'task' ? store.tasksOn(date) : store.eventsOn(date)
    const instance = instances(TODAY)[0]
    if (kind === 'task') store.deleteTask(instance.id)
    else store.deleteEvent(instance.id)
    store.selectDate('2026-10-26')
    store.selectDate(TODAY)
    expect(instances(TODAY)).toHaveLength(0)
    expect(instances('2026-10-26')).toHaveLength(1)
  })

  it('每週例行公事只在指定星期生成', () => {
    store.addRoutine({ title: '晨跑', repeat: { type: 'weekly', days: [1, 3, 5] } })
    expect(store.tasksOn(TODAY)).toHaveLength(0)
    for (const [date, count] of [['2026-10-26', 1], ['2026-10-27', 0], ['2026-10-28', 1], ['2026-10-30', 1]]) {
      store.selectDate(date)
      expect(store.tasksOn(date)).toHaveLength(count)
    }
  })

  it('不會為過去日期補生例行實例，過去的起始日會調整為今天', () => {
    store.selectDate('2026-10-24')
    const routine = store.addRoutine({ title: '日記', repeat: { type: 'daily' } })
    expect(routine.startDate).toBe(TODAY)
    expect(store.tasksOn('2026-10-24')).toHaveLength(0)
    expect(store.tasksOn(TODAY)).toHaveLength(1)
    store.selectDate('2026-10-23')
    expect(store.tasksOn('2026-10-23')).toHaveLength(0)
  })

  it.each(['task', 'event'])('刪除例行 %s 會移除未來未完成實例並保留已完成紀錄及其他例行實例', (kind) => {
    const routine = store.addRoutine({ kind, title: '待刪例行', repeat: { type: 'daily' } })
    const other = store.addRoutine({ kind, title: '保留例行', repeat: { type: 'daily' } })
    const instances = (date) => kind === 'task' ? store.tasksOn(date) : store.eventsOn(date)
    store.selectDate('2026-10-26')
    const completed = instances('2026-10-26').find((item) => item.routineId === routine.id)
    if (kind === 'task') store.toggleTask(completed.id)
    else store.toggleEvent(completed.id)
    store.selectDate('2026-10-27')
    store.deleteRoutine(routine.id)

    expect(store.state.routines.map((item) => item.id)).toEqual([other.id])
    expect(instances(TODAY).filter((item) => item.routineId === routine.id)).toHaveLength(0)
    expect(instances('2026-10-26')).toContain(completed)
    expect(completed.done).toBe(true)
    expect(instances('2026-10-27').map((item) => item.routineId)).toEqual([other.id])
    store.selectDate('2026-10-28')
    expect(instances('2026-10-28').map((item) => item.routineId)).toEqual([other.id])
  })

  it('系統跨日後更新今天與選定日期並生成新一天的例行公事', () => {
    store.addRoutine({ title: '每日澆花', repeat: { type: 'daily' } })
    const onDateChanged = vi.fn()
    store.on('dateChanged', onDateChanged)
    expect(store.tick()).toBe(false)
    expect(onDateChanged).not.toHaveBeenCalled()
    setDate('2026-10-26', 0)

    expect(store.tick()).toBe(true)
    expect(store.today).toBe('2026-10-26')
    expect(store.selectedDate).toBe('2026-10-26')
    expect(store.tasksOn('2026-10-26')).toHaveLength(1)
    expect(onDateChanged).toHaveBeenCalledExactlyOnceWith('2026-10-26')
    expect(store.tick()).toBe(false)
    expect(store.tasksOn('2026-10-26')).toHaveLength(1)
    expect(onDateChanged).toHaveBeenCalledTimes(1)
  })

  it('跨日時若正在查看其他日期，選定日期維持原值', () => {
    store.selectDate('2026-10-28')
    setDate('2026-10-26')
    expect(store.tick()).toBe(true)
    expect(store.today).toBe('2026-10-26')
    expect(store.selectedDate).toBe('2026-10-28')
  })
})

describe('存檔匯入與清洗', () => {
  it('殘缺專案、缺標題任務、錯誤時間與含有網頁標記的識別碼會安全清洗', () => {
    const malformed = {
      tasks: [
        { id: 'missing-title' },
        { id: '<img src=x>', title: '  合法任務  ', date: '錯誤日期', priority: 99, tag: '未知' },
        null,
      ],
      events: [{ id: '<b>event</b>', title: '日程', date: '錯誤日期', start: '25:99', end: '不是時間' }],
      projects: [{ id: '<script>bad</script>', name: '沒有里程碑' }],
      player: { xp: -30, coins: -2 },
    }
    expect(() => store.importJSON(JSON.stringify(malformed))).not.toThrow()
    expect(store.state.tasks).toHaveLength(1)
    expect(store.state.tasks[0]).toMatchObject({ title: '合法任務', date: TODAY, priority: 3, tag: 'life', done: false })
    expect(store.state.events[0]).toMatchObject({ date: TODAY, start: '09:00', end: '10:00' })
    expect(store.state.projects[0].milestones).toEqual([])
    for (const item of [...store.state.tasks, ...store.state.events, ...store.state.projects]) {
      expect(item.id).toMatch(/^[\w-]{1,40}$/)
    }
    expect(store.player).toMatchObject({ xp: 0, coins: 0 })
  })

  it('重複識別碼會重新分配，已完成舊任務會標記為已領獎', () => {
    store.importJSON(JSON.stringify({
      tasks: [{ id: 'same', title: '甲', done: true }, { id: 'same', title: '乙' }],
      player: { xp: 10 },
    }))
    expect(new Set(store.state.tasks.map((task) => task.id)).size).toBe(2)
    const done = store.state.tasks[0]
    expect(done.rewarded).toBe(true)
    store.toggleTask(done.id)
    store.toggleTask(done.id)
    expect(store.player.xp).toBe(10)
  })

  it('非 JSON 字串會顯示指定錯誤且不覆蓋現有資料', () => {
    const original = store.exportJSON()
    expect(() => store.importJSON('這不是 JSON')).toThrow('檔案不是 JSON 格式')
    expect(store.exportJSON()).toBe(original)
  })

  it.each(['null', '[]', '{}', '{"tasks":[],"player":null}'])('結構無效的存檔 %s 會被拒絕且不覆蓋資料', (text) => {
    const original = store.exportJSON()
    expect(() => store.importJSON(text)).toThrow('不是有效的ひより存檔')
    expect(store.exportJSON()).toBe(original)
  })

  it.each([[100, 20], [103, 21]])('舊存檔沒有金平糖時，將 %i 經驗值換算為 %i 顆', (xp, coins) => {
    store.importJSON(JSON.stringify({ tasks: [], player: { xp } }))
    expect(store.player.xp).toBe(xp)
    expect(store.coins).toBe(coins)
  })

  it('匯入後立即存檔並發出重新載入事件', () => {
    const onReload = vi.fn()
    store.on('reload', onReload)
    store.importJSON(JSON.stringify({ tasks: [{ id: 'saved', title: '已保存' }], player: { xp: 42, coins: 7 } }))
    const saved = JSON.parse(localStorage.getItem('hiyori-daily-v1'))
    expect(saved.tasks[0]).toMatchObject({ id: 'saved', title: '已保存' })
    expect(saved.player).toMatchObject({ xp: 42, coins: 7 })
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})

describe('金平糖商店', () => {
  it('金平糖不足時不放置或扣款並發出餘額不足事件', () => {
    store.player.coins = 9
    const onPoor = vi.fn()
    store.on('shopPoor', onPoor)
    expect(store.placeItem('mushroom', 1, 2)).toBeNull()
    expect(store.coins).toBe(9)
    expect(store.state.placed).toEqual([])
    expect(store.stats.itemsBought).toBe(0)
    expect(onPoor).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'mushroom', price: 10 }))
  })

  it('餘額剛好足夠時會扣款、放置物品並累計購買數', () => {
    store.player.coins = 10
    const placed = store.placeItem('mushroom', 1, -2, 0.5)
    expect(placed).toMatchObject({ key: 'mushroom', x: 1, z: -2, rot: 0.5 })
    expect(store.coins).toBe(0)
    expect(store.state.placed).toEqual([placed])
    expect(store.stats.itemsBought).toBe(1)
  })

  it('收回物品會退還價格的一半並無條件捨去，重複收回不退款', () => {
    store.player.coins = 15
    const placed = store.placeItem('lamp', 0, 0)
    const onStored = vi.fn()
    store.on('itemStored', onStored)
    store.storeItem(placed.id)
    expect(store.coins).toBe(7)
    expect(store.state.placed).toEqual([])
    expect(onStored).toHaveBeenCalledExactlyOnceWith({ item: expect.objectContaining({ key: 'lamp', price: 15 }), refund: 7 })
    store.storeItem(placed.id)
    expect(store.coins).toBe(7)
    expect(onStored).toHaveBeenCalledTimes(1)
  })

  it('移動物品會更新座標與旋轉角度且不再扣款', () => {
    store.player.coins = 20
    const placed = store.placeItem('mushroom', 0, 0)
    const onMoved = vi.fn()
    store.on('itemMoved', onMoved)
    store.moveItem(placed.id, -3, 4, 1.25)
    expect(store.state.placed[0]).toMatchObject({ id: placed.id, x: -3, z: 4, rot: 1.25 })
    expect(store.coins).toBe(10)
    expect(onMoved).toHaveBeenCalledExactlyOnceWith(placed)
  })
})

describe('晚間回顧', () => {
  it('當天首次回顧獲得十經驗值與一次統計，再次儲存只更新內容', () => {
    const onSaved = vi.fn()
    store.on('reviewSaved', onSaved)
    store.saveReview(TODAY, 'sunny', '  今天很充實  ')
    expect(store.state.journal[TODAY]).toEqual({ mood: 'sunny', text: '今天很充實', at: Date.now() })
    expect(store.player.xp).toBe(10)
    expect(store.stats.reviews).toBe(1)
    vi.setSystemTime(new Date(2026, 9, 25, 22))
    store.saveReview(TODAY, 'star', '睡前補記')
    expect(store.state.journal[TODAY]).toEqual({ mood: 'star', text: '睡前補記', at: Date.now() })
    expect(store.player.xp).toBe(10)
    expect(store.stats.reviews).toBe(1)
    expect(onSaved.mock.calls.map(([event]) => event.first)).toEqual([true, false])
  })

  it('無效心情不會新增或覆蓋回顧，也不給獎勵', () => {
    store.saveReview(TODAY, '不存在的心情', '不應儲存')
    expect(store.state.journal[TODAY]).toBeUndefined()
    expect(store.player.xp).toBe(0)
    expect(store.stats.reviews).toBe(0)
    store.saveReview(TODAY, 'rainbow', '保留內容')
    store.saveReview(TODAY, 'invalid', '不應覆蓋')
    expect(store.state.journal[TODAY]).toMatchObject({ mood: 'rainbow', text: '保留內容' })
    expect(store.player.xp).toBe(10)
    expect(store.stats.reviews).toBe(1)
  })
})
