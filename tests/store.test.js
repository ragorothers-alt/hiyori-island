import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Store, addDays, dateStr, minToHHMM, repeatLabel, repeatMatches, toMin, weekKey,
} from '../src/store.js'
import { DAILY_QUESTS } from '../src/data/quests.js'
import { SHOP_ITEMS } from '../src/data/shop.js'
import { levelFromXp, xpNeed } from '../src/theme.js'

const TODAY = '2026-10-25'
const QUEST_IDS = DAILY_QUESTS.map((q) => q.id)
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
    expect(onXp).toHaveBeenCalledExactlyOnceWith({ amount: xp, coins, kind: 'task', id: task.id, tired: false })
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

describe('本命與每日上限', () => {
  it('每天最多 3 件本命，第 4 件會發出已滿事件', () => {
    const tasks = ['甲', '乙', '丙', '丁'].map((title) => store.addTask({ title }))
    const onFull = vi.fn()
    store.on('starFull', onFull)
    tasks.forEach((t) => store.toggleStar(t.id))
    expect(store.starsOn(TODAY).map((t) => t.title)).toEqual(['甲', '乙', '丙'])
    expect(onFull).toHaveBeenCalledTimes(1)
    store.toggleStar(tasks[0].id)
    expect(tasks[0].star).toBe(false)
    store.toggleStar(tasks[3].id)
    expect(tasks[3].star).toBe(true)
  })

  it('已完成或過去日期的任務不能新選為本命', () => {
    const done = completeTask('已完成')
    store.toggleStar(done.id)
    expect(done.star).toBeFalsy()
    const past = store.addTask({ title: '昨天的', date: '2026-10-24' })
    store.toggleStar(past.id)
    expect(past.star).toBeFalsy()
  })

  it('完成本命給雙倍 XP，三件全清再加 30 XP 並記一天', () => {
    const tasks = ['甲', '乙', '丙', '待辦'].map((title) => store.addTask({ title, priority: 2 }))
    tasks.slice(0, 3).forEach((t) => store.toggleStar(t.id))
    const onAll = vi.fn()
    store.on('starAll', onAll)
    store.toggleTask(tasks[0].id)
    expect(store.player.xp).toBe(30)
    store.toggleTask(tasks[1].id)
    store.toggleTask(tasks[2].id)
    expect(store.player.xp).toBe(30 * 3 + 30)
    expect(store.stats.starsDone).toBe(3)
    expect(store.stats.starDays).toBe(1)
    expect(store.peekDay(TODAY)).toMatchObject({ stars: 3, starAll: true })
    expect(onAll).toHaveBeenCalledTimes(1)
    // 取消再完成不會重複給
    store.toggleTask(tasks[2].id)
    store.toggleTask(tasks[2].id)
    expect(store.player.xp).toBe(120)
  })

  it('中午前選滿 3 件本命會記下「有計畫」', () => {
    vi.setSystemTime(new Date(2026, 9, 25, 9))
    const tasks = ['甲', '乙', '丙'].map((title) => store.addTask({ title }))
    tasks.forEach((t) => store.toggleStar(t.id))
    expect(store.peekDay(TODAY).plan).toBe(1)
  })

  it('下午才選滿不算有計畫', () => {
    vi.setSystemTime(new Date(2026, 9, 25, 15))
    const tasks = ['甲', '乙', '丙'].map((title) => store.addTask({ title }))
    tasks.forEach((t) => store.toggleStar(t.id))
    expect(store.peekDay(TODAY).plan).toBe(0)
  })

  it('同一天完成超過 8 個任務後，XP 減半並提醒一次', () => {
    const onTired = vi.fn()
    store.on('tired', onTired)
    for (let i = 0; i < 8; i++) completeTask(`第${i}件`, { priority: 2 })
    // 第 3 件之後就是完美日（每次都全部完成），先記下目前 XP
    const before = store.player.xp
    completeTask('第九件', { priority: 2 })
    expect(store.player.xp - before).toBe(8)
    completeTask('第十件', { priority: 2 })
    expect(onTired).toHaveBeenCalledTimes(1)
    expect(onTired).toHaveBeenCalledWith({ count: 9 })
  })

  it('完成任務會記下分類、高優先、中午前與例行的次數', () => {
    vi.setSystemTime(new Date(2026, 9, 25, 10))
    completeTask('工作', { tag: 'work', priority: 3 })
    completeTask('學習', { tag: 'study' })
    completeTask('又是工作', { tag: 'work' })
    const d = store.peekDay(TODAY)
    expect(d.tagMask).toBe(0b11)
    expect(d.high).toBe(1)
    expect(d.early).toBe(3)
  })
})

