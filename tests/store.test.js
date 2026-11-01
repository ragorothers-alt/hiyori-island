import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Store, addDays, dateStr, minToHHMM, repeatLabel, repeatMatches, toMin, weekKey,
} from '../src/store.js'
import { DAILY_QUESTS } from '../src/data/quests.js'
import { SHOP_ITEMS } from '../src/data/shop.js'
import { levelFromXp, xpNeed, MAX_PROJECTS, TOWER_SLOTS } from '../src/theme.js'
import { LAYOUT } from '../src/scene/island.js'
import { PLAN, TOWN_POINTS, townLevel, levelFor, lotsAt, onStreet, inTown, propPrints, islandRadius, ISLAND_BASE_R } from '../src/data/projectTown.js'

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

  it('截止日可以之後再設、改或拿掉；不合法的日期當成不設', () => {
    const p = store.addProject({ name: '慢慢來', milestones: ['一'], deadline: 'nope' })
    expect(p.deadline).toBe('')
    expect(store.deadlineSoon()).toEqual([])
    store.setDeadline(p.id, '2026-10-26')
    expect(p.deadline).toBe('2026-10-26')
    expect(store.deadlineSoon().map((x) => x.days)).toEqual([1])
    store.setDeadline(p.id, '')
    expect(p.deadline).toBe('')
    expect(store.deadlineSoon()).toEqual([])
    store.setDeadline(p.id, '10/30')
    expect(p.deadline).toBe('')
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

describe('範例資料', () => {
  const fresh = () => {
    localStorage.clear()
    return new Store()
  }

  it('第一次打開有範例，可以一鍵清掉，自己加的資料和經驗值都留著', () => {
    const s = fresh()
    expect(s.sampleCount()).toBe(12)
    expect(s.state.tasks.every((t) => t.id.startsWith('ex-'))).toBe(true)
    s.toggleTask(s.state.tasks[0].id)
    const xp = s.player.xp
    expect(xp).toBeGreaterThan(0)
    const mine = s.addTask({ title: '讀 20 頁書' })
    s.addEvent({ title: '晨間規劃', start: '09:00', end: '09:30' })
    expect(s.clearSamples()).toBe(12)
    expect(s.state.tasks.map((t) => t.id)).toEqual([mine.id])
    expect(s.state.events.map((e) => e.title)).toEqual(['晨間規劃'])
    expect(s.state.projects).toHaveLength(0)
    expect(s.player.xp).toBe(xp)
    expect(s.sampleCount()).toBe(0)
    expect(s.clearSamples()).toBe(0)
  })

  it('舊存檔的範例沒有記號：只認開島那天放的同名項目', () => {
    const s = fresh()
    const old = JSON.parse(s.exportJSON())
    old.version = 1
    for (const list of [old.tasks, old.events, old.projects]) for (const x of list) x.id = x.id.replace('ex-', 'old')
    // 隔天自己加了一個同名任務
    old.tasks.push({ id: 'mine1', title: '喝一杯溫水', date: addDays(TODAY, 1), createdAt: Date.now() + 86400000 })
    setDate(addDays(TODAY, 2))
    s.importJSON(JSON.stringify(old))
    expect(s.sampleCount()).toBe(12)
    s.clearSamples()
    expect(s.state.tasks.map((t) => t.id)).toEqual(['mine1'])
  })

  it('重置小島會變成空島，不再放範例', () => {
    const s = fresh()
    s.addTask({ title: '自己的' })
    s.reset()
    expect(s.state.tasks).toHaveLength(0)
    expect(s.state.events).toHaveLength(0)
    expect(s.state.projects).toHaveLength(0)
    expect(s.sampleCount()).toBe(0)
  })
})

describe('更多專案與專案町的地', () => {
  const add = (name, extra = {}) => store.addProject({ name, milestones: ['一'], ...extra })
  const slots = () => store.towerProjects().map((p) => p.slot).sort((a, b) => a - b)
  // 新的存檔是專案町 Lv.1：開放 4 塊地
  const OPEN = lotsAt(1)

  it('島上的地和場景的空地數量一致', () => {
    expect(LAYOUT.slots).toHaveLength(TOWER_SLOTS)
  })

  it('每個沒收藏的專案都有地：地不夠時城鎮直接長到放得下', () => {
    const grew = vi.fn()
    store.on('projectTownGrew', grew)
    for (let i = 0; i < OPEN; i++) add(`房子 ${i}`)
    expect(grew).not.toHaveBeenCalled()
    const extra = add('多出來的')
    expect(extra.slot).toBe(OPEN)
    expect(slots()).toEqual([...Array(OPEN + 1).keys()])
    expect(store.projectTown.level).toBe(2)
    expect(grew).toHaveBeenCalledTimes(1)
    expect(grew.mock.calls[0][0]).toMatchObject({ level: 2, from: 1, demand: true, island: false })
  })

  it('專案多到要用外圈的地：島跟著變大', () => {
    const grew = vi.fn()
    store.on('projectTownGrew', grew)
    const base = lotsAt(PLAN.island.fromLevel - 1)
    for (let i = 0; i < base; i++) add(`房子 ${i}`)
    expect(grew.mock.calls.every(([e]) => !e.island)).toBe(true)
    const p = add('第一棟外圈的')
    expect(p.slot).toBe(base)
    expect(grew.mock.calls.at(-1)[0]).toMatchObject({ level: PLAN.island.fromLevel, island: true, demand: true })
    expect(islandRadius(store.state.town.plevel)).toBe(PLAN.island.expanded)
  })

  it('進行中的專案有上限；地夠的話全部都有房子', () => {
    while (store.canAddProject()) add('更多')
    expect(store.activeProjects()).toHaveLength(MAX_PROJECTS)
    expect(add('太多了')).toBeNull()
    expect(store.towerProjects()).toHaveLength(Math.min(MAX_PROJECTS, TOWER_SLOTS))
    expect(new Set(slots()).size).toBe(slots().length)
  })

  it('收藏或刪除的專案把地空出來，小鎮不會縮回去；新的專案用最前面的空地', () => {
    const ps = Array.from({ length: OPEN + 1 }, (_, i) => add(`房子 ${i}`))
    expect(store.projectTown.level).toBe(2)
    store.archiveProject(ps[1].id)
    expect(ps[1].slot).toBe(-1)
    store.deleteProject(ps[2].id)
    expect(store.projectTown.level).toBe(2)
    expect(store.state.town.plevel).toBe(2)
    expect(add('新的').slot).toBe(1)
    // 放回收藏的：重新分一塊地
    expect(store.archiveProject(ps[1].id, false)).toBe(true)
    expect(ps[1].slot).toBe(2)
  })

  it('讀檔時重複的地重新分配，進行中超過上限的改為收藏', () => {
    const projects = Array.from({ length: MAX_PROJECTS + 2 }, (_, i) => ({ id: `p${i}`, name: `專案 ${i}`, slot: i < 3 ? 0 : i, createdAt: i + 1, milestones: [] }))
    store.importJSON(JSON.stringify({ tasks: [], player: {}, projects, lotsPlan: 1 }))
    const ps = store.state.projects
    expect(ps.slice(0, 3).map((p) => p.slot)).toEqual([0, 1, 2])
    expect(store.activeProjects()).toHaveLength(MAX_PROJECTS)
    expect(store.towerProjects()).toHaveLength(Math.min(MAX_PROJECTS, TOWER_SLOTS))
    expect(ps.filter((p) => p.archived).map((p) => p.id)).toEqual([`p${MAX_PROJECTS}`, `p${MAX_PROJECTS + 1}`])
  })
})

describe('專案狀態與暫停', () => {
  it('暫停的專案沒有到期提醒，繼續後恢復；已落成的不能暫停', () => {
    const p = store.addProject({ name: '先放著', milestones: ['一', '二'], deadline: TODAY })
    expect(store.projectStatus(p)).toBe('active')
    expect(store.deadlineSoon()).toHaveLength(1)
    store.pauseProject(p.id)
    expect(store.projectStatus(p)).toBe('paused')
    expect(p.pausedAt).toBe(Date.now())
    expect(store.deadlineSoon()).toHaveLength(0)
    store.pauseProject(p.id, false)
    expect(p.pausedAt).toBeNull()
    expect(store.deadlineSoon()).toHaveLength(1)

    const done = store.addProject({ name: '蓋好了', milestones: ['一'] })
    store.toggleMilestone(done.id, done.milestones[0].id)
    store.pauseProject(done.id)
    expect(done.pausedAt).toBeNull()
    expect(store.projectStatus(done)).toBe('done')
  })

  it('暫停中把里程碑做完會直接落成，狀態變成已落成', () => {
    const p = store.addProject({ name: '暫停但做完', milestones: ['一'] })
    store.pauseProject(p.id)
    store.toggleMilestone(p.id, p.milestones[0].id)
    expect(p.completedAt).toBe(Date.now())
    expect(p.pausedAt).toBeNull()
  })

  it('分地時進行中的專案排在暫停的前面', () => {
    store.importJSON(JSON.stringify({
      tasks: [], player: {},
      projects: [
        { id: 'p', name: '暫停的（比較早）', pausedAt: 5, createdAt: 1, milestones: [] },
        { id: 'a', name: '進行中的', createdAt: 2, milestones: [] },
      ],
    }))
    const slot = (id) => store.state.projects.find((p) => p.id === id).slot
    expect([slot('a'), slot('p')]).toEqual([0, 1])
  })

  it('讀檔保留暫停狀態；已落成的專案不會是暫停', () => {
    store.importJSON(JSON.stringify({
      tasks: [], player: {},
      projects: [
        { id: 'a', name: '暫停的', pausedAt: 123, milestones: [] },
        { id: 'b', name: '已落成', pausedAt: 123, completedAt: 456, milestones: [] },
      ],
    }))
    const [a, b] = store.state.projects
    expect(a.pausedAt).toBe(123)
    expect(b.pausedAt).toBeNull()
  })
})

describe('專案町', () => {
  const add = (name, n = 1) => store.addProject({ name, milestones: Array.from({ length: n }, (_, i) => `m${i}`) })
  const finish = (p, k = p.milestones.length) => p.milestones.slice(0, k).forEach((m) => store.toggleMilestone(p.id, m.id))

  it('里程碑 +1、落成專案 +3，點數到了升級；專案數和已經長到的等級也算', () => {
    expect(townLevel({ milestonesDone: 0, projectsDone: 0 })).toEqual({ level: 1, effort: 1, points: 0, lots: 4, next: 5 })
    expect(townLevel({ milestonesDone: 2, projectsDone: 1 })).toEqual({ level: 2, effort: 2, points: 5, lots: 7, next: 15 })
    expect(townLevel({ milestonesDone: 60, projectsDone: 10 })).toMatchObject({ level: 6, points: 90, lots: 20 })
    // 專案比地多：直接長到放得下；小鎮不會縮回去
    expect(townLevel({}, lotsAt(1) + 1)).toMatchObject({ level: 2, effort: 1, lots: lotsAt(2) })
    expect(townLevel({}, 0, 3)).toMatchObject({ level: 3, effort: 1 })
    expect(levelFor(lotsAt(2) + 1)).toBe(3)
    expect(TOWN_POINTS).toHaveLength(PLAN.growth.length)
  })

  it('努力升級：發 projectTownGrew（不是因為專案變多）', () => {
    const big = add('大專案', 5)
    expect(store.state.town.plevel).toBe(1)
    const grew = vi.fn()
    store.on('projectTownGrew', grew)
    finish(big, 4)
    expect(grew).not.toHaveBeenCalled()
    store.toggleMilestone(big.id, big.milestones[4].id)
    // 5 個里程碑 + 落成 3 = 8 點 → Lv.2
    expect(store.projectTown.level).toBe(2)
    expect(grew).toHaveBeenCalledTimes(1)
    expect(grew.mock.calls[0][0]).toMatchObject({ level: 2, from: 1, added: 3, demand: false, island: false })
    expect(store.state.town.plevel).toBe(2)
  })

  it('被商店擺設壓到的地先跳過', () => {
    const lot = PLAN.lots[0]
    store.state.placed.push({ id: 'x1', key: SHOP_ITEMS[0].key, x: lot.x, z: lot.z, rot: 0 })
    const p = add('第一個')
    expect(p.slot).toBe(1)
  })

  it('舊存檔（散在島上的塔位）讀進來時重新排進專案町，全部都有地，進行中的先排', () => {
    const projects = [
      { id: 'done', name: '落成的', slot: 9, completedAt: 5, createdAt: 1, milestones: [{ id: 'm', title: 'm', done: true }] },
      { id: 'a', name: '進行中', slot: 12, createdAt: 2, milestones: [] },
      { id: 'b', name: '暫停', slot: 3, pausedAt: 9, createdAt: 3, milestones: [] },
      { id: 'c', name: '以前移下島的', slot: -1, parked: true, createdAt: 4, milestones: [] },
    ]
    store.importJSON(JSON.stringify({ tasks: [], player: {}, projects }))
    const slot = (id) => store.state.projects.find((p) => p.id === id).slot
    expect([slot('a'), slot('c'), slot('b'), slot('done')]).toEqual([0, 1, 2, 3])
    expect(store.state.lotsPlan).toBe(1)
    // 已經是新版的存檔就照原本的地
    store.importJSON(JSON.stringify({ ...store.state, lotsPlan: 1 }))
    expect(slot('done')).toBe(3)
  })

  it('專案很多的舊存檔：一打開就照專案數長好，不慶祝', () => {
    const projects = Array.from({ length: lotsAt(2) + 1 }, (_, i) => ({ id: `p${i}`, name: `專案 ${i}`, createdAt: i + 1, milestones: [] }))
    const grew = vi.fn()
    store.on('projectTownGrew', grew)
    store.importJSON(JSON.stringify({ tasks: [], player: {}, projects }))
    expect(store.state.town.plevel).toBe(3)
    expect(store.towerProjects()).toHaveLength(projects.length)
    expect(grew).not.toHaveBeenCalled()
  })

  it('剛重置的空島不慶祝，第一次升級才發事件', () => {
    store.reset()
    const grew = vi.fn()
    store.on('projectTownGrew', grew)
    add('小事')
    expect(grew).not.toHaveBeenCalled()
    expect(store.state.town.plevel).toBe(1)
  })

  it('島的大小：用到外圈的地才變大，每塊地都在那一級的島上', () => {
    expect(islandRadius(1)).toBe(ISLAND_BASE_R)
    for (const l of PLAN.lots) {
      const R = islandRadius(l.level)
      const far = Math.hypot(Math.abs(l.x) + l.size / 2, Math.abs(l.z) + l.size / 2)
      expect(Math.min(far, Math.hypot(l.x, l.z) + l.size * 0.71), l.id).toBeLessThanOrEqual(R - 0.4)
    }
  })
})

describe('專案町的總平面', () => {
  // 正方形地塊的四個角
  const corners = (l) => {
    const h = l.size / 2
    const c = Math.cos(l.rot)
    const s = Math.sin(l.rot)
    return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, z]) => [l.x + x * c + z * s, l.z - x * s + z * c])
  }

  it('地塊數、成長級數和場景、theme 一致；進行中的專案都放得下', () => {
    expect(PLAN.lots).toHaveLength(TOWER_SLOTS)
    expect(TOWER_SLOTS).toBeGreaterThanOrEqual(MAX_PROJECTS)
    expect(LAYOUT.slots).toHaveLength(TOWER_SLOTS)
    expect(PLAN.growth.at(-1)).toBe(TOWER_SLOTS)
    PLAN.growth.forEach((n, i) => {
      expect(PLAN.lots.slice(0, n).every((l) => l.level <= i + 1)).toBe(true)
      expect(PLAN.lots.slice(n).every((l) => l.level > i + 1)).toBe(true)
    })
  })

  it('地塊彼此不重疊、在島內、不壓到廣場和街道', () => {
    PLAN.lots.forEach((a, i) => {
      // 外圈的地在島變大以後才開：離島緣至少 0.5
      for (const [x, z] of corners(a)) expect(Math.hypot(x, z)).toBeLessThanOrEqual(islandRadius(a.level) - 0.5 + 1e-9)
      PLAN.lots.forEach((b, j) => {
        if (j <= i) return
        // 朝向都是 90° 的倍數：軸對齊的正方形，間距 ≥ 0.35
        const gap = Math.max(Math.abs(a.x - b.x) - (a.size + b.size) / 2, Math.abs(a.z - b.z) - (a.size + b.size) / 2)
        expect(gap).toBeGreaterThanOrEqual(0.35 - 1e-9)
      })
      // 地塊內部抽樣：不在任何街道或廣場上
      const h = a.size / 2 - 0.02
      for (let u = -h; u <= h; u += h / 4) for (let v = -h; v <= h; v += h / 4) {
        const c = Math.cos(a.rot)
        const s = Math.sin(a.rot)
        expect(onStreet(a.x + u * c + v * s, a.z - u * s + v * c)).toBe(false)
      }
    })
  })

  it('每塊地的正面都接到當級已經鋪好的街道', () => {
    for (const l of PLAN.lots) {
      const fx = l.x + Math.sin(l.rot) * (l.size / 2 + 0.25)
      const fz = l.z + Math.cos(l.rot) * (l.size / 2 + 0.25)
      expect(onStreet(fx, fz, 0, l.level), l.id).toBe(true)
    }
  })

  // 點到地塊（旋轉正方形）的距離，在地裡面是 0
  const lotDist = (l, x, z) => {
    const dx = x - l.x
    const dz = z - l.z
    const c = Math.cos(l.rot)
    const s = Math.sin(l.rot)
    const u = Math.max(0, Math.abs(dx * c - dz * s) - l.size / 2)
    const v = Math.max(0, Math.abs(dx * s + dz * c) - l.size / 2)
    return Math.hypot(u, v)
  }

  it('小物不壓到地塊；inTown 涵蓋地、街道與小物', () => {
    for (const p of PLAN.props) {
      for (const [x, z, r] of propPrints(p)) expect(Math.min(...PLAN.lots.map((l) => lotDist(l, x, z))), `${p.type} ${p.x},${p.z}`).toBeGreaterThanOrEqual(r)
      for (const [x, z] of propPrints(p)) expect(inTown(x, z)).toBe(true)
    }
    expect(inTown(PLAN.lots[3].x, PLAN.lots[3].z)).toBe(true)
    expect(inTown(PLAN.plaza.x, PLAN.plaza.z)).toBe(true)
    // 前方的小徑、池塘、花圃不屬於專案町
    expect(inTown(0, 8)).toBe(false)
    expect(inTown(LAYOUT.pond.x, LAYOUT.pond.z)).toBe(false)
    expect(inTown(LAYOUT.bed.x, LAYOUT.bed.z)).toBe(false)
  })
})