describe('每日任務', () => {
  // 固定今天的三個任務，讓測試不受抽選影響
  const useQuests = (ids) => (store.state.quests[TODAY] = { ids, claimed: {} })

  it('每天抽簡單、普通、挑戰各一個，同一天固定不變', () => {
    const ids = store.quests().map((q) => q.id)
    expect(ids).toHaveLength(3)
    expect(store.quests().map((q) => q.tier)).toEqual(['easy', 'normal', 'hard'])
    store.selectDate('2026-10-27')
    store.selectDate(TODAY)
    expect(store.quests().map((q) => q.id)).toEqual(ids)
    expect(QUEST_IDS).toEqual(expect.arrayContaining(ids))
  })

  it('做不到的任務不會被抽到：沒有日程就不抽「完成 2 個日程」', () => {
    for (let i = 1; i < 40; i++) {
      setDate(addDays(TODAY, i), 15)
      store.tick()
      const ids = store.quests().map((q) => q.id)
      expect(ids).not.toContain('event2')
      expect(ids).not.toContain('routine2')
      // 下午才打開，中午前的任務也不抽
      expect(ids).not.toContain('plan')
      expect(ids).not.toContain('early2')
    }
  })

  it('連續兩天同一格不會抽到同一個任務', () => {
    let prev = store.quests().map((q) => q.id)
    for (let i = 1; i < 20; i++) {
      setDate(addDays(TODAY, i))
      store.tick()
      const ids = store.quests().map((q) => q.id)
      ids.forEach((id, k) => expect(id).not.toBe(prev[k]))
      prev = ids
    }
  })

  it('完成三個任務後可領三十經驗值，重複領取無效', () => {
    useQuests(['tasks3', 'focus2', 'step1'])
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

  it('未達目標、不存在或今天沒抽到的每日任務無法領取獎勵', () => {
    useQuests(['tasks3', 'focus2', 'step1'])
    const onClaimed = vi.fn()
    store.on('questClaimed', onClaimed)
    completeTask()
    store.claimQuest('tasks3')
    store.claimQuest('不存在')
    store.claimQuest('star1')
    expect(store.player.xp).toBe(15)
    expect(store.stats.questsClaimed).toBe(0)
    expect(store.quests().find((quest) => quest.id === 'tasks3')).toMatchObject({ value: 1, ready: false, claimed: false })
    expect(onClaimed).not.toHaveBeenCalled()
  })

  it('摸摸もち三次可以達成「摸摸」任務', () => {
    useQuests(['pet3', 'focus2', 'tasks5'])
    const onReady = vi.fn()
    store.on('questReady', onReady)
    store.pet()
    store.pet()
    expect(onReady).not.toHaveBeenCalled()
    store.pet()
    expect(onReady).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'pet3' }))
  })

  it('寫下今天的回顧會達成回顧任務', () => {
    useQuests(['tasks3', 'review', 'tasks5'])
    store.saveReview(TODAY, 'sunny', '')
    expect(store.quests().find((q) => q.id === 'review').ready).toBe(true)
  })

  it('新的一天會重新抽任務，進度與領取狀態歸零', () => {
    useQuests(['tasks3', 'focus2', 'step1'])
    for (const title of ['甲', '乙', '丙']) completeTask(title)
    store.claimQuest('tasks3')
    setDate('2026-10-26')
    store.tick()
    expect(store.quests().every((quest) => quest.value === 0 && !quest.ready && !quest.claimed)).toBe(true)
  })

  it('舊存檔的固定任務格式會轉成新格式並保留領取紀錄', () => {
    store.importJSON(JSON.stringify({ tasks: [], player: {}, quests: { [TODAY]: { tasks3: true } } }))
    expect(store.state.quests[TODAY]).toEqual({ ids: ['tasks3', 'focus2', 'step1'], claimed: { tasks3: true } })
  })
})