describe('番茄鐘長度與專注時段', () => {
  it('長度、休息、輪數存在設定裡，匯出匯入後還在；超出範圍的會被修正', () => {
    expect(store.state.settings).toMatchObject({ focusMin: 25, breakMin: 5, focusRounds: 1 })
    store.setSetting('focusMin', 0)
    store.setSetting('breakMin', 10)
    store.setSetting('focusRounds', 3)
    store.importJSON(store.exportJSON())
    expect(store.state.settings).toMatchObject({ focusMin: 0, breakMin: 10, focusRounds: 3 })
    store.importJSON(JSON.stringify({ tasks: [], player: {}, settings: { focusMin: 999, breakMin: -3, focusRounds: 9 } }))
    expect(store.state.settings).toMatchObject({ focusMin: 180, breakMin: 1, focusRounds: 4 })
    store.importJSON(JSON.stringify({ tasks: [], player: {}, settings: { focusMin: 'abc' } }))
    expect(store.state.settings.focusMin).toBe(25)
  })

  it('XP 依長度給：25 分是原本的份量，短的至少四成、長的最多兩倍', () => {
    const gain = (min) => {
      const xp = store.player.xp
      store.completePomodoro(min)
      return store.player.xp - xp
    }
    expect(gain(25)).toBe(15)
    expect(gain(10)).toBe(6)
    expect(gain(5)).toBe(6)
    expect(gain(50)).toBe(30)
    expect(gain(90)).toBe(30)
    expect(store.stats.pomodoros).toBe(5)
    expect(store.stats.focusMinutes).toBe(180)
  })

  it('專注分鐘依中間的時間點記進早上／下午／晚上／深夜', () => {
    setDate(TODAY, 10)
    store.completePomodoro(30)
    setDate(TODAY, 19)
    store.completePomodoro(50)
    // 12:20 結束的 50 分鐘：中間點 11:55，算早上
    vi.setSystemTime(new Date(2026, 9, 25, 12, 20))
    store.completePomodoro(50)
    vi.setSystemTime(new Date(2026, 9, 25, 2, 30))
    store.completePomodoro(25)
    const d = store.peekDay(TODAY)
    expect(d).toMatchObject({ focusAm: 80, focusPm: 0, focusEve: 50, focusLate: 25, focus: 155 })
    store.importJSON(store.exportJSON())
    expect(store.peekDay(TODAY).focusAm).toBe(80)
  })
})