describe('每週挑戰', () => {
  const useWeekly = (id) => (store.state.weekly[weekKey(store.today)] = { id, claimed: false })

  it('一週從星期一開始', () => {
    expect(weekKey('2026-10-25')).toBe('2026-10-19') // 週日
    expect(weekKey('2026-10-26')).toBe('2026-10-26') // 週一
    expect(weekKey('2026-10-28')).toBe('2026-10-26')
  })

  it('每週抽一個挑戰，下週不會跟這週一樣', () => {
    const a = store.weekly()
    expect(a.week).toBe('2026-10-19')
    setDate('2026-10-27')
    store.tick()
    const b = store.weekly()
    expect(b.week).toBe('2026-10-26')
    expect(b.id).not.toBe(a.id)
  })

  it('達成後領取：給 XP，並把下一件限定擺飾解鎖、第一件免費', () => {
    useWeekly('w_tasks20')
    const onReady = vi.fn()
    const onClaimed = vi.fn()
    store.on('weeklyReady', onReady)
    store.on('weeklyClaimed', onClaimed)
    store.state.history['2026-10-20'] = { ...store.peekDay('2026-10-20'), tasks: 19 }
    completeTask()
    expect(onReady).toHaveBeenCalledTimes(1)
    const xp = store.player.xp
    const next = store.nextExclusive()
    store.claimWeekly()
    expect(store.player.xp - xp).toBe(100)
    expect(store.stats.weeklyClaimed).toBe(1)
    expect(onClaimed.mock.calls[0][0].item).toBe(next)
    if (next) {
      expect(store.player.unlocked[next.key]).toBe(true)
      expect(store.player.freebies[next.key]).toBe(1)
    }
    store.claimWeekly()
    expect(store.stats.weeklyClaimed).toBe(1)
  })

  it('沒達成不能領', () => {
    useWeekly('w_tasks20')
    completeTask()
    store.claimWeekly()
    expect(store.stats.weeklyClaimed).toBe(0)
  })

  it('這週的累計只算星期一到今天', () => {
    setDate('2026-10-28')
    store.tick()
    store.state.history['2026-10-25'] = { ...store.peekDay('2026-10-25'), tasks: 9 } // 上週日
    store.state.history['2026-10-26'] = { ...store.peekDay('2026-10-26'), tasks: 2, focus: 50 }
    store.state.history['2026-10-27'] = { ...store.peekDay('2026-10-27'), tasks: 1, starAll: true }
    store.state.history['2026-10-29'] = { ...store.peekDay('2026-10-29'), tasks: 5 } // 還沒到
    expect(store.weekStats()).toMatchObject({ activeDays: 2, tasks: 3, focus: 50, starAllDays: 1 })
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

describe('專案期限', () => {
  it('在期限當天或之前落成，額外 +60 XP 並記下準時', () => {
    const p = store.addProject({ name: '準時專案', milestones: ['一'], deadline: TODAY })
    const onTime = vi.fn()
    store.on('projectOnTime', onTime)
    store.toggleMilestone(p.id, p.milestones[0].id)
    expect(store.player.xp).toBe(25 + 120 + 60)
    expect(p.onTime).toBe(true)
    expect(store.stats.projectsOnTime).toBe(1)
    expect(onTime).toHaveBeenCalledExactlyOnceWith(p)
  })

  it('過了期限才落成沒有額外獎勵；沒設期限也沒有', () => {
    const late = store.addProject({ name: '晚了', milestones: ['一'], deadline: '2026-10-20' })
    const none = store.addProject({ name: '沒期限', milestones: ['一'] })
    store.toggleMilestone(late.id, late.milestones[0].id)
    store.toggleMilestone(none.id, none.milestones[0].id)
    expect(store.player.xp).toBe((25 + 120) * 2)
    expect(late.onTime).toBeFalsy()
    expect(store.stats.projectsOnTime).toBe(0)
  })

  it('列出兩天內到期、還沒落成的專案，最急的在前', () => {
    const a = store.addProject({ name: '後天', milestones: ['一'], deadline: '2026-10-27' })
    const b = store.addProject({ name: '今天', milestones: ['一'], deadline: TODAY })
    store.addProject({ name: '下週', milestones: ['一'], deadline: '2026-11-01' })
    store.addProject({ name: '已逾期', milestones: ['一'], deadline: '2026-10-20' })
    expect(store.deadlineSoon().map((x) => [x.project.id, x.days])).toEqual([[b.id, 0], [a.id, 2]])
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

describe('お守り與逾期的花', () => {
  it('金平糖夠就能買，最多帶 2 個', () => {
    store.player.coins = 200
    store.buyCharm()
    store.buyCharm()
    store.buyCharm()
    expect(store.player.charms).toBe(2)
    expect(store.coins).toBe(100)
  })

  it('漏掉一天時自動用掉一個，連續天數保住', () => {
    completeTask()
    setDate('2026-10-26')
    store.tick()
    completeTask()
    expect(store.streak).toBe(2)
    store.player.charms = 1
    const onUsed = vi.fn()
    store.on('charmUsed', onUsed)
    // 10/27 沒有完成任何任務，10/28 打開 App
    setDate('2026-10-28')
    store.tick()
    expect(store.player.charms).toBe(0)
    expect(store.stats.charmsUsed).toBe(1)
    expect(store.streak).toBe(2)
    expect(onUsed).toHaveBeenCalledWith({ used: 1, streak: 2, left: 0 })
    completeTask()
    expect(store.streak).toBe(3)
  })

  it('漏掉的天數比お守り多就不用，連續天數照常中斷', () => {
    completeTask()
    store.player.charms = 1
    setDate('2026-10-28')
    store.tick()
    expect(store.player.charms).toBe(1)
    expect(store.streak).toBe(0)
  })

  it('打開 App 時就會套用（換日時 App 沒開著）', () => {
    completeTask()
    store.player.charms = 2
    store.saveNow()
    setDate('2026-10-28')
    const next = new Store()
    expect(next.player.charms).toBe(0)
    expect(next.streak).toBe(1)
  })

  it('看今天的花圃時，會多種上最近 7 天沒完成的任務與今天才補完成的', () => {
    const late = store.addTask({ title: '前天的', date: '2026-10-23' })
    const old = store.addTask({ title: '很久以前的', date: '2026-10-10' })
    const doneEarly = store.addTask({ title: '昨天就完成的', date: '2026-10-24' })
    store.toggleTask(doneEarly.id)
    vi.setSystemTime(new Date(2026, 9, 26, 9))
    store.tick()
    const today = store.addTask({ title: '今天的' })
    const ids = () => store.gardenTasks(store.today).map((t) => t.id)
    expect(ids()).toEqual(expect.arrayContaining([today.id, late.id]))
    expect(ids()).not.toContain(old.id)
    expect(ids()).not.toContain(doneEarly.id)
    const onRevive = vi.fn()
    store.on('revive', onRevive)
    store.toggleTask(late.id)
    expect(onRevive).toHaveBeenCalledTimes(1)
    expect(ids()).toContain(late.id)
    expect(store.gardenTasks('2026-10-23').map((t) => t.id)).toEqual([late.id])
  })
})

describe('上週回顧卡', () => {
  // 今天 10/25 是週日，所以「上週」是 10/12–10/18
  const fill = (date, patch) => (store.state.history[date] = { ...store.peekDay(date), ...patch })

  it('彙整上週七天：開花、專注、本命、最充實的一天、心情與新發現的花', () => {
    fill('2026-10-13', { tasks: 3, focus: 50, stars: 2 })
    fill('2026-10-15', { tasks: 6, perfect: true })
    fill('2026-10-19', { tasks: 9 }) // 這週，不算
    store.state.journal['2026-10-14'] = { mood: 'sunny', text: '', at: 1 }
    store.state.dex.kikyo = { at: '2026-10-15', n: 1 }
    store.state.dex.sumire = { at: '2026-10-20', n: 1 }
    const w = store.weekSummary()
    expect(w).toMatchObject({ week: '2026-10-12', end: '2026-10-18', tasks: 9, focus: 50, stars: 2, activeDays: 2, perfectDays: 1, tier: 'gentle' })
    expect(w.best).toEqual({ date: '2026-10-15', tasks: 6 })
    expect(w.moods).toEqual([null, null, 'sunny', null, null, null, null])
    expect(w.flowers.map((f) => f.key)).toEqual(['kikyo'])
  })

  it('上週很充實就是 great', () => {
    for (const d of ['12', '13', '14', '15', '16']) fill(`2026-10-${d}`, { tasks: 1 })
    expect(store.weekSummary().tier).toBe('great')
  })

  it('上週有在用、還沒看過才顯示，看過就不再出現', () => {
    expect(store.weekCardDue()).toBe(false)
    fill('2026-10-16', { tasks: 1 })
    expect(store.weekCardDue()).toBe(true)
    store.seenWeekCard()
    expect(store.weekCardDue()).toBe(false)
    expect(store.state.weekCard).toBe('2026-10-12')
  })
})

describe('もち和ふじ的好感度', () => {
  it('摸摸一天最多算 5 次', () => {
    const before = store.player.bond.pts
    for (let i = 0; i < 8; i++) store.pet()
    expect(store.player.bond.pts - before).toBe(5)
    expect(store.stats.pets).toBe(8)
  })

  it('每天第一次打開 +2，專注 +3，第一次回顧 +4', () => {
    const b = store.player.bond
    const p0 = b.pts
    setDate('2026-10-26')
    store.tick()
    expect(b.pts - p0).toBe(2)
    store.tick()
    expect(b.pts - p0).toBe(2)
    store.completePomodoro(25)
    expect(b.pts - p0).toBe(5)
    store.saveReview(store.today, 'sunny', '')
    store.saveReview(store.today, 'rain', '')
    expect(b.pts - p0).toBe(9)
  })

  it('升級會發事件並帶上解鎖內容', () => {
    const onUp = vi.fn()
    store.on('bondUp', onUp)
    store.player.bond.pts = 9
    store.completePomodoro(25)
    expect(onUp).toHaveBeenCalledWith(expect.objectContaining({ level: 2, reward: { outfit: 'crown' } }))
  })

  it('衣裝要到好感度等級才能換', () => {
    store.setOutfit('crown')
    expect(store.player.bond.outfit).toBe('none')
    store.player.bond.pts = 12
    store.setOutfit('crown')
    expect(store.player.bond.outfit).toBe('crown')
    store.setOutfit('wagasa')
    expect(store.player.bond.outfit).toBe('crown')
  })

  it('兩人各自換衣裝，互不影響', () => {
    const onOutfit = vi.fn()
    store.on('outfit', onOutfit)
    store.player.bond.pts = 70
    store.setOutfit('straw', 'fuji')
    expect(store.player.bond).toMatchObject({ outfit: 'none', outfitFuji: 'straw' })
    expect(onOutfit).toHaveBeenCalledWith({ key: 'straw', who: 'fuji' })
    store.setOutfit('crown')
    expect(store.player.bond).toMatchObject({ outfit: 'crown', outfitFuji: 'straw' })
  })

  it('好感度 7 級起，每天第一次打開會收到 3–6 顆金平糖', () => {
    store.player.bond.pts = 240
    const onGift = vi.fn()
    store.on('gift', onGift)
    const coins = store.coins
    setDate('2026-10-26')
    store.tick()
    expect(onGift).toHaveBeenCalledTimes(1)
    const got = onGift.mock.calls[0][0].coins
    expect(got).toBeGreaterThanOrEqual(3)
    expect(got).toBeLessThanOrEqual(6)
    expect(store.coins - coins).toBe(got)
    store.tick()
    expect(onGift).toHaveBeenCalledTimes(1)
  })

  it('舊存檔沒有好感度時從 0 開始，壞掉的衣裝改回預設', () => {
    store.importJSON(JSON.stringify({ tasks: [], player: { bond: { pts: 40, outfit: '不存在' } } }))
    expect(store.player.bond).toMatchObject({ pts: 40, outfit: 'none', outfitFuji: 'none' })
    store.importJSON(JSON.stringify({ tasks: [], player: {} }))
    expect(store.player.bond.pts).toBeGreaterThanOrEqual(0)
  })
})

describe('商店上架條件', () => {
  const item = (key) => SHOP_ITEMS.find((i) => i.key === key)

  it('等級不夠的商品還沒上架，買不了', () => {
    store.player.coins = 999
    expect(store.shopStatus(item('tanuki'))).toMatchObject({ ok: false, lock: 'Lv.6 上架' })
    expect(store.placeItem('tanuki', 1, 1)).toBeNull()
    store.player.xp = 2000
    expect(store.shopStatus(item('tanuki')).ok).toBe(true)
  })

  it('季節限定只在那個季節買得到（今天是秋天）', () => {
    store.player.coins = 999
    expect(store.shopStatus(item('koinobori')).lock).toBe('春天限定')
    expect(store.shopStatus(item('tsukimi')).ok).toBe(true)
  })

  it('每週限定在拿到之前不顯示；拿到後第一件免費，收起來會把免費券還回去', () => {
    const ex = store.nextExclusive()
    expect(ex.exclusive).toBe(true)
    expect(store.shopStatus(ex).hidden).toBe(true)
    store.player.unlocked[ex.key] = true
    store.player.freebies[ex.key] = 1
    store.player.coins = 0
    expect(store.shopStatus(ex)).toMatchObject({ ok: true, free: true, price: 0 })
    const placed = store.placeItem(ex.key, 1, 1)
    expect(placed.free).toBe(true)
    expect(store.player.freebies[ex.key]).toBe(0)
    expect(store.shopStatus(ex)).toMatchObject({ ok: false, price: ex.price })
    store.storeItem(placed.id)
    expect(store.coins).toBe(0)
    expect(store.player.freebies[ex.key]).toBe(1)
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