describe('ふじ的排程教練與重要日子', () => {
  const res = (date = TODAY) => ({
    days: [
      { date, items: [{ title: '數學・預習', tag: 'study', dur: 50, at: '19:30', priority: 2 }, { title: '英文・複習', tag: 'study', dur: 25, at: '20:30', priority: 3 }] },
      { date: addDays(date, 2), items: [{ title: '數學・練習題', tag: 'study', dur: 50, at: '19:30', priority: 2 }] },
    ],
  })

  it('套用：一次建好有時段、有預估時間的任務，記得是哪一次排程；今天第一次套用給 XP', () => {
    const onApplied = vi.fn()
    store.on('coachApplied', onApplied)
    const xp = store.player.xp
    const id = store.applyCoachPlan(res(), { title: '數學、英文', answers: { focus: ['數學'], slots: ['wdEve'], days: 3, len: 25 }, custom: [{ label: '數學', tag: 'study' }] })
    const made = store.state.tasks.filter((t) => t.coach === id)
    expect(made).toHaveLength(3)
    expect(made[0]).toMatchObject({ title: '數學・預習', date: TODAY, at: '19:30', dur: 50, tag: 'study', priority: 2 })
    expect(made[1].priority).toBe(3)
    expect(store.player.xp - xp).toBe(10)
    expect(store.stats.plansApplied).toBe(1)
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ id, count: 3, days: 2 }))
    expect(store.state.coach.plans).toEqual([expect.objectContaining({ id, title: '數學、英文', from: TODAY, to: addDays(TODAY, 2), count: 3 })])
    expect(store.state.coach.last).toEqual({ focus: ['數學'], slots: ['wdEve'], days: 3, len: 25 })
    expect(store.state.coach.items).toEqual([{ label: '數學', tag: 'study' }])
    // 第二次套用不再給 XP；過去的日子不建
    store.applyCoachPlan(res(addDays(TODAY, -1)))
    expect(store.player.xp - xp).toBe(10)
    expect(store.state.tasks.some((t) => t.date < TODAY && t.coach)).toBe(false)
  })

  it('撤銷：刪掉還沒完成的，做完的留著；匯出匯入後排程紀錄和任務的來源還在', () => {
    const id = store.applyCoachPlan(res())
    const first = store.state.tasks.find((t) => t.coach === id)
    store.toggleTask(first.id)
    store.importJSON(store.exportJSON())
    expect(store.coachLeft(id)).toBe(2)
    expect(store.state.coach.plans).toHaveLength(1)
    expect(store.undoCoachPlan(id)).toBe(2)
    expect(store.state.tasks.filter((t) => t.coach === id)).toHaveLength(1)
    expect(store.state.coach.plans).toHaveLength(0)
  })

  it('最近的排程最多留 10 筆、自己加的主攻項目最多 12 個，新的在前', () => {
    for (let i = 0; i < 12; i++) store.applyCoachPlan(res(), { custom: [{ label: `項目${i}`, tag: 'work' }] })
    for (let i = 0; i < 2; i++) store.applyCoachPlan(res(), { custom: [{ label: `項目x${i}` }] })
    expect(store.state.coach.plans).toHaveLength(10)
    expect(store.state.coach.items).toHaveLength(12)
    expect(store.state.coach.items[0]).toEqual({ label: '項目x1', tag: 'study' })
  })

  it('重要日子：新增、倒數、連同專案截止日一起列；過去的不列；刪除', () => {
    const onAdd = vi.fn()
    store.on('dateAdded', onAdd)
    const exam = store.addDate({ title: '期中考', date: addDays(TODAY, 12), kind: 'exam' })
    store.addDate({ title: '結婚紀念日', date: addDays(TODAY, 1), kind: 'day' })
    store.addDate({ title: '去年的考試', date: addDays(TODAY, -3) })
    expect(store.addDate({ title: '', date: TODAY })).toBeNull()
    expect(store.addDate({ title: '沒有日期', date: 'x' })).toBeNull()
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ title: '期中考', days: 12 }))
    store.addProject({ name: '官網改版', deadline: addDays(TODAY, 5), milestones: ['切版'] })
    const up = store.upcomingDates()
    expect(up.map((d) => [d.title, d.days, d.kind])).toEqual([['結婚紀念日', 1, 'day'], ['官網改版', 5, 'deadline'], ['期中考', 12, 'exam']])
    expect(up[1].project).toBe(true)
    expect(store.datesOn(addDays(TODAY, 12))).toHaveLength(1)
    store.importJSON(store.exportJSON())
    expect(store.state.dates).toHaveLength(3)
    store.deleteDate(exam.id)
    expect(store.upcomingDates().map((d) => d.title)).toEqual(['結婚紀念日', '官網改版'])
  })

  it('排程的避開清單：這幾天的日程、未來的例行公事日程、排了時段的任務', () => {
    store.addEvent({ title: '開會', start: '19:00', end: '20:00', date: TODAY })
    store.addRoutine({ kind: 'event', title: '晚課', repeat: { type: 'daily' }, start: '21:00', end: '22:00', date: TODAY })
    const t = store.addTask({ title: '寫報告', date: addDays(TODAY, 1), at: '20:00', dur: 30 })
    store.addTask({ title: '沒排時段', date: addDays(TODAY, 1) })
    const ctx = store.coachContext([TODAY, addDays(TODAY, 1)])
    expect(ctx.events.map((e) => e.title || e.start)).toEqual(expect.arrayContaining(['開會', '21:00']))
    expect(ctx.events.filter((e) => e.date === addDays(TODAY, 1) && e.start === '21:00')).toHaveLength(1)
    expect(ctx.tasks.map((x) => x.id)).toEqual([t.id])
    expect(ctx.rhythm).toBe(store.state.rhythm)
  })
})

describe('週報', () => {
  // TODAY（2026-10-25）是星期日；這週從 10-19 開始
  it('本週到目前：完成率用那幾天的任務算，專注、番茄、本命、習慣達成、有在用的日子', () => {
    setDate('2026-10-21')
    completeTask('a', { date: '2026-10-21' })
    const b = store.addTask({ title: 'b', date: '2026-10-21' })
    store.toggleStar(b.id)
    store.addTask({ title: 'c', date: '2026-10-20' })
    store.addTask({ title: '下週的', date: '2026-10-27' })
    store.completePomodoro(25)
    store.completePomodoro(50)
    const r = store.weekReport()
    expect(r).toMatchObject({ week: '2026-10-19', end: '2026-10-21', days: 3, total: 3, done: 1, focus: 75, pomodoros: 2, starTotal: 1, active: 1, habitRate: null })
    expect(r.rate).toBeCloseTo(1 / 3)
    // 指定到哪天為止（跟上週同一段比用）
    expect(store.weekReport('2026-10-19', '2026-10-20').total).toBe(1)
  })

  it('記憶圖鑑：往回幾週有在用的才收，新的在前；有用過的日子', () => {
    setDate('2026-10-07')
    completeTask('十月第一週')
    setDate('2026-10-21')
    completeTask('這週')
    const album = store.weekAlbum(4)
    expect(album.map((w) => w.week)).toEqual(['2026-10-05'])
    expect(album[0].rate).toBe(1)
    expect(store.usedDays()).toBe(2)
  })
})
