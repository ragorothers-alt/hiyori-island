// App 模式的主要流程：ふじ排的計畫套用、撤銷；專案搜尋；平板上專案的任務欄；練習曲的速度；番茄鐘計時重新整理後接著算；專注頁的貓咪
import { bootReady, chatSaid, expect, noFonts, swReady, test, toastSeen, useAppMode } from './fixtures.js'

// 計時那幾張提示卡上的按鈕：每日任務、每週挑戰達成那張有「領取」，不算（做完一輪專注時常常剛好達成）
const timerActs = (page) => page.locator('#toasts .toast').filter({ hasNot: page.getByRole('button', { name: '領取', exact: true }) }).locator('.toast-acts')

test('教練：一行輸入排下週，預覽、套用變成任務，撤銷後又拿掉', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => window.hiyori.ui.setTab('coach'))
  const root = page.locator('#coachRoot')
  await expect(root.locator('input[name="say"]')).toBeVisible()

  // 下週一整週一定有空：不會因為測試跑的時間太晚而排不進去
  await root.locator('input[name="say"]').fill('下週的數學複習 3小時')
  await root.locator('input[name="say"]').press('Enter')
  const apply = root.locator('[data-act="apply"]').last()
  await expect(apply).toBeVisible()

  const before = await page.evaluate(() => window.hiyori.store.state.tasks.filter((t) => t.coach).length)
  await apply.click()
  await expect.poll(() => page.evaluate(() => window.hiyori.store.state.tasks.filter((t) => t.coach).length)).toBeGreaterThan(before)
  const made = await page.evaluate(() => window.hiyori.store.state.tasks.filter((t) => t.coach).map((t) => t.title))
  expect(made.some((t) => t.includes('數學'))).toBe(true)

  // 撤銷這次排程：還沒做的都拿掉
  await root.locator('[data-act="undo"]').first().click()
  await expect.poll(() => page.evaluate(() => window.hiyori.store.state.tasks.filter((t) => t.coach).length)).toBe(before)
})

test('排時間的入口：日程頁空著的那天按「讓ふじ排主攻時段」到教練的計畫；那天有沒排的任務時ふじ先說一聲、可以回日程排；最佳化時程套用後可以整批撤銷', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  // 10 天後：沒有範例、也沒有別的任務
  const day = await page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() + 10)
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    window.hiyori.store.selectDate(s)
    window.hiyori.ui.setTab('schedule')
    return s
  })
  const bar = page.locator('#planBar')
  await bar.locator('[data-plan="coach"]', { hasText: '讓ふじ排主攻時段' }).click()
  expect(await page.evaluate(() => window.hiyori.ui.tab)).toBe('coach')
  const root = page.locator('#coachRoot')
  await expect(root.locator('[data-act="view"][data-v="plan"]')).toContainText('計畫')
  await expect(root.locator('[data-q="scope"] [data-v="day"]')).toHaveClass(/on/)
  await expect(root.locator('.cmsg', { hasText: '沒排時段' })).toHaveCount(0)

  // 那天加了兩件還沒排時段的任務：計畫那一頁先說一聲，「到日程排」回到那一天
  const ids = await page.evaluate((d) => ['寫報告', '整理房間'].map((title) => window.hiyori.store.addTask({ title, date: d, dur: 30 }).id), day)
  const loose = root.locator('.cmsg', { hasText: '還有 2 件任務沒排時段' })
  await expect(loose).toBeVisible()
  await loose.locator('[data-act="goto"]').click()
  expect(await page.evaluate(() => [window.hiyori.ui.tab, window.hiyori.store.selectedDate])).toEqual(['schedule', day])
  await expect(bar.locator('[data-plan="coach"]')).toHaveCount(0)

  // 最佳化時程：套用之後提示卡上可以整批撤銷
  const placed = () => page.evaluate((ids) => ids.filter((id) => window.hiyori.store.state.tasks.find((t) => t.id === id)?.at).length, ids)
  await bar.locator('[data-plan="optimize"]').click()
  await bar.locator('[data-plan="apply"]').click()
  await expect.poll(placed).toBe(2)
  const toast = page.locator('#toasts .toast', { hasText: '排好 2 件' })
  await toast.getByRole('button', { name: '撤銷' }).click()
  await expect.poll(placed).toBe(0)
  await expect(page.locator('#planTray .chip-task')).toHaveCount(2)
})

test('心情和週回顧：生活記錄的精神和「心」出現在今日反思和小日記；在紀錄頁叫出快速記錄是生活記錄；週報上有上週的回顧卡、紀錄頁有「看週報」', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.setEnergy(s.today, 4)
    s.addLife(s.today, { kind: 'mood', text: '有點煩', t: '10:20' })
    s.addLife(s.today, { kind: 'meal', text: '午餐吃拉麵', t: '12:10' })
    window.hiyori.ui.setTab('today')
  })
  const feel = page.locator('#todayRoot .td-ref .td-feel')
  await expect(feel).toContainText('精神 不錯')
  await expect(feel.locator('.td-feel-m [aria-hidden="true"]')).toHaveText(['10:20', '有點煩'])
  // 讀螢幕軟體念的是時間和完整的字
  await expect(feel.locator('.td-feel-m .sr-only')).toHaveText(['10:20 有點煩'])
  // 記下今日反思：小日記那一天多一行精神和心情
  await page.locator('#todayRoot .td-ref [data-act="mood"]').first().click()
  await page.locator('#todayRoot .td-ref [data-act="refSave"]').click()
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  await expect(page.locator('#journalList .jr-feel').first()).toHaveText('精神 不錯・10:20 有點煩')
  // 在紀錄頁叫出快速記錄：直接是生活記錄；在任務頁還是待辦
  await page.locator('#captureBtn').click()
  await expect(page.locator('#capMode [data-v="log"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#capClose').click()
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await page.locator('#captureBtn').click()
  await expect(page.locator('#capMode [data-v="todo"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#capClose').click()
  // 紀錄頁的「看週報」→ 週報；上週有在用的話，週報最上面有「上週的回顧卡」
  // 上週一做完了 3 件（上週有在用）
  await page.evaluate(() => {
    const s = window.hiyori.store
    const d = new Date(`${s.today}T00:00:00`)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7)
    const wk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    s.day(wk).tasks = 3
    window.hiyori.ui.setTab('records')
  })
  await expect(page.locator('#weekBtn')).toHaveText('看看上週的回顧卡')
  await page.locator('#reportBtn').click()
  expect(await page.evaluate(() => window.hiyori.ui.tab)).toBe('coach')
  await expect(page.locator('#coachRoot [data-v="report"]')).toHaveClass(/on/)
  await page.locator('#coachRoot .wr-lastc').click()
  await expect(page.locator('#weekModal')).toBeVisible()
  await expect(page.locator('#weekModal .modal-kicker')).toHaveText('先週のふりかえり')
})

test('小島模式開機：小島在背景建，面板先能用；還在建的時候按的「擺放」等小島好了接著做；換成 App 模式時「小島準備中」收起來', async ({ page, site }) => {
  test.setTimeout(120000)
  // 小島的程式先卡住，放行之前小島建不起來
  let release
  const gate = new Promise((r) => (release = r))
  await page.route(/\/assets\/islandScene-[^/]*\.js$/, async (route) => {
    await gate
    await route.continue()
  })
  await page.goto(site.url)
  await bootReady(page)
  // 載入畫面拿掉了、面板能用；小島還沒出來，通知的位置說一聲
  await page.waitForFunction(() => !document.getElementById('loader') || document.getElementById('loader').classList.contains('done'), null, { timeout: 30000 })
  expect(await page.evaluate(() => [window.hiyori.ui.appMode, !!window.hiyori.world])).toEqual([false, false])
  const busy = page.locator('#toasts .toast.busy', { hasText: '小島準備中' })
  await expect(busy).toBeVisible()
  // 還在建的時候按「擺放」：先不動，小島好了接著擺
  await page.evaluate(() => window.hiyori.ui.hooks.startPlacing('mushroom'))
  await expect(page.locator('#placeBar')).toBeHidden()
  // 換成 App 模式：那張收起來；再按回小島（小島還在建）又出來
  await page.evaluate(() => window.hiyori.ui.setAppMode(true, { save: false }))
  await expect(busy).toHaveCount(0)
  // （等小島建好才換過去：不等它回傳）
  await page.evaluate(() => {
    window.hiyori.ui.setAppMode(false, { save: false })
  })
  await expect(busy).toBeVisible()
  release()
  await expect(page.locator('#placeBar')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('#placeName')).toContainText('小蘑菇')
  await expect(busy).toHaveCount(0)
})

test('每日任務只放一個地方：任務頁沒有那張；小島模式面板開著總覽時左下角那張收起來；達成時提示卡上直接領；新增習慣寫著跟例行公事、生活記錄的差別', async ({ page, site }) => {
  test.setTimeout(120000)
  // 減少動態效果：提示卡不跑進場動畫，機器很忙時也點得到「領取」
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(site.url)
  await bootReady(page)
  await expect(page.locator('#questMini')).toHaveCount(0)
  // 小島模式、寬螢幕：總覽開著時左下角那張藏起來，換到別頁又出來
  await page.evaluate(() => window.hiyori.ui.setTab('today'))
  await expect(page.locator('#quests')).toBeHidden()
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await expect(page.locator('#quests')).toBeVisible()
  // 每日任務達成：提示卡上按「領取」就領到
  // 今天的每日任務固定成「完成三件」那一組，再做完三件
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.state.quests[s.today] = { ids: ['tasks3', 'focus2', 'step1'], claimed: {} }
    s._readyQuests = new Set(s.quests().filter((q) => q.ready).map((q) => q.id))
    for (const title of ['一', '二', '三']) s.toggleTask(s.addTask({ title, date: s.today }).id)
  })
  const toast = page.locator('#toasts .toast', { hasText: '每日任務' }).filter({ hasText: '達成' })
  await toast.getByRole('button', { name: '領取' }).click()
  await expect.poll(() => page.evaluate(() => window.hiyori.store.quests().find((q) => q.id === 'tasks3').claimed)).toBe(true)
  // 習慣頁：新增習慣時寫著跟例行公事、生活記錄的差別
  await page.evaluate(() => window.hiyori.ui.setTab('habits'))
  await expect(page.locator('#habitsRoot .hb-diff').first()).toContainText('例行公事')
})

test('專案搜尋：在專案頁按 / 跳到那一頁的搜尋框，里程碑也找得到；Esc 清掉字；Ctrl+K 是找找看', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    const s = window.hiyori.store
    const list = [['期末報告', ['找資料', '寫初稿']], ['搬家', ['打包紙箱']], ['日文檢定', ['單字', '模擬考 N2']], ['健身計畫', ['深蹲']], ['作品集網站', ['首頁版型']]]
    for (const [name, milestones] of list) s.addProject({ name, milestones })
  })
  const q = page.locator('#projectQuery')
  // 在專案頁按 / ：游標在這一頁的搜尋框（別的頁是「找找看」）
  await page.evaluate(() => window.hiyori.ui.setTab('projects'))
  await page.keyboard.press('/')
  await expect(q).toBeFocused()
  await q.fill('模擬考')
  const cards = page.locator('#projectList .proj')
  await expect(cards).toHaveCount(1)
  await expect(cards.first().locator('.proj-name')).toHaveText('日文檢定')
  await expect(cards.first().locator('.proj-hit mark')).toHaveText('模擬考')

  // Esc：先清掉字，列表回到全部
  await q.press('Escape')
  await expect(q).toHaveValue('')
  await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(5)

  // 找不到：可以直接用這個名字開新專案
  await q.fill('不存在的東西')
  await expect(page.locator('#projectList [data-act="new-from-q"]')).toBeVisible()

  // Ctrl+K 在專案頁也是找找看（哪一頁都一樣）；Enter 打開找到的專案的詳情
  await q.evaluate((el) => el.blur())
  await page.keyboard.press('Control+k')
  const find = page.locator('#findInput')
  await expect(find).toBeFocused()
  await find.fill('搬家')
  await expect(page.locator('#findList .fd-row').first()).toContainText('搬家')
  await find.press('Enter')
  await expect(page.locator('#projectDetail')).toBeVisible()
  await expect(page.locator('#projectDetail')).toContainText('搬家')
})

test('專注頁的貓咪：從旁邊走進來；點腳印請牠離開（設定記住），減少動態效果時在原地睡著', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  const set = page.locator('#focusSet')
  if (await set.isVisible()) await set.locator('button.btn-primary').last().click()
  await expect(page.locator('#focusFull')).toBeVisible()
  const cat = page.locator('#ffCat .neko')
  const x = () => cat.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
  // 一開始在畫面外，接著一路走進來
  await expect(cat).toBeVisible({ timeout: 10000 })
  const x0 = await x()
  await expect.poll(x).not.toBe(x0)

  // 右上角的腳印：小跑步離開畫面後收起來，設定記住
  const btn = page.locator('#ffCatBtn')
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => window.hiyori.store.state.settings.focusCat)).toBe(false)
  await expect(page.locator('#ffCat')).toBeHidden({ timeout: 20000 })

  // 系統開了減少動態效果，再請牠回來：在原地睡著、不走動
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  await expect(cat).toBeVisible()
  const still = await x()
  await page.waitForTimeout(1500)
  expect(await x()).toBe(still)

  // 手機橫放（圓環在左、按鈕在右，卡片下面沒有地板）：貓收起來、不出錯，按鈕都還在畫面裡；轉回直的又出來
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const size = page.viewportSize()
  await page.setViewportSize({ width: 720, height: 360 })
  await expect(page.locator('#ffCat')).toBeHidden()
  await expect(page.locator('#ffStop')).toBeInViewport({ ratio: 1 })
  await expect(page.locator('#ffTime')).toBeInViewport({ ratio: 1 })
  await page.setViewportSize(size)
  await expect(cat).toBeVisible()
  expect(errors).toEqual([])
})

test('平板：專案的任務有自己的一欄；長期任務不會排進今天；點任務左邊打開、右邊清單留著直接換件', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.goto(site.url)
  await bootReady(page)
  const pid = await page.evaluate(() => {
    const s = window.hiyori.store
    const p = s.addProject({ name: '練習鋼琴', milestones: ['基本功'] })
    const subs = ['讀譜', '分手練', '合手慢練']
    s.addTask({ title: '車爾尼 No.12', project: p.id, ongoing: true, subs })
    s.addTask({ title: '布爾格繆勒 No.2', project: p.id, ongoing: true, subs })
    return p.id
  })
  await page.evaluate((id) => window.hiyori.ui.openProject(id), pid)
  const pd = page.locator('#projectDetail')
  // 右欄切到任務（這個專案會記住）
  await pd.locator('.pd-stabs [data-v="tasks"]').click()
  const rows = pd.locator('.pd-side .pd-tasks .pt')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('長期')
  await expect(rows.first()).toContainText('下一步：讀譜')

  // 新增：跟著上一件是長期，沿用它的子任務
  const add = pd.locator('.pd-side .pd-tasks form.pt-add')
  await expect(add.locator('[data-act="add-long"]')).toHaveAttribute('aria-pressed', 'true')
  await add.locator('[data-act="add-src"][data-v="last"]').click()
  await add.locator('input[name="title"]').fill('哈農 1–5')
  await add.locator('input[name="title"]').press('Enter')
  await expect(rows).toHaveCount(3)
  const made = await page.evaluate(() => window.hiyori.store.state.tasks.find((t) => t.title === '哈農 1–5'))
  expect(made.ongoing).toBe(true)
  expect(made.subs.map((x) => x.title)).toEqual(['讀譜', '分手練', '合手慢練'])
  // 長期任務不會出現在今天的任務裡
  expect(await page.evaluate(() => window.hiyori.store.tasksOn(window.hiyori.store.today).some((t) => t.project))).toBe(false)

  // 點一件：左邊打開任務頁，右邊清單留著、標出正在看的
  await rows.nth(1).locator('.pt-main').click()
  const detail = pd.locator('.pd-task')
  await expect(detail.locator('.pd-name')).toHaveText('布爾格繆勒 No.2')
  await expect(pd.locator('.pd-side')).toBeVisible()
  await expect(rows.nth(1)).toHaveClass(/\bon\b/)
  // 勾掉一個子任務：清單上的下一步跟著變
  await detail.locator('[data-act="sub-toggle"]').first().click()
  await expect(rows.nth(1)).toContainText('下一步：分手練')
  // 說明和紀錄寫到一半，直接點另一件換過去：不會帶到那一件；換回來時寫到一半的紀錄還在
  await detail.locator('textarea[data-tnote]').fill('慢速 60 開始')
  await detail.locator('form[data-form="tlog"] textarea').fill('左手還不穩')
  await rows.first().locator('.pt-main').click()
  await expect(detail.locator('.pd-name')).toHaveText('車爾尼 No.12')
  await expect(detail.locator('textarea[data-tnote]')).toHaveValue('')
  await expect(detail.locator('form[data-form="tlog"] textarea')).toHaveValue('')
  await rows.nth(1).locator('.pt-main').click()
  await expect(detail.locator('form[data-form="tlog"] textarea')).toHaveValue('左手還不穩')
  await rows.first().locator('.pt-main').click()
  await expect(detail.locator('.pd-name')).toHaveText('車爾尼 No.12')
  const notes = await page.evaluate(() => Object.fromEntries(window.hiyori.store.state.tasks.filter((t) => t.project).map((t) => [t.title, t.note || ''])))
  expect(notes).toMatchObject({ '布爾格繆勒 No.2': '慢速 60 開始', '車爾尼 No.12': '' })

  // 直放的平板也是左右兩欄；手機上任務頁疊在上面、清單收起來
  await page.setViewportSize({ width: 820, height: 1180 })
  await expect(pd.locator('.pd-side')).toBeVisible()
  await page.setViewportSize({ width: 393, height: 852 })
  await expect(pd.locator('.pd-side')).toBeHidden()
  await expect(pd.locator('.pd-task')).toBeVisible()

  // 重新整理後打開同一個專案：右欄還是任務
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.reload()
  await bootReady(page)
  await page.evaluate((id) => window.hiyori.ui.openProject(id), pid)
  await expect(pd.locator('.pd-stabs [data-v="tasks"]')).toHaveAttribute('aria-pressed', 'true')
})

test('練習曲的速度：任務頁記目標和今天練到多快（＋ 從目標的一半開始、照節拍器刻度跳），清單上直接看到；練到目標時說一聲', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.goto(site.url)
  await bootReady(page)
  const ids = await page.evaluate(() => {
    const s = window.hiyori.store
    const p = s.addProject({ name: '練習鋼琴', milestones: ['基本功'] })
    const t = s.addTask({ title: '車爾尼 No.12', project: p.id, ongoing: true })
    return { pid: p.id, tid: t.id }
  })
  await page.evaluate(({ pid, tid }) => window.hiyori.ui.openProject(pid, undefined, tid), ids)
  const pd = page.locator('#projectDetail')
  const tempo = pd.locator('.pd-task .pk-tempo')
  await expect(tempo).toHaveCount(0)
  // 長期任務才有「♩ 速度」：按了打開速度，游標在目標
  await pd.locator('.pd-task [data-act="tempo-on"]').click()
  const goal = tempo.locator('[data-bpm="goal"]')
  const now = tempo.locator('[data-bpm="now"]')
  await expect(goal).toBeFocused()
  await goal.fill('120')
  // ＋：還沒記過，從目標的一半開始；再按跳到節拍器上的下一格
  await tempo.locator('[data-act="bpm-step"][data-v="1"]').click()
  await expect(now).toHaveValue('60')
  await tempo.locator('[data-act="bpm-step"][data-v="1"]').click()
  await expect(now).toHaveValue('63')
  const row = pd.locator('.pd-side .pt.on')
  await expect(row.locator('.pt-m.tp')).toHaveText('♩63／120')
  await expect(tempo.locator('.pk-tp-pct')).toHaveText('53%')
  // 直接打數字、按 Enter：練到目標了
  await now.fill('120')
  await now.press('Enter')
  await expect(row.locator('.pt-m.tp')).toHaveText('♩120 達標')
  await expect(page.locator('.toast', { hasText: '練到目標速度了' })).toBeVisible()
  // 一天一筆：今天改了好幾次只留最後那筆，任務頁的紀錄看得到
  const log = await page.evaluate((tid) => window.hiyori.store.state.tasks.find((t) => t.id === tid).tempo, ids.tid)
  expect(log.goal).toBe(120)
  expect(log.log.map((e) => e.bpm)).toEqual([120])
  await expect(pd.locator('.pd-task .tl-tempo')).toContainText('練到目標速度 ♩120')
  // 打到一半、看不懂的「1e」遇到重畫，再直接點右欄另一件：不能當成清空，今天記的速度還在
  const other = await page.evaluate((pid) => window.hiyori.store.addTask({ title: '哈農 1–5', project: pid, ongoing: true }).id, ids.pid)
  await now.click()
  await now.press('Control+a')
  await now.pressSequentially('1e')
  await page.evaluate((tid) => window.hiyori.store.updateTask(tid, { note: '先慢後快' }), ids.tid)
  await pd.locator(`.pd-side [data-act="task-open"][data-id="${other}"]`).click()
  await expect(pd.locator('.pd-task .pd-name')).toHaveText('哈農 1–5')
  expect(await page.evaluate((tid) => window.hiyori.store.state.tasks.find((t) => t.id === tid).tempo.log.map((e) => e.bpm), ids.tid)).toEqual([120])
  // 重新整理後還在
  await page.reload()
  await bootReady(page)
  await page.evaluate(({ pid, tid }) => window.hiyori.ui.openProject(pid, undefined, tid), ids)
  await expect(now).toHaveValue('120')
})

test('練習曲的範本、節拍器、別的單位；好久沒碰的長期任務在今日總覽提醒，可以晚點再說', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.setViewportSize({ width: 1180, height: 820 })
  // 數一下節拍器排了幾拍（測試的瀏覽器沒有喇叭，看有沒有真的排進去）
  await page.addInitScript(() => {
    window.__beats = 0
    const AC = window.AudioContext
    const make = AC.prototype.createOscillator
    AC.prototype.createOscillator = function (...a) {
      const osc = make.apply(this, a)
      // 只數節拍器的（1100 Hz）：別的提示音不算
      setTimeout(() => osc.frequency.value === 1100 && window.__beats++)
      return osc
    }
  })
  await page.goto(site.url)
  await bootReady(page)
  const ids = await page.evaluate(() => {
    const s = window.hiyori.store
    const p = s.addProject({ name: '練習鋼琴', milestones: ['基本功'] })
    const a = s.addTask({ title: '車爾尼 No.12', project: p.id, ongoing: true, tag: 'study', subs: ['讀譜', '分手練'], tempo: true })
    const b = s.addTask({ title: '樂理書', project: p.id, ongoing: true })
    s.setTempoGoal(a.id, 120)
    s.setTempo(a.id, 120)
    // 樂理書放了 12 天沒碰
    b.createdAt = Date.now() - 12 * 86400000
    s.save()
    return { pid: p.id, a: a.id, b: b.id }
  })
  await page.evaluate(({ pid, a }) => window.hiyori.ui.openProject(pid, 'tasks', a), ids)
  const pd = page.locator('#projectDetail')
  const detail = pd.locator('.pd-task')
  // 清單上標出幾天沒碰
  await expect(pd.locator('.pd-side .pt', { hasText: '樂理書' })).toContainText('12 天沒碰')

  // 節拍器：按了開始排拍點，＋ 之後還在響，再按一次停
  const metro = detail.locator('.pk-metro')
  await metro.click()
  await expect(metro).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__beats)).toBeGreaterThan(1)
  await detail.locator('[data-act="bpm-step"][data-v="1"]').click()
  await expect(detail.locator('[data-bpm="now"]')).toHaveValue('126')
  await expect(metro).toHaveAttribute('aria-pressed', 'true')
  await metro.click()
  await expect(metro).toHaveAttribute('aria-pressed', 'false')
  const n = await page.evaluate(() => window.__beats)
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => window.__beats)).toBe(n)

  // 存成範本，新增時點它：長期、分類、子任務、記速度都帶上
  await detail.locator('[data-act="tpl-save"]').click()
  await detail.locator('form[data-form="tpl"] input').fill('練習曲')
  await detail.locator('form[data-form="tpl"] input').press('Enter')
  const add = pd.locator('.pd-side .pd-tasks form.pt-add')
  await add.locator('[data-act="add-src"]', { hasText: '練習曲' }).click()
  await expect(add.locator('.pt-add-hint')).toContainText('子任務：讀譜、分手練')
  await add.locator('input[name="title"]').fill('小奏鳴曲')
  await add.locator('input[name="title"]').press('Enter')
  const made = await page.evaluate(() => window.hiyori.store.state.tasks.find((t) => t.title === '小奏鳴曲'))
  expect(made).toMatchObject({ ongoing: true, tag: 'study', tempo: { unit: '', goal: null, log: [] } })
  expect(made.subs.map((x) => x.title)).toEqual(['讀譜', '分手練'])

  // 別的單位：樂理書記頁數
  await pd.locator(`.pd-side [data-act="task-open"][data-id="${ids.b}"]`).click()
  await detail.locator('[data-act="tempo-on"]').click()
  await detail.locator('select[data-tunit]').selectOption('頁')
  await detail.locator('[data-bpm="goal"]').fill('200')
  await detail.locator('[data-bpm="now"]').fill('32.5')
  await detail.locator('[data-bpm="now"]').press('Enter')
  await expect(pd.locator('.pd-side .pt.on .pt-m.tp')).toHaveText('32.5／200 頁')
  await expect(detail.locator('.pk-metro')).toHaveCount(0)
  // 記了數字就算碰過了
  await expect(pd.locator('.pd-side .pt.on')).not.toContainText('天沒碰')

  // 今日總覽：好久沒碰的長期事；「晚點」過一週再提醒
  await page.evaluate((id) => {
    const s = window.hiyori.store
    const t = s.state.tasks.find((x) => x.id === id)
    t.touched = t.createdAt = Date.now() - 9 * 86400000
    s.save()
    window.hiyori.ui.setTab('today')
  }, made.id)
  const idle = page.locator('#todayRoot .td-idle')
  await expect(idle).toContainText('小奏鳴曲')
  await expect(idle).toContainText('9 天沒碰')
  await idle.locator('[data-act="idle-snooze"]').click()
  await expect(idle).toHaveCount(0)
  // 點名稱打開它的任務頁（先把剛剛的晚點拿掉）
  await page.evaluate(() => {
    localStorage.removeItem('hiyori-idle-off')
    window.hiyori.ui.render()
  })
  await idle.locator('[data-act="idle-open"]').click()
  await expect(detail.locator('.pd-name')).toHaveText('小奏鳴曲')

  // 自己打單位打到一半，背景剛好重畫（這件的專注結束了）：半個字不會被存成單位，游標和字都還在
  await detail.locator('select[data-tunit]').selectOption('…')
  const unit = detail.locator('input[data-tunit]')
  await unit.pressSequentially('公')
  await page.evaluate((id) => window.hiyori.store.completePomodoro(25, id), made.id)
  await expect(unit).toBeFocused()
  await expect(unit).toHaveValue('公')
  const unitOf = () => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id).tempo.unit, made.id)
  expect(await unitOf()).toBe('')
  // 單位取成奇怪的符號也只是字：下面的統計和「存成範本」都還在
  await unit.fill('<!--')
  await unit.press('Enter')
  expect(await unitOf()).toBe('<!--')
  await page.evaluate((id) => {
    const s = window.hiyori.store
    const t = s.state.tasks.find((x) => x.id === id)
    t.tempo.log.unshift({ date: '2020-01-01', bpm: 3, at: 1 })
    s.setTempo(id, 5)
  }, made.id)
  await expect(detail.locator('.pk-tp-sub')).toContainText('<!--')
  await expect(detail.locator('.pd-nums')).toBeVisible()
  await expect(detail.locator('[data-act="tpl-save"]')).toBeVisible()

  // 節拍器響著時把任務移出專案（任務頁關掉了）：拍子要停
  await pd.locator(`.pd-side [data-act="task-open"][data-id="${ids.a}"]`).click()
  await detail.locator('.pk-metro').click()
  await expect(detail.locator('.pk-metro')).toHaveAttribute('aria-pressed', 'true')
  const unlink = detail.locator('[data-act="task-unlink"]')
  await unlink.click()
  await unlink.click()
  await expect(detail).toHaveCount(0)
  const beats = await page.evaluate(() => window.__beats)
  await page.waitForTimeout(900)
  expect(await page.evaluate(() => window.__beats)).toBe(beats)
})

test('番茄鐘：開始後重新整理，照原本的結束時間接著倒數；停掉後重新整理是待機', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  // 第一次開始可能先跳出專注設定：有的話按開始
  const set = page.locator('#focusSet')
  if (await set.isVisible()) await set.locator('button.btn-primary').last().click()
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  const endAt = await page.evaluate(() => window.hiyori.ui.focus.endAt)

  await page.reload()
  await bootReady(page)
  expect(await page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  expect(await page.evaluate(() => window.hiyori.ui.focus.endAt)).toBe(endAt)
  // 時間在走：顯示的不是一開始的 25:00
  await expect(page.locator('#focusTime')).not.toHaveText('25:00')

  await page.evaluate(() => window.hiyori.ui.focus.stop())
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('idle')
  await page.reload()
  await bootReady(page)
  expect(await page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('idle')
})

// 收到推播後顯示什麼在 tests/sw.test.js 測（無頭瀏覽器不給通知權限，這裡顯示不了）
test('番茄鐘到點的通知：開始時把「幾毫秒後」交給伺服器、字留在裝置上；暫停、停掉就取消', async ({ page, context, site }) => {
  await useAppMode(context)
  // 測試用的瀏覽器不給通知權限、也連不到推播服務：權限當成允許、訂閱換成假的，送給伺服器的請求攔下來看
  await context.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' })
    let cur = null
    PushManager.prototype.getSubscription = async () => cur
    PushManager.prototype.subscribe = async () => (cur = { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e', options: {}, unsubscribe: async () => true })
  })
  const calls = []
  await context.route('**/v1/push/**', (route) => {
    const path = new URL(route.request().url()).pathname
    calls.push({ path, body: route.request().postDataJSON() })
    route.fulfill({ json: path.endsWith('/key') ? { key: 'BAAA' } : { ok: true }, headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  await swReady(page)

  // 沒開通知：開始計時不會連到伺服器
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  expect(calls).toEqual([])

  await page.evaluate(() => window.hiyori.store.setSetting('notify', true))
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  await expect.poll(() => calls.map((c) => c.path)).toEqual(['/v1/push/key', '/v1/push/timer'])
  const { endpoint, after } = calls[1].body
  expect(endpoint).toBe('https://fcm.googleapis.com/fcm/send/e2e')
  expect(after).toBeGreaterThan(24.5 * 60000)
  expect(after).toBeLessThanOrEqual(25 * 60000)
  // 送出去的只有網址和時間；要顯示的字在這台的快取裡
  expect(Object.keys(calls[1].body).sort()).toEqual(['after', 'endpoint'])
  const plan = () =>
    page.evaluate(async () => {
      const hit = await (await caches.open('hiyoripush')).match(new URL('__timer-plan', (await navigator.serviceWorker.ready).scope).href)
      return hit ? hit.json() : null
    })
  const endAt = await page.evaluate(() => window.hiyori.ui.focus.endAt)
  expect(await plan()).toEqual([{ at: endAt, title: 'ひより · 專注結束', body: '25 分鐘完成，休息一下吧' }])

  // 設定裡看得到說明和「試一則」
  await page.evaluate(() => window.hiyori.ui.setTab('schedule'))
  await expect(page.locator('#notifyHint')).toContainText('鎖著螢幕、切到別的 App 也收得到')
  await expect(page.locator('#notifyTest')).toBeVisible()

  // 暫停：取消排著的那一則；繼續：照新的結束時間再排
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  await expect.poll(() => calls.at(-1).body).toEqual({ endpoint, after: null })
  expect(await plan()).toEqual([])
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  await expect.poll(() => calls.at(-1).body.after).toBeGreaterThan(24 * 60000)
  // 停掉：取消
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  await expect.poll(() => calls.at(-1).body).toEqual({ endpoint, after: null })
})
// 這一組要看開場的今日摘要（其他測試先當成今天看過了，見 fixtures.js）
test.describe('打開時的今日摘要', () => {
  test.use({ brief: true })

  // 固定在今天上午 10 點跑：晚上 9 點後會跳晚間回顧，內容也跟著時段變。
  // 只固定「現在幾點」，計時器照常跑：整個接管的話，重新整理後要補跑累積的計時器，慢的機器會卡住
  // 瀏覽器的時區在 playwright.config.js 固定是台北；跑測試的機器（CI 是 UTC）不一定，所以照台北的今天算
  const morning = (page) => {
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
    return page.clock.setFixedTime(new Date(`${ymd}T10:00:00+08:00`))
  }

  test('每天第一次打開：貓咪走進來說今天有什麼；點一項跳過去；重新整理不再出來；設定裡可以再看、可以關掉', async ({ page, context, site }) => {
    // 重新整理兩次、等貓走進走出：同時跑很多個測試、機器很忙時會超過一分鐘
    test.setTimeout(120000)
    await useAppMode(context)
    await morning(page)
    await page.goto(site.url)
    await bootReady(page)
    const card = page.locator('#brief .bf-card')
    // 貓坐好了卡片才冒出來，第一句說完清單才出現
    await expect(card).toHaveClass(/in/, { timeout: 20000 })
    await expect(card.locator('.bf-hello')).toContainText('にゃ')
    await expect(card.locator('.bf-body')).toBeVisible({ timeout: 20000 })
    await expect(card.locator('.bf-lead .sr-only')).toContainText('今天')
    expect(await page.evaluate(() => window.hiyori.ui.brief.cat.arrived)).toBe(true)
    // 範例資料裡今天有任務：清單第一項是今天的事，點了關掉摘要、跳到那一頁
    const first = card.locator('.bf-list button').first()
    await expect(first).toBeVisible()
    await first.click()
    await expect(page.locator('#brief')).toBeHidden()
    expect(['tasks', 'schedule', 'habits']).toContain(await page.evaluate(() => window.hiyori.ui.tab))
    // 貓自己走出去，那一層收起來
    await expect(page.locator('#briefCat')).toBeHidden({ timeout: 20000 })

    // 今天看過了：重新整理不再出來
    await page.reload()
    await bootReady(page)
    await page.waitForTimeout(2500)
    expect(await page.evaluate(() => window.hiyori.ui.brief.open)).toBe(false)

    // 設定裡（通知與提醒 → 建議和鼓勵的「更多」）「現在看」再看一次，Esc 關掉；關掉開關後，隔天也不出來
    await page.evaluate(() => window.hiyori.ui.setTab('settings'))
    await page.locator('#nudgeMore > summary').click()
    await page.locator('#briefNow').click()
    await expect(card.locator('.bf-body')).toBeVisible({ timeout: 20000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('#brief')).toBeHidden()
    // 正在看別天時點「今天」的項目：日期跟著回到今天，不會開到別天的空清單
    await page.evaluate(() => window.hiyori.store.selectDate('2030-01-01'))
    await page.locator('#briefNow').click()
    await expect(card.locator('.bf-body')).toBeVisible({ timeout: 20000 })
    await card.locator('.bf-list button').first().click()
    expect(await page.evaluate(() => window.hiyori.store.selectedDate === window.hiyori.store.today)).toBe(true)
    await page.evaluate(() => window.hiyori.ui.setTab('settings'))
    await page.locator('#briefBtn').click()
    await expect(page.locator('#briefBtn')).toHaveText('關')
    await page.evaluate(() => localStorage.removeItem('hiyori-brief-day'))
    await page.reload()
    await bootReady(page)
    await page.waitForTimeout(2500)
    expect(await page.evaluate(() => window.hiyori.ui.brief.open)).toBe(false)
  })

  test('範例：標著「範例」、摘要不算範例；記下第一件自己的任務就收起來（可以撤銷，撤銷了就不再收）；隔天打開也收起來', async ({ page, context, site }) => {
    test.setTimeout(120000)
    await useAppMode(context)
    await morning(page)
    await page.goto(site.url)
    await bootReady(page)
    const samples = () => page.evaluate(() => window.hiyori.store.sampleCount())
    expect(await samples()).toBe(12)
    // 摘要：件數不含範例，最上面說一聲島上的是範例
    const card = page.locator('#brief .bf-card')
    await expect(card.locator('.bf-body')).toBeVisible({ timeout: 20000 })
    await expect(card.locator('.bf-lead .sr-only')).toContainText('今天還沒排任何事')
    await expect(card.locator('.bf-list button').first()).toContainText('島上現在的任務和日程是範例')
    await page.keyboard.press('Escape')
    await expect(page.locator('#brief')).toBeHidden()
    // 任務頁上標著「範例」
    await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
    await expect(page.locator('#taskList .item').first().locator('.ex-tag')).toHaveText('範例')
    // 記下自己的第一件：範例收起來，可以撤銷
    await page.locator('#taskTitle').fill('買牛奶')
    await page.locator('#taskTitle').press('Enter')
    const tucked = page.locator('#toasts .toast', { hasText: '範例收起來了' })
    await expect(tucked).toBeVisible()
    await expect.poll(samples).toBe(0)
    await expect(page.locator('#taskList .item')).toHaveCount(1)
    await tucked.locator('.toast-act', { hasText: '撤銷' }).click()
    await expect.poll(samples).toBe(12)
    await expect(page.locator('#toasts .toast', { hasText: '範例放回去了' })).toBeVisible()
    expect(await page.evaluate(() => window.hiyori.store.state.settings.keepSamples)).toBe(true)
    // 撤銷過了：再記一件也不收
    await page.locator('#taskTitle').fill('回信')
    await page.locator('#taskTitle').press('Enter')
    await page.waitForTimeout(500)
    expect(await samples()).toBe(12)
    // 換一份還沒撤銷過的、隔天才打開：開場時就收起來（不會變成逾期、「那時沒提醒到」）
    await page.evaluate(() => {
      const s = window.hiyori.store
      s.state.settings.keepSamples = false
      s.state.tasks = s.state.tasks.filter((t) => s.isSample(t))
      s.saveNow()
    })
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
    // 先離開這一頁再撥到隔天（不然舊的那一頁在重新整理前就先過了午夜，自己收起來了）
    await page.goto('about:blank')
    await page.clock.setFixedTime(new Date(Date.parse(`${ymd}T10:00:00+08:00`) + 86400000))
    await page.goto(site.url)
    await bootReady(page)
    await expect.poll(samples).toBe(0)
    await expect(card.locator('.bf-body')).toBeVisible({ timeout: 20000 })
    await expect(card).not.toContainText('逾期')
    await expect(card).not.toContainText('沒提醒到')
    await page.keyboard.press('Escape')
    await expect(page.locator('#toasts .toast', { hasText: '範例收起來了' })).toBeVisible({ timeout: 15000 })
  })

  test('你不在的時候：上次看 App 之後錯過的日程列在最前面，點了跳到那一天', async ({ page, context, site }) => {
    await useAppMode(context)
    await morning(page)
    // 重新整理時頁面會把「上次看的時間」記成現在：測試要的時間在下一次載入一開始放進去
    await context.addInitScript(() => {
      const t = localStorage.getItem('e2e-away')
      if (!t) return
      localStorage.setItem('hiyori-seen-at', t)
      localStorage.removeItem('hiyori-brief-day')
      localStorage.removeItem('e2e-away')
    })
    await page.goto(site.url)
    await bootReady(page)
    const card = page.locator('#brief .bf-card')
    await expect(card.locator('.bf-body')).toBeVisible({ timeout: 20000 })
    // 剛打開、沒有上次：沒有這一段
    await expect(card).not.toContainText('你不在的時候')
    await page.keyboard.press('Escape')

    // 昨天下午有個日程；上次看 App 是 20 小時前（昨天下午兩點）
    const yesterday = await page.evaluate(() => {
      const s = window.hiyori.store
      const d = new Date()
      d.setDate(d.getDate() - 1)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      s.addEvent({ title: '牙醫回診', date, start: '15:00', end: '16:00' })
      localStorage.setItem('e2e-away', String(Date.now() - 20 * 3600000))
      return date
    })
    await page.reload()
    await bootReady(page)
    await expect(card.locator('.bf-body')).toBeVisible({ timeout: 20000 })
    await expect(card.locator('.bf-body h4').first()).toContainText('你不在的時候')
    await expect(card.locator('.bf-body h4').first()).toContainText('離開了 20 小時')
    // 範例資料裡昨天晚上還有別的日程（新的在前），所以照名字找
    const missed = card.locator('.bf-list button', { hasText: '昨天 15:00 牙醫回診' })
    await expect(missed).toBeVisible()
    await expect(missed).toContainText('那時沒提醒到')
    await missed.click()
    expect(await page.evaluate(() => [window.hiyori.ui.tab, window.hiyori.store.selectedDate])).toEqual(['schedule', yesterday])
    // 同一天再看一次（設定的建議和鼓勵 → 更多）：這一段還在
    await page.evaluate(() => window.hiyori.ui.setTab('settings'))
    await page.locator('#nudgeMore > summary').click()
    await page.locator('#briefNow').click()
    await expect(card.locator('.bf-body')).toBeVisible({ timeout: 20000 })
    await expect(card).toContainText('昨天 15:00 牙醫回診')
  })

  test('系統開了減少動態效果：貓直接坐在那裡，字一次出來', async ({ page, context, site }) => {
    await useAppMode(context)
    await morning(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(site.url)
    await bootReady(page)
    const card = page.locator('#brief .bf-card')
    await expect(card.locator('.bf-body')).toBeVisible({ timeout: 20000 })
    expect(await page.evaluate(() => ({ still: window.hiyori.ui.brief.cat.cat.still, arrived: window.hiyori.ui.brief.cat.arrived, typed: document.querySelector('.bf-typed').textContent === document.querySelector('.bf-lead .sr-only').textContent }))).toEqual({ still: true, arrived: true, typed: true })
    await card.locator('.btn-primary').click()
    await expect(page.locator('#brief')).toBeHidden()
    await expect(page.locator('#briefCat')).toBeHidden()
  })
})
test('快速記錄：在總覽按＋，一行字記下待辦、日程和生活記錄，接著記下一件；記錯了可以復原；N 鍵和 ?add 也叫得出來', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  const cap = page.locator('#capture')
  const input = page.locator('#capInput')
  // 自己記的（記下第一件時範例就收起來了，不算範例）
  const count = () =>
    page.evaluate(() => {
      const s = window.hiyori.store
      const mine = (list) => list.filter((x) => !s.isSample(x)).length
      return { tasks: mine(s.state.tasks), events: mine(s.state.events), life: (s.state.life[s.today]?.items || []).length }
    })
  const before = await count()

  // 留在總覽，不用換到任務頁
  await page.locator('#captureBtn').click()
  await expect(input).toBeFocused()
  await input.fill('買牛奶 #生活')
  await expect(page.locator('#capPreview')).toContainText('今天')
  await input.press('Enter')
  // 輸入框留著，直接記下一件：寫了時間的變成日程
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('')
  await input.fill('明天 15:00 看牙醫')
  await expect(page.locator('#capPreview')).toContainText('15:00–16:00')
  await input.press('Enter')
  await expect(page.locator('#capDone li')).toHaveCount(2)
  expect(await count()).toEqual({ ...before, tasks: before.tasks + 1, events: before.events + 1 })
  expect(await page.evaluate(() => window.hiyori.ui.tab)).toBe('today')
  const milk = await page.evaluate(() => window.hiyori.store.state.tasks.find((t) => t.title === '買牛奶'))
  expect(milk).toMatchObject({ tag: 'life', date: await page.evaluate(() => window.hiyori.store.today) })

  // 生活記錄：花費把金額拿出來
  await page.locator('#capMode [data-v="log"]').click()
  await page.locator('#capKinds [data-kind="spend"]').click()
  await input.fill('午餐 120')
  await input.press('Enter')
  const spent = await page.evaluate(() => window.hiyori.store.state.life[window.hiyori.store.today].items.at(-1))
  expect(spent).toMatchObject({ kind: 'spend', text: '午餐', amount: 120 })

  // 復原：最上面那一筆（剛記的花費）拿掉
  await page.locator('#capDone [data-undo="0"]').click()
  await expect(page.locator('#capDone li').first()).toContainText('已復原')
  expect((await count()).life).toBe(before.life)

  // 例行任務的復原：例行公事和它今天產生的那一件都拿掉
  await page.locator('#capMode [data-v="todo"]').click()
  await input.fill('每天 喝水')
  await input.press('Enter')
  expect(await page.evaluate(() => window.hiyori.store.state.routines.some((r) => r.title === '喝水'))).toBe(true)
  await page.locator('#capDone [data-undo="0"]').click()
  expect(await page.evaluate(() => [window.hiyori.store.state.routines.some((r) => r.title === '喝水'), window.hiyori.store.state.tasks.some((t) => t.title === '喝水')])).toEqual([false, false])

  // 空的不會記；打到一半按 Esc 關掉：字留著（算打到一半的字，不會被自動換新版刷掉），焦點回到＋
  await input.press('Enter')
  expect(await count()).toEqual({ ...before, tasks: before.tasks + 1, events: before.events + 1 })
  await input.fill('還沒記完')
  await page.keyboard.press('Escape')
  await expect(cap).toBeHidden()
  await expect(page.locator('#captureBtn')).toBeFocused()
  expect(await page.evaluate(() => window.hiyori.ui.hasDraft())).toBe(true)
  await page.locator('#captureBtn').click()
  await expect(input).toHaveValue('還沒記完')
  await input.fill('')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.hiyori.ui.hasDraft())).toBe(false)

  // N 鍵：別的分頁叫出快速記錄（每次都從「待辦」開始）；任務頁是跳到那一行輸入框
  await page.locator('#captureBtn').blur()
  await page.keyboard.press('n')
  await expect(cap).toBeVisible()
  await expect(page.locator('#capMode [data-v="todo"]')).toHaveClass(/on/)
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await page.locator('#tab-tasks').focus()
  await page.keyboard.press('n')
  await expect(cap).toBeHidden()
  await expect(page.locator('#taskTitle')).toBeFocused()

  // 主畫面圖示的捷徑（?add）：打開就是快速記錄，網址上的參數拿掉
  await page.goto(site.url + '?add=1')
  await bootReady(page)
  await expect(cap).toBeVisible({ timeout: 30000 })
  await expect(input).toBeFocused()
  expect(new URL(page.url()).search).toBe('')
})

test('檢視進度：總覽有這週每天做完幾件，點「看週報」到教練的週報；紀錄頁最上面一排的「設定」、齒輪打開設定頁；分頁各自記住捲到哪', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.setViewportSize({ width: 393, height: 800 })
  await page.goto(site.url)
  await bootReady(page)
  // 做完今天的一件：今天那一根有實心的一段
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.toggleTask(s.tasksOn(s.today)[0].id)
  })
  const week = page.locator('.td-pw')
  await expect(week.locator('.td-pw-h')).toContainText('這週做完 1')
  await expect(week.locator('.td-pw-d')).toHaveCount(7)
  await expect(week.locator('.td-pw-d.now')).toHaveCount(1)
  // 長條第一次畫時從 0 長上來：等它長好
  await expect.poll(() => week.locator('.td-pw-d.now b').evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(0)

  // 分頁各自記住捲到哪裡：總覽往下捲，換到任務是從頭開始，回來還在原地；再點一次總覽回到最上面
  const body = page.locator('.panel-body')
  await body.evaluate((el) => el.scrollTo(0, 500))
  await page.locator('#tab-tasks').click()
  expect(await body.evaluate((el) => el.scrollTop)).toBe(0)
  await page.locator('#tab-today').click()
  expect(await body.evaluate((el) => el.scrollTop)).toBe(500)
  await page.locator('#tab-today').click()
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(0)

  await week.locator('[data-act="report"]').click()
  expect(await page.evaluate(() => window.hiyori.ui.tab)).toBe('coach')
  await expect(page.locator('#coachRoot [data-v="report"]')).toHaveClass(/on/)

  // 紀錄頁：最上面那一排的「設定」打開設定頁（外觀、通知與提醒、專注、警語、ふじ、資料與同步）
  await page.locator('#tab-records').click()
  const nav = page.locator('#recNav')
  await expect(nav.locator('button').first()).toHaveText('設定')
  await expect(nav.locator('button', { hasText: '最近七天' })).toBeVisible()
  await nav.locator('button.set').click()
  expect(await page.evaluate(() => window.hiyori.ui.tab)).toBe('settings')
  const heads = page.locator('[data-page="settings"] h3.sec-title')
  await expect(heads).toHaveText([/外觀/, /通知與提醒/, /專注/, /警語/, /ふじ/, /資料與同步/])
  // 分頁列亮著紀錄（設定算在紀錄底下）；App 模式的頁名寫著設定
  await expect(page.locator('#tab-records')).toHaveClass(/active/)
  await expect(page.locator('#ahTitle')).toHaveText('設定')
  // 按的那一顆跟著紀錄頁藏起來了：焦點放到設定頁上（鍵盤接著往下走，不掉回頁首）；亮著的「紀錄」指到設定頁
  await expect(page.locator('#page-settings')).toBeFocused()
  await expect(page.locator('#tab-records')).toHaveAttribute('aria-controls', 'page-settings')
  // 日期列的齒輪、今日總覽右上的齒輪也打得開；回到上次捲到的地方
  const y = await page.evaluate(() => {
    const b = document.querySelector('.panel-body')
    b.scrollTop = 400
    return b.scrollTop
  })
  expect(y).toBeGreaterThan(0)
  await page.locator('#tab-today').click()
  await page.locator('#todayRoot .td-gear').click()
  expect(await page.evaluate(() => window.hiyori.ui.tab)).toBe('settings')
  expect(await page.evaluate(() => document.querySelector('.panel-body').scrollTop)).toBe(y)
  await page.locator('#tab-tasks').click()
  await page.locator('#gearBtn').click()
  expect(await page.evaluate(() => window.hiyori.ui.tab)).toBe('settings')
  await expect(page.locator('#tab-records')).toHaveAttribute('aria-controls', 'page-settings')
  // 設定頁上的捷徑：日程提醒跟日程頁上方那一個是同一個設定，音效跟 Dock 的喇叭是同一個開關
  await page.locator('#remindLeadSet').selectOption('30')
  expect(await page.evaluate(() => window.hiyori.store.state.settings.remindLead)).toBe(30)
  await expect(page.locator('#remindLead')).toHaveValue('30')
  const snd = page.locator('#soundSetBtn')
  await expect(snd).toHaveText('開')
  await snd.click()
  await expect(snd).toHaveText('關')
  expect(await page.evaluate(() => window.hiyori.store.state.settings.sound)).toBe(false)
  // Dock 的喇叭按了：設定頁上那一顆跟著變
  await page.evaluate(() => document.querySelector('#soundBtn').click())
  await expect(snd).toHaveText('開')
  // 警語的句子和間隔：到紀錄頁的警語那一區
  await expect(page.locator('#mottoSetInfo')).toContainText('提醒一句')
  await page.locator('#mottoSetBtn').click()
  expect(await page.evaluate(() => window.hiyori.ui.tab)).toBe('records')
})

test('番茄鐘：到點了還沒做完可以延長（從到點那時接著正計時，多做的分鐘記進去）；輪數做完了可以再加一輪、休息完再來一輪', async ({ page, context, site }) => {
  // 步驟多、中間重新整理一次：同時跑很多個測試、機器很忙時一個動作要一秒
  test.setTimeout(120000)
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const state = () =>
    page.evaluate(() => {
      const f = window.hiyori.ui.focus
      const s = window.hiyori.store
      return { mode: f.mode, ext: !!f.ext, up: f.up, round: f.round, rounds: f.rounds, pomos: s.stats.pomodoros, mins: s.stats.focusMinutes }
    })
  // 把這一段的結束時間往前挪：不用真的等 25 分鐘
  const skip = (ms) =>
    page.evaluate((ms) => {
      const f = window.hiyori.ui.focus
      f.endAt -= ms
      f._save()
    }, ms)
  await page.evaluate(() => {
    window.hiyori.store.setSetting('focusRounds', 1)
    window.hiyori.store.setSetting('focusUp', false)
    window.hiyori.ui.focus.toggle()
    // 專注頁縮小了（或是小島模式）：到點的提示卡上要有「延長」「再加一輪」
    window.hiyori.ui.focus.toggleBig(false)
  })
  await skip(26 * 60000)
  await expect.poll(async () => (await state()).mode).toBe('break')
  expect(await state()).toMatchObject({ pomos: 1, mins: 25, round: 1, rounds: 1 })
  await expect(timerActs(page).locator('.toast-act')).toHaveText(['還沒做完，延長', '再加一輪'])

  // 專注頁的休息畫面上也有這兩顆；時間下面寫休息到幾點、最上面寫今天專注了多久
  await page.evaluate(() => window.hiyori.ui.focus.toggleBig(true))
  const extend = page.locator('#ffExtend')
  await expect(extend).toBeVisible()
  await expect(extend).toContainText('還沒做完，延長')
  await expect(page.locator('#ffAddRound')).toBeVisible()
  await expect(page.locator('#ffSub')).toHaveText(/^休息到 \d\d:\d\d$/)
  await expect(page.locator('#ffToday')).toHaveText('今天已專注 25 分')

  // 延長：變成往上數的「加時中」，從到點那時（1 分鐘前）接著算；提示卡收掉
  await extend.click()
  expect(await state()).toMatchObject({ mode: 'focus', ext: true, up: true })
  await expect(page.locator('#ffKicker')).toHaveText('加時中')
  await expect(page.locator('#ffTime')).toHaveText(/^01:\d\d$/)
  await expect(timerActs(page)).toHaveCount(0)
  // 重新整理後還是加時中
  await page.reload()
  await bootReady(page)
  expect(await state()).toMatchObject({ mode: 'focus', ext: true, up: true })
  // 再多做 7 分鐘，按「做完了」：多做的 8 分鐘記進去，番茄數不變；回到休息
  await skip(7 * 60000)
  await page.evaluate(() => window.hiyori.ui.focus.toggleBig(true))
  await expect(page.locator('#ffStop')).toHaveText('做完了')
  await page.locator('#ffStop').click()
  expect(await state()).toMatchObject({ mode: 'break', ext: false, up: false, pomos: 1, mins: 33 })
  // 專注頁開著：按鈕在頁面上，提示卡只說一聲，不再放一次按鈕蓋住計時
  await expect(page.locator('#toasts .toast', { hasText: '多做了 8 分鐘' })).toBeVisible()
  await expect(timerActs(page)).toHaveCount(0)

  // 最後一輪的休息：再加一輪，休息完自動開始第 2 輪
  await page.locator('#ffAddRound').click()
  expect(await state()).toMatchObject({ mode: 'break', round: 1, rounds: 2 })
  await expect(page.locator('#ffAddRound')).toBeHidden()
  await expect(page.locator('#ffKicker')).toHaveText('休息 · 下一輪 2/2')
  // 多輪：時間上面的點（第 1 輪做完了、第 2 輪還沒到），下面寫幾點接著下一輪
  await expect(page.locator('#ffRounds i')).toHaveCount(2)
  await expect(page.locator('#ffRounds i.done')).toHaveCount(1)
  await expect(page.locator('#ffSub')).toHaveText(/^\d\d:\d\d 接著第 2 輪$/)
  await skip(6 * 60000)
  // 自動接下一輪時說一聲（這張提示卡不會被「開始了」收掉）：先看提示卡，機器很忙時下面幾步就超過它留著的時間
  await expect(page.locator('#toasts .toast', { hasText: '第 2/2 輪開始了' })).toBeVisible()
  await expect.poll(async () => (await state()).mode).toBe('focus')
  expect(await state()).toMatchObject({ round: 2, rounds: 2, ext: false, up: false })
  await skip(26 * 60000)
  await expect.poll(async () => (await state()).mode).toBe('break')
  expect(await state()).toMatchObject({ pomos: 2, mins: 58 })

  // 休息也結束了：提示卡上「再來一輪」，照剛才的長度直接開始（休息中改了設定也照剛才那一組）
  await page.evaluate(() => window.hiyori.store.setSetting('focusMin', 10))
  await skip(6 * 60000)
  await expect.poll(async () => (await state()).mode).toBe('idle')
  await page.locator('.toast-acts .toast-act', { hasText: '再來一輪' }).click()
  expect(await state()).toMatchObject({ mode: 'focus', round: 1, rounds: 1, ext: false })
  expect(await page.evaluate(() => window.hiyori.ui.focus.focusMin)).toBe(25)
  await expect(timerActs(page)).toHaveCount(0)
  await page.evaluate(() => {
    window.hiyori.ui.focus.stop()
    window.hiyori.store.setSetting('focusMin', 25)
  })

  // 正向計時自己按做完的：休息時不能延長
  await page.evaluate(() => {
    window.hiyori.store.setSetting('focusUp', true)
    window.hiyori.ui.focus.toggle()
  })
  await skip(10 * 60000)
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  expect(await state()).toMatchObject({ mode: 'break', pomos: 3 })
  await expect(page.locator('#ffExtend')).toBeHidden()
  await expect(page.locator('#ffAddRound')).toBeVisible()
  // 往上數放了五個小時才回來，手快在下一次檢查之前按「做完了」：跟自動檢查一樣當成過期，不記
  const late = await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.stop()
    f.toggle()
    f.endAt -= 5 * 3600000
    f.stop()
    return { mode: f.mode, pomos: window.hiyori.store.stats.pomodoros }
  })
  expect(late).toEqual({ mode: 'idle', pomos: 3 })
  await page.evaluate(() => window.hiyori.store.setSetting('focusUp', false))
})

test('到點自動延長：原定的照常記下、不休息，接著往上數，做完按「做完了」記延長的分鐘；之後有日程就延長得短一點、太近就照常休息；專注中貓咪小聲念警語', async ({ page, context, site }) => {
  test.setTimeout(120000)
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  const state = () =>
    page.evaluate(() => {
      const f = window.hiyori.ui.focus
      const s = window.hiyori.store
      return { mode: f.mode, ext: !!f.ext, cap: f.cap, up: f.up, pomos: s.stats.pomodoros, mins: s.stats.focusMinutes }
    })
  const skip = (ms) =>
    page.evaluate((ms) => {
      const f = window.hiyori.ui.focus
      f.endAt -= ms
      f._save()
    }, ms)
  await page.evaluate(() => {
    const s = window.hiyori.store
    // 範例島上的日程和例行公事先拿掉：之後一小時內有日程的話延長會被縮短（晚上八點左右跑，會碰到範例裡 21:00 的日程）
    for (const r of [...s.state.routines]) s.deleteRoutine(r.id)
    for (const e of [...s.state.events]) s.deleteEvent(e.id)
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    // 計時設定：預設到點自動延長最多 30 分、貓咪每 15 分鐘念一句
    window.hiyori.ui.focus.toggleSet(true)
  })
  await expect(page.locator('#fsFlow button.on')).toHaveText('30 分')
  await expect(page.locator('#fsCat button.on')).toHaveText('15 分')
  await expect(page.locator('#fsSum')).toHaveText('25 分，到點自動延長（最多 30 分），做完休息 5 分')
  await page.evaluate(() => {
    window.hiyori.ui.focus.toggleSet(false)
    window.hiyori.ui.focus.toggle()
  })
  await expect(page.locator('#ffSub')).toHaveText(/^\d\d:\d\d 到點後自動延長$/)
  // 到點的通知排在延長做滿的時間（到點那一刻不通知），字也照延長的寫
  const plan = await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    return { gap: f.boundary.at - f.endAt, flow: f.boundary.flow }
  })
  expect(plan).toEqual({ gap: 30 * 60000, flow: 30 })

  // 到點：原定的 25 分記下了，不休息，接著往上數（自動延長中）；不響、提示卡沒有按鈕（專注頁上有「做完了」）
  await skip(25 * 60000 + 1000)
  await expect.poll(async () => (await state()).ext).toBe(true)
  expect(await state()).toMatchObject({ mode: 'focus', ext: true, cap: 30, up: true, pomos: 1, mins: 25 })
  await expect(page.locator('#ffKicker')).toHaveText('自動延長中')
  await expect(page.locator('#ffSub')).toHaveText(/^25 分記下了・最晚 \d\d:\d\d$/)
  await expect(page.locator('#ffStop')).toHaveText('做完了')
  await expect(timerActs(page)).toHaveCount(0)
  // 貓咪說了一聲（貓在的話）或一張不響的提示卡
  await expect.poll(() => page.evaluate(() => document.querySelector('#ffSay').textContent || (window.__toasts || []).find((t) => t.includes('自動延長中')) || '')).not.toBe('')
  // 重新整理後還是自動延長中
  await page.reload()
  await bootReady(page)
  expect(await state()).toMatchObject({ mode: 'focus', ext: true, cap: 30 })

  // 再做 7 分鐘按「做完了」：延長的 7 分記進去，番茄數不變，接著休息
  await skip(7 * 60000)
  await page.evaluate(() => window.hiyori.ui.focus.toggleBig(true))
  await page.locator('#ffStop').click()
  expect(await state()).toMatchObject({ mode: 'break', ext: false, cap: 0, up: false, pomos: 1, mins: 32 })
  await toastSeen(page, '延長了 7 分鐘，也記進去了')

  // 延長做滿了：自己結束，記上限的分鐘數
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.stop()
    f.toggle()
  })
  await skip(25 * 60000 + 31 * 60000)
  await expect.poll(async () => (await state()).mode).toBe('break')
  expect(await state()).toMatchObject({ pomos: 2, mins: 32 + 25 + 30 })
  await toastSeen(page, '自動延長的 30 分鐘也做滿了')
  await page.evaluate(() => window.hiyori.ui.focus.stop())

  // 之後有日程：延長到開始前 5 分鐘為止；太近（剩不到 5 分鐘）就照常休息。
  // 時間照頁面的時區算（CI 的機器是 UTC，頁面是台北時間）；快到午夜時日程排不進今天，那時不測
  const caps = await page.evaluate(() => {
    const s = window.hiyori.store
    const f = window.hiyori.ui.focus
    const now = Date.now()
    if (new Date(now).getHours() >= 23) return null
    const hm = (t) => new Date(t).toTimeString().slice(0, 5)
    s.addEvent({ title: '開會', date: s.today, start: hm(now + 16 * 60000), end: '23:59' })
    const a = f._flowCap(now)
    s.addEvent({ title: '上課', date: s.today, start: hm(now + 7 * 60000), end: '23:59' })
    return [a, f._flowCap(now)]
  })
  if (caps) {
    expect(caps[0]).toBeGreaterThanOrEqual(10)
    expect(caps[0]).toBeLessThanOrEqual(11)
    expect(caps[1]).toBe(0)
    // 太近：到點照常休息
    await page.evaluate(() => window.hiyori.ui.focus.toggle())
    await skip(25 * 60000 + 1000)
    await expect.poll(async () => (await state()).mode).toBe('break')
    await page.evaluate(() => window.hiyori.ui.focus.stop())
  }

  // 專注中貓咪念警語：照這一輪專注了多久算（暫停不算），到了念一句寫給自己的警語（輪流念）
  await page.evaluate(() => {
    const s = window.hiyori.store
    for (const e of [...s.state.events]) s.deleteEvent(e.id)
    s.addMotto('手機放遠一點')
    s.setSetting('catMotto', 10)
    window.hiyori.ui.focus.toggle()
  })
  await page.waitForTimeout(600)
  await skip(10 * 60000 + 1000)
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#ffSay').textContent || (window.__toasts || []).find((t) => t.includes('手機放遠一點')) || ''), { timeout: 15000 })
    .toContain('手機放遠一點')
  await page.evaluate(() => window.hiyori.ui.focus.stop())
})

test('只做 5 分鐘：卡關小卡、計時設定上都能按；不動設定的長度，到點時問要不要接著做下去，接著做的分鐘也記進去', async ({ page, context, site }) => {
  // 步驟多、中間重新整理一次（見上一個測試）
  test.setTimeout(120000)
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  const state = () =>
    page.evaluate(() => {
      const f = window.hiyori.ui.focus
      const s = window.hiyori.store
      return { mode: f.mode, small: !!f.small, ext: !!f.ext, up: f.up, focusMin: f.focusMin, task: f.task?.title || null, pomos: s.stats.pomodoros, mins: s.stats.focusMinutes, setting: s.state.settings.focusMin }
    })
  const skip = (ms) =>
    page.evaluate((ms) => {
      const f = window.hiyori.ui.focus
      f.endAt -= ms
      f._save()
    }, ms)
  // 設定的長度是 50 分；一件往後挪了 3 次的任務：任務頁上出現卡關小卡
  const before = await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusMin', 50)
    s.setSetting('focusRounds', 1)
    const t = s.addTask({ title: '整理研究筆記', date: s.today })
    t.moved = 3
    s.save()
    window.hiyori.ui.setTab('tasks')
    window.hiyori.ui.renderTasks()
    return { pomos: s.stats.pomodoros, mins: s.stats.focusMinutes }
  })
  const card = page.locator('#stuckBox .stuck-card')
  await expect(card).toContainText('「整理研究筆記」好像卡住了')
  await card.locator('[data-act="small"]').click()
  // 先倒數 5 分鐘（設定的 50 分不動）；專注頁上寫著「只做 5 分鐘」、到時再決定
  expect(await state()).toMatchObject({ mode: 'focus', small: true, up: false, focusMin: 5, task: '整理研究筆記', setting: 50 })
  await expect(page.locator('#ffKicker')).toHaveText('只做 5 分鐘')
  await expect(page.locator('#ffSub')).toHaveText(/^\d\d:\d\d 結束，到時再決定要不要繼續$/)
  // 重新整理後還是只做 5 分鐘的那一輪
  await page.reload()
  await bootReady(page)
  expect(await state()).toMatchObject({ mode: 'focus', small: true, focusMin: 5, setting: 50 })
  // 到點（專注頁縮小時）：記 5 分鐘、接著休息；提示卡問要不要接著做下去
  await page.evaluate(() => window.hiyori.ui.focus.toggleBig(false))
  await skip(6 * 60000)
  await expect.poll(async () => (await state()).mode).toBe('break')
  expect(await state()).toMatchObject({ pomos: before.pomos + 1, mins: before.mins + 5 })
  const done = page.locator('#toasts .toast', { hasText: '5 分鐘到了，開了頭就不難了' })
  await expect(done).toContainText('「整理研究筆記」+5 分鐘')
  // 這件還沒寫下一步：也可以先留一步給等等的自己
  await expect(done.locator('.toast-act')).toHaveText(['繼續做下去', '休息一下', '留一步給等等'])
  // 接著做下去：從到點那時（1 分鐘前）往上數；做完按「做完了」，多做的分鐘記進去（不多算一顆番茄）
  await done.locator('.toast-act', { hasText: '繼續做下去' }).click()
  expect(await state()).toMatchObject({ mode: 'focus', ext: true, up: true, small: true })
  await expect(page.locator('#ffKicker')).toHaveText('接著做下去')
  await expect(page.locator('#ffSub')).toHaveText('5 分鐘做到了，做完就按「做完了」')
  await skip(10 * 60000)
  await page.locator('#ffStop').click()
  expect(await state()).toMatchObject({ mode: 'break', ext: false, pomos: before.pomos + 1, mins: before.mins + 16 })
  await expect(page.locator('#toasts .toast', { hasText: '多做了 11 分鐘' })).toBeVisible()
  // 休息中還可以再接著做；跳過休息回到待機：長度回到設定的 50 分
  await expect(page.locator('#ffExtend')).toContainText('繼續做下去')
  await page.locator('#ffStop').click()
  expect(await state()).toMatchObject({ mode: 'idle', small: false, focusMin: 50 })

  // 計時設定裡：「開始專注」下面一行「提不起勁？只做 5 分鐘」，照選好的目標開始；計時中不出現
  await page.evaluate(() => window.hiyori.ui.focus.toggleSet(true))
  await expect(page.locator('#fsSmall')).toHaveText('提不起勁？只做 5 分鐘')
  await page.locator('#fsSmall').click()
  expect(await state()).toMatchObject({ mode: 'focus', small: true, focusMin: 5, setting: 50 })
  await expect(page.locator('#focusSet')).toBeHidden()
  await page.evaluate(() => {
    window.hiyori.ui.focus.toggleBig(false)
    window.hiyori.ui.focus.toggleSet(true)
  })
  await expect(page.locator('#fsSmall')).toBeHidden()
  // 中途按結束：不到點的不記
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  expect(await state()).toMatchObject({ mode: 'idle', small: false, pomos: before.pomos + 1, mins: before.mins + 16 })
})

test('先記下來：專注時腦中冒出別的事，在專注頁（或計時設定的小視窗）一行記下、不離開專注，N 鍵也到這裡；專注完到今日總覽排進今天、明天或不用做了', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const parked = () => page.evaluate(() => window.hiyori.store.state.parked.map((x) => x.text))
  await page.evaluate(() => {
    window.hiyori.store.setSetting('focusRounds', 1)
    window.hiyori.store.setSetting('focusUp', false)
    window.hiyori.ui.focus.toggle()
  })
  // 專注頁：一行「腦中冒出別的事？先記下來」，Enter 記下、清空，下面寫記了幾件；還在專注
  const input = page.locator('#ffParkText')
  await expect(input).toBeVisible()
  await input.fill('回小美的訊息')
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await expect(page.locator('#ffParkN')).toHaveText('先記下了 1 件・專注完在今日總覽看')
  expect(await parked()).toEqual(['回小美的訊息'])
  expect(await page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  // Esc：只放開這一行，專注頁還開著；N 鍵又回到這一行
  await input.press('Escape')
  await expect(input).not.toBeFocused()
  await expect(page.locator('#focusFull')).toBeVisible()
  await page.keyboard.press('n')
  await expect(input).toBeFocused()
  await expect(page.locator('#capture')).toBeHidden()
  // 縮小專注頁（小島模式也是這樣）：計時設定的小視窗裡也有這一行
  await page.evaluate(() => {
    window.hiyori.ui.focus.toggleBig(false)
    window.hiyori.ui.focus.toggleSet(true)
  })
  await page.locator('#fsParkText').fill('買牛奶')
  await page.locator('#fsParkText').press('Enter')
  expect(await parked()).toEqual(['回小美的訊息', '買牛奶'])
  // 專注到點：提示卡上「看記下的 2 件」，按了到今日總覽那一張卡片（新記的在上面）
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.toggleSet(false)
    f.endAt -= 26 * 60000
    f._save()
  })
  const go = page.locator('#toasts .toast-act', { hasText: '看記下的 2 件' })
  await go.click()
  expect(await page.evaluate(() => window.hiyori.ui.tab)).toBe('today')
  const card = page.locator('#todayRoot .td-park')
  await expect(card.locator('.td-park-t')).toHaveText(['買牛奶', '回小美的訊息'])
  await expect(card.locator('button').first()).toBeFocused()
  // 「明天做」：變成明天的任務；「×」：不用做了；都處理完卡片就收起來
  await card.locator('li', { hasText: '回小美的訊息' }).locator('[data-act="park-tmr"]').click()
  await toastSeen(page, '「回小美的訊息」排進明天')
  const tmr = await page.evaluate(() => {
    const s = window.hiyori.store
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return s.tasksOn(date).map((t) => t.title)
  })
  expect(tmr).toContain('回小美的訊息')
  await card.locator('[data-act="park-drop"]').click()
  await expect(card).toHaveCount(0)
  expect(await parked()).toEqual([])
})

test('下一步：專注一件拆成小步驟的任務時，專注頁寫著下一步，做完直接勾、換下一步，最後一步勾完任務也完成；還沒拆的可以當場寫下第一小步', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const subsOf = (id) => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id).subs.map((x) => `${x.done ? '✓' : '・'}${x.title}`), id)
  const id = await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    const t = s.addTask({ title: '寫期末報告', date: s.today })
    s.addSub(t.id, '找三篇參考資料')
    s.addSub(t.id, '寫大綱')
    // 做完這件之後建議的那一件（範例不算）
    s.addTask({ title: '讀 20 頁書', date: s.today })
    window.hiyori.ui.focus.startWith(t.id)
    return t.id
  })
  const step = page.locator('#ffStep')
  await expect(step).toBeVisible()
  await expect(step.locator('.ff-step-t b')).toHaveText('找三篇參考資料')
  await expect(step.locator('.ff-step-n')).toHaveText('1/2')
  // 勾掉：換下一步，焦點留在勾勾上；每秒重畫也不會把它換掉。連按兩下只勾掉一步（第二下落在換上來的勾勾上，不算）
  await step.locator('[data-step]').dblclick()
  await expect(step.locator('.ff-step-t b')).toHaveText('寫大綱')
  await expect(step.locator('.ff-step-n')).toHaveText('2/2')
  await expect(step.locator('[data-step]')).toBeFocused()
  expect(await subsOf(id)).toEqual(['✓找三篇參考資料', '・寫大綱'])
  await page.waitForTimeout(1300)
  await expect(step.locator('[data-step]')).toBeFocused()
  // 最後一步：任務跟著完成，專注照常；目標解除了，這一行換成建議現在該做的那一件（選單先讓位，焦點在「就做這件」）
  await step.locator('[data-step]').click()
  await expect.poll(() => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id).done, id)).toBe(true)
  await expect(step.locator('.ff-step-t small')).toHaveText('要專注這一件嗎？')
  await expect(step.locator('[data-pick]')).toBeFocused()
  await expect(page.locator('#ffTargetWrap')).toBeHidden()
  expect(await page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  // 還沒拆的任務：「＋ 拆出第一小步」，打到一半每秒重畫也不會洗掉；Enter 寫下，變成下一步
  const id2 = await page.evaluate(() => {
    const s = window.hiyori.store
    const t = s.addTask({ title: '整理房間', date: s.today })
    window.hiyori.ui.focus.setTarget(`t:${t.id}`)
    return t.id
  })
  await step.locator('[data-step-open]').click()
  const input = page.locator('#ffStepText')
  await expect(input).toBeFocused()
  await input.fill('把桌上的杯子')
  await page.waitForTimeout(1300)
  await expect(input).toHaveValue('把桌上的杯子')
  await input.fill('把桌上的杯子拿去洗')
  await input.press('Enter')
  await expect(step.locator('.ff-step-t b')).toHaveText('把桌上的杯子拿去洗')
  await expect(step.locator('[data-step]')).toBeFocused()
  expect(await subsOf(id2)).toEqual(['・把桌上的杯子拿去洗'])
  // Esc：只收起寫的那一行，專注頁還開著；輸入法選字中的 Esc（取消選字）不收
  const id3 = await page.evaluate(() => {
    const s = window.hiyori.store
    const t = s.addTask({ title: '回信', date: s.today })
    window.hiyori.ui.focus.setTarget(`t:${t.id}`)
    return t.id
  })
  await step.locator('[data-step-open]').click()
  await input.fill('打開信箱')
  await input.evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })))
  await expect(input).toHaveValue('打開信箱')
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(step.locator('[data-step-open]')).toBeFocused()
  await expect(page.locator('#focusFull')).toBeVisible()
  // 寫到一半，另一個分頁（或同步）剛好替這件加了一步：這一行不收起來，字還在；寫下後兩步都在
  await step.locator('[data-step-open]').click()
  await input.fill('先回第一封')
  await page.evaluate((id) => window.hiyori.store.addSub(id, '找到老師的信'), id3)
  await page.waitForTimeout(600)
  await expect(input).toHaveValue('先回第一封')
  await expect(input).toBeFocused()
  await input.press('Enter')
  await expect(step.locator('.ff-step-t b')).toHaveText('找到老師的信')
  expect(await subsOf(id3)).toEqual(['・找到老師的信', '・先回第一封'])
  // 寫到一半時到點進入休息：這一行留著（同一個輸入框，只換成「留給等等的自己」的提示字），打到一半的字、游標和焦點都在
  await page.evaluate(() => {
    const s = window.hiyori.store
    window.hiyori.ui.focus.setTarget(`t:${s.addTask({ title: '洗衣服', date: s.today }).id}`)
  })
  await step.locator('[data-step-open]').click()
  await input.fill('把衣服丟進洗衣機')
  await input.evaluate((el) => {
    el.setSelectionRange(2, 2)
    window.__stepInput = el
  })
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.endAt -= 26 * 60000
    f._save()
  })
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('break')
  await expect(input).toHaveAttribute('placeholder', /等等回來先做什麼/)
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('把衣服丟進洗衣機')
  expect(await input.evaluate((el) => el === window.__stepInput && el.selectionStart)).toBe(2)
  // 下一輪：還是同一個輸入框，提示字換回下一小步
  await page.evaluate(() => window.hiyori.ui.focus.addRound?.())
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    if (f.mode === 'break') {
      f.endAt = Date.now() - 1000
      f._save()
    }
  })
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  await expect(input).toHaveValue('把衣服丟進洗衣機')
  await expect(input).toHaveAttribute('placeholder', /下一小步是什麼/)
  // 專注的是專案（沒有小步驟）：休息時也沒有這一行
  await page.evaluate(() => {
    const s = window.hiyori.store
    const p = s.addProject({ name: '搬家' })
    window.hiyori.ui.focus.setTarget(`p:${p.id}`)
  })
  await expect(step).toBeHidden()
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.endAt = Date.now() - 1000
    f._save()
  })
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('break')
  await expect(step).toBeHidden()
})

test('想分心了：專注中先等一分鐘、跟著圓圈呼吸（其他按鈕先收起來）；算了回來做、寫下來等等再做都記一次忍住了，一分鐘後還想去也沒關係；週報看得到', async ({ page, context, site }) => {
  // 每次重開前都要等過「剛收起來的那一下」（0.9 秒），一共好幾次：機器忙的時候給多一點時間
  test.setTimeout(120000)
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const holds = () => page.evaluate(() => window.hiyori.store.peekDay(window.hiyori.store.today).holds || 0)
  // 按了幾次「想分心了？」（記在一天的哪一段，週報看得出最常在什麼時段想分心）
  const urges = () =>
    page.evaluate(() => {
      const d = window.hiyori.store.peekDay(window.hiyori.store.today)
      return (d.urgeAm || 0) + (d.urgePm || 0) + (d.urgeEve || 0) + (d.urgeLate || 0)
    })
  await page.evaluate(() => {
    window.hiyori.store.setSetting('focusRounds', 1)
    window.hiyori.store.setSetting('focusUp', false)
    window.hiyori.ui.focus.toggle()
  })
  const btn = page.locator('#ffUrgeBtn')
  const box = page.locator('#ffUrge')
  await expect(btn).toHaveText('想分心了？先等一分鐘')
  // 打開：陪你等一分鐘，跟著圓圈呼吸；結束、暫停、記下來那幾顆先收起來，時間照樣走
  await btn.click()
  await expect(box).toBeVisible()
  expect(await urges()).toBe(1)
  await expect(page.locator('#ffUrgeT')).toHaveText('先等一分鐘')
  await expect(page.locator('#ffUrgeLeft')).toContainText('秒')
  await expect(page.locator('#ffUrgeBreath')).toHaveText(/吸氣|吐氣/)
  await expect(page.locator('#ffStop')).toBeHidden()
  await expect(page.locator('#ffPark')).toBeHidden()
  await expect(page.locator('#ffUrgeBack')).toBeFocused()
  // 「算了，回來做」：記一次忍住了，焦點回到「想分心了？」
  await page.locator('#ffUrgeBack').click()
  await expect(box).toBeHidden()
  expect(await holds()).toBe(1)
  await expect(btn).toBeFocused()
  await expect(page.locator('#ffStop')).toBeVisible()
  // 剛收起來的那一下按不開（連按 Enter 不會又打開）；過一下再按。
  // 收起來和再按一次在同一個瞬間做：測試的機器很忙時，點一下本身就可能超過那一下
  await page.waitForTimeout(900)
  expect(await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.urge(true)
    f.urge(false)
    document.getElementById('ffUrgeBtn').click()
    return document.getElementById('ffUrge').hidden
  })).toBe(true)
  await page.waitForTimeout(900)
  // 鍵盤按 U 也打開；Esc：只收起來（不算忍住），專注頁還開著
  await page.keyboard.press('u')
  await expect(box).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(box).toBeHidden()
  await expect(page.locator('#focusFull')).toBeVisible()
  expect(await holds()).toBe(1)
  // 一分鐘過了：問還想不想去；想去也沒關係——「去 5 分鐘就回來」不算忍住，專注照常（回來了按「我回來了」，見限時去的測試）
  await page.waitForTimeout(900)
  await btn.click()
  await page.evaluate(() => (window.hiyori.ui.focus.urgeAt -= 61000))
  await expect(page.locator('#ffUrgeT')).toHaveText('一分鐘過了')
  await expect(page.locator('#ffUrgeBack')).toHaveText('回來做正事')
  await page.locator('#ffUrgeAlt', { hasText: '去 5 分鐘就回來' }).click()
  await expect(box).toBeHidden()
  expect(await holds()).toBe(1)
  expect(await page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  await page.locator('#ffDetourBack').click()
  await expect(btn).toBeVisible()
  // 等的時候按 N（或「寫下來，等等再做」）：收起來、到「先記下來」那一行，也算忍住了一次
  await page.waitForTimeout(900)
  await btn.click()
  await page.keyboard.press('n')
  await expect(box).toBeHidden()
  await expect(page.locator('#ffParkText')).toBeFocused()
  expect(await holds()).toBe(2)
  // 連按 Enter：第一下回到正事（記一次），焦點到「想分心了？」上；剛收起來時接著按的不會又打開、又記一次。
  // 三下在同一個瞬間按在焦點所在的那一顆上（跟按 Enter 走同一條路）：機器忙的時候按鍵之間就可能超過那一下
  await page.waitForTimeout(900)
  await btn.click()
  await expect(page.locator('#ffUrgeBack')).toBeFocused()
  expect(await page.evaluate(() => {
    const at = []
    for (let i = 0; i < 3; i++) {
      at.push(document.activeElement?.id)
      document.activeElement.click()
    }
    return { at, hidden: document.getElementById('ffUrge').hidden }
  })).toEqual({ at: ['ffUrgeBack', 'ffUrgeBtn', 'ffUrgeBtn'], hidden: true })
  expect(await holds()).toBe(3)
  // 焦點移到面板外面的別顆上再按 Esc：也是只收起來，不縮小專注頁
  // （面板裡從「算了，回來做」往前是想去做什麼的那一排，Shift+Tab 還在面板裡；直接把焦點放到右上的耳機上）
  await page.waitForTimeout(900)
  await btn.click()
  await page.locator('#ffNoiseBtn').focus()
  expect(await page.evaluate(() => document.getElementById('ffUrge').contains(document.activeElement))).toBe(false)
  await page.keyboard.press('Escape')
  await expect(box).toBeHidden()
  await expect(page.locator('#focusFull')).toBeVisible()
  // 等的時候到點進入休息：自己收起來，焦點交給專注頁本身（不會掉到看不見的地方）
  await page.waitForTimeout(900)
  await btn.click()
  const nextRound = () =>
    page.evaluate(() => {
      const f = window.hiyori.ui.focus
      f.addRound()
      f.endAt = Date.now() - 1000
      f._save()
    })
  const endRound = () =>
    page.evaluate(() => {
      const f = window.hiyori.ui.focus
      f.endAt -= 60 * 60000
      f._save()
    })
  await endRound()
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('break')
  await expect(box).toBeHidden()
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('focusFull')
  // 打開後縮小專注頁、這一輪就到點了：下一輪不會一開始就是打開的
  await nextRound()
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  await page.waitForTimeout(900)
  await btn.click()
  await page.evaluate(() => window.hiyori.ui.focus.toggleBig(false))
  await endRound()
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('break')
  await nextRound()
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  await page.evaluate(() => window.hiyori.ui.focus.toggleBig(true))
  await expect(btn).toBeVisible()
  await expect(box).toBeHidden()
  // 打開後縮小專注頁、暫停又繼續：暫停就不算了，再打開專注頁時已經收起來
  await page.waitForTimeout(900)
  await btn.click()
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.toggleBig(false)
    f.toggle()
    f.toggle()
    f.toggleBig(true)
  })
  await expect(box).toBeHidden()
  await expect(btn).toBeVisible()
  expect(await holds()).toBe(3)
  // 暫停中沒有這一顆
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  await expect(btn).toBeHidden()
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  await expect(btn).toBeVisible()
  // 週報：本週表現分析多一列「想分心時忍住」
  await page.evaluate(() => {
    window.hiyori.ui.focus.stop()
    window.hiyori.ui.setTab('coach')
  })
  await page.locator('#coachRoot [data-v="report"]').click()
  await expect(page.locator('#coachRoot .wr-perf li', { hasText: '想分心時忍住' })).toContainText('3 次')
})

test('想分心時說出想去做什麼：點一下選起來（再點取消），忍住或還是去了都記下來，ふじ／もち說到那件事；週報寫最常想去的、習慣洞察給建議', async ({ page, context, site }) => {
  test.setTimeout(120000)
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  const day = () => page.evaluate(() => { const s = window.hiyori.store; const d = s.peekDay(s.today); return { pulls: d.pulls || {}, holds: d.holds || 0 } })
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    window.hiyori.ui.focus.toggle()
  })
  const btn = page.locator('#ffUrgeBtn')
  const box = page.locator('#ffUrge')
  const chips = page.locator('#ffUrgePulls [data-pull]')
  const chip = (text) => chips.filter({ hasText: text })
  await btn.click()
  await expect(chips).toHaveText(['滑手機', '看訊息', '看影片', '吃點東西', '查別的事', '休息一下'])
  await expect(page.locator('#ffUrgePulls')).toHaveAttribute('role', 'group')
  // 點一下選起來（下面寫一件現在就做得到的小事），再點一下取消；換一個
  const now = page.locator('#ffUrgeTip')
  await expect(now).toBeHidden()
  await chip('看訊息').click()
  await expect(chip('看訊息')).toHaveAttribute('aria-pressed', 'true')
  await expect(now).toHaveText('訊息等休息時一起回；真的很急，回完那一則就回來。')
  await chip('看訊息').click()
  await expect(chip('看訊息')).toHaveAttribute('aria-pressed', 'false')
  await expect(now).toBeHidden()
  await chip('滑手機').click()
  await expect(now).toHaveText(/先把手機翻過來/)
  // 算了，回來做：忍住了一次，記下滑手機；說的話提到滑手機
  await page.locator('#ffUrgeBack').click()
  await expect(box).toBeHidden()
  expect(await day()).toEqual({ pulls: { phone: 1 }, holds: 1 })
  await expect.poll(() => chatSaid(page, '滑手機')).toBe(true)
  // 再打開時是沒選的；一分鐘過了、選「休息一下」、還是想去：不算忍住，但記下來
  await page.waitForTimeout(900)
  await btn.click()
  await expect(page.locator('#ffUrgePulls [aria-pressed="true"]')).toHaveCount(0)
  await chip('休息一下').click()
  await page.evaluate(() => (window.hiyori.ui.focus.urgeAt -= 61000))
  await page.locator('#ffUrgeAlt', { hasText: '去 5 分鐘就回來' }).click()
  await expect(box).toBeHidden()
  expect(await day()).toEqual({ pulls: { phone: 1, rest: 1 }, holds: 1 })
  await expect.poll(() => chatSaid(page, '休息一下')).toBe(true)
  await page.locator('#ffDetourBack').click()
  // 選了但按 Esc 只收起來：什麼都不記
  await page.waitForTimeout(900)
  await btn.click()
  await chip('看影片').click()
  await page.keyboard.press('Escape')
  await expect(box).toBeHidden()
  expect(await day()).toEqual({ pulls: { phone: 1, rest: 1 }, holds: 1 })
  // 週報：「最常想去」寫這週最常的兩個；習慣洞察：休息一下滿 3 次，建議一輪短一點，一鍵改成 20 分鐘
  await page.evaluate(() => {
    const h = window.hiyori
    h.store.focusWent('rest')
    h.store.focusWent('rest')
    h.ui.focus.stop()
    h.ui.setTab('coach')
  })
  await page.locator('#coachRoot [data-v="report"]').click()
  await expect(page.locator('#coachRoot .wr-perf li', { hasText: '最常想去' })).toContainText(/休息一下\s*3\s*・\s*滑手機\s*1/)
  const tip = page.locator('#coachRoot .wr-ins li', { hasText: '想分心時，最常想去休息一下' })
  await expect(tip).toContainText('最近兩週有 3 次')
  await tip.locator('[data-act="focusMin"]').click()
  await expect.poll(() => page.evaluate(() => window.hiyori.store.state.settings.focusMin)).toBe(20)
  await toastSeen(page, '專注一輪改成 20 分鐘')
  // 同一批紀錄不會接著又建議縮成 15 分：洞察還在，按鈕收起來、說一聲先照這樣看幾天
  await expect(page.locator('#coachRoot [data-act="focusMin"]')).toHaveCount(0)
  await expect(page.locator('#coachRoot .wr-ins li', { hasText: '最常想去休息一下' })).toContainText('先照這樣再看幾天')
})

test('限時去：等完一分鐘還是想去時「去 5 分鐘就回來」，專注頁寫著幾點叫你回來（重新整理也記得）；時間到了提示卡叫你一次，按「我回來了」記一次；切走再回到 App 也算回來了；今日反思寫著', async ({ page, context, site }) => {
  test.setTimeout(120000)
  await useAppMode(context)
  // 切到別的分頁：設了 window.__hidden 就照它算「頁面看不看得到」，沒設照瀏覽器的
  // （重新整理時頁面真的變成看不到：不能被當成「回到頁面」）
  await context.addInitScript(() => {
    const real = (k) => Object.getOwnPropertyDescriptor(Document.prototype, k).get
    const hidden = real('hidden')
    const state = real('visibilityState')
    Object.defineProperty(Document.prototype, 'hidden', { get() { return window.__hidden ?? hidden.call(this) }, configurable: true })
    Object.defineProperty(Document.prototype, 'visibilityState', { get() { return window.__hidden == null ? state.call(this) : window.__hidden ? 'hidden' : 'visible' }, configurable: true })
  })
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const returns = () => page.evaluate(() => window.hiyori.store.peekDay(window.hiyori.store.today).returns || 0)
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    const t = s.addTask({ title: '寫期末報告', date: s.today })
    window.hiyori.ui.focus.startWith(t.id)
  })
  const btn = page.locator('#ffUrgeBtn')
  const detour = page.locator('#ffDetour')
  // 想分心了，等完一分鐘還是想去：去 5 分鐘就回來。那一行寫著幾點叫你回來，焦點在「我回來了」上
  await btn.click()
  await page.clock.setFixedTime(T('10:01:01'))
  await expect(page.locator('#ffUrgeT')).toHaveText('一分鐘過了')
  await expect(page.locator('#ffUrgeP')).toContainText('去 5 分鐘，時間到了叫你回來')
  await page.locator('#ffUrgeAlt', { hasText: '去 5 分鐘就回來' }).click()
  await expect(detour).toBeVisible()
  await expect(page.locator('#ffDetourT')).toHaveText('去一下・10:06 叫你回來')
  await expect(page.locator('#ffDetourBack')).toBeFocused()
  await expect(btn).toBeHidden()
  await expect.poll(() => chatSaid(page, '10:06')).toBe(true)
  // 重新整理之後也記得（存在計時的狀態裡）
  await page.reload()
  await bootReady(page)
  await page.evaluate(() => window.hiyori.ui.focus.toggleBig(true))
  await expect(page.locator('#ffDetourT')).toHaveText('去一下・10:06 叫你回來')
  // 時間到了：提示卡叫你回來，那一行換成「說好的 5 分鐘到了」；只叫一次
  await page.clock.setFixedTime(T('10:06:02'))
  await toastSeen(page, '說好的 5 分鐘到了，回來吧')
  await expect(page.locator('#ffDetourT')).toHaveText('說好的 5 分鐘到了，回來吧')
  await expect(detour).toHaveClass(/due/)
  await page.waitForTimeout(1300)
  expect(await page.evaluate(() => (window.__toasts || []).filter((x) => x.includes('說好的 5 分鐘到了')).length)).toBe(1)
  // 提示卡上按「我回來了」：記一次，那一行收起來，「想分心了？」回來
  await page.locator('#toasts .toast', { hasText: '說好的 5 分鐘到了' }).getByRole('button', { name: '我回來了' }).click()
  await expect(detour).toBeHidden()
  await expect(btn).toBeVisible()
  expect(await returns()).toBe(1)
  // 再去一次，這次切到別的分頁、過一會兒回來：回到 App 就算回來了
  await btn.click()
  await page.clock.setFixedTime(T('10:07:05'))
  await page.locator('#ffUrgeAlt', { hasText: '去 5 分鐘就回來' }).click()
  await expect(page.locator('#ffDetourT')).toHaveText('去一下・10:12 叫你回來')
  await page.evaluate(() => {
    window.__hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.setFixedTime(T('10:09:00'))
  await page.evaluate(() => {
    window.__hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(detour).toBeHidden()
  expect(await returns()).toBe(2)
  // 限時去的時候按了暫停：自己停下來了，那一行收起來、不再叫你回來
  await page.waitForTimeout(900)
  await btn.click()
  await page.clock.setFixedTime(T('10:10:05'))
  await page.locator('#ffUrgeAlt', { hasText: '去 5 分鐘就回來' }).click()
  await expect(detour).toBeVisible()
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  await expect(detour).toBeHidden()
  expect(await page.evaluate(() => window.hiyori.ui.focus.detour)).toBe(0)
  // 新的一輪（10:20～10:45）快到點時才去：說好 10:46 回來，這一輪 10:45 先到點了——交給到點那邊（不先叫「5 分鐘到了」），
  // 切走再回來也不算回來了
  await page.clock.setFixedTime(T('10:20:00'))
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.stop()
    f.toggle()
  })
  await btn.click()
  await page.clock.setFixedTime(T('10:41:00'))
  await page.locator('#ffUrgeAlt', { hasText: '去 5 分鐘就回來' }).click()
  await expect(page.locator('#ffDetourT')).toHaveText('去一下・10:46 叫你回來')
  // 正在限時去：「想分心了？」打不開，另一個分頁還開著的「先等一分鐘」也不算了
  expect(await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    const opened = f.urge(true)
    f.urgeAt = Date.now()
    f.urgeSid = f.sid
    f._renderUrge()
    return { opened, urgeAt: f.urgeAt, hidden: document.getElementById('ffUrge').hidden }
  })).toEqual({ opened: false, urgeAt: 0, hidden: true })
  await page.evaluate(() => {
    window.__hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.setFixedTime(T('10:47:00'))
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('break')
  await page.evaluate(() => {
    window.__hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(600)
  expect(await returns()).toBe(2)
  expect(await page.evaluate(() => (window.__toasts || []).filter((x) => x.includes('說好的 5 分鐘到了')).length)).toBe(1)
  // 另一個分頁已經按了「我回來了」（存著的已經沒有限時去，這邊的 storage 事件還沒到）：這邊按了只跟著收起來，不再記一次；
  // 已經叫過了的也不再叫
  await page.clock.setFixedTime(T('11:00:00'))
  const other = await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.stop()
    f.toggle()
    const s = window.hiyori.store
    const before = s.peekDay(s.today).returns || 0
    const stored = () => JSON.parse(localStorage.getItem('hiyori-focus'))
    // 這邊記憶體裡還有限時去，存著的沒有
    f.detour = Date.now() + 60000
    const counted = f.detourBack()
    const a = { counted, detour: f.detour, returns: (s.peekDay(s.today).returns || 0) - before }
    // 存著的已經叫過了：時間到了這邊不再叫
    f.detour = Date.now() - 1000
    f.detourRang = false
    f._persist()
    localStorage.setItem('hiyori-focus', JSON.stringify({ ...stored(), detourRang: true }))
    return { a, before: (window.__toasts || []).length }
  })
  expect(other.a).toEqual({ counted: false, detour: 0, returns: 0 })
  await page.waitForTimeout(800)
  expect(await page.evaluate(() => window.hiyori.ui.focus.detourRang)).toBe(true)
  expect(await page.evaluate(() => (window.__toasts || []).filter((x) => x.includes('說好的 5 分鐘到了')).length)).toBe(1)
  // 今日反思：寫著去一下就回來幾次，也算進「把自己拉回來」
  await page.evaluate(() => {
    window.hiyori.ui.focus.stop()
    window.hiyori.ui.setTab('today')
  })
  const back = page.locator('#todayRoot .td-back')
  await expect(back.locator('li', { hasText: '去一下就回來' })).toHaveText('去一下就回來 2 次')
  await expect(back.locator('p')).toHaveText('今天把自己拉回來 2 次，很不容易。')
})

test('上週回顧卡：寫著那週把自己拉回來幾次（忍住分心、警語提醒時回到正事；本來就在做的不算）和最常想去做什麼', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    const s = window.hiyori.store
    const t = new Date(s.today + 'T00:00:00')
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    // 上週一
    const mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7) - 7)
    const day = (n) => s.day(ymd(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + n)))
    Object.assign(day(1), { holds: 2, nudges: 3, backs: 1, onTask: 1, pulls: { phone: 2 } })
    Object.assign(day(3), { holds: 1, nudges: 2, backs: 2, pulls: { msg: 1 } })
    window.hiyori.ui.openWeekCard()
  })
  await expect(page.locator('#weekModal')).toBeVisible()
  await expect(page.locator('#weekNotes')).toContainText('把自己拉回來 6 次（忍住分心 3 次、警語提醒時回到正事 3 次）・最常想去滑手機')
})

test('今天的回神：今日反思最上面寫今天專注了多久、想分心時忍住幾次（最常想去做什麼）、警語提醒時回神幾次，誇一句；什麼都還沒有就不放', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => window.hiyori.ui.setTab('today'))
  const back = page.locator('#todayRoot .td-back')
  await expect(page.locator('#todayRoot .td-ref')).toBeVisible()
  await expect(back).toHaveCount(0)
  await page.evaluate(() => {
    const s = window.hiyori.store
    const now = Date.now()
    s.focusHold('phone')
    s.focusHold('phone')
    s.focusHold('msg')
    // 還是去了的不算忍住
    s.focusWent('video')
    // 提醒了 3 次：一次之後回到正事、一次本來就在做
    s.mottoNudged(now - 30 * 60000)
    s.mottoNudged(now - 20 * 60000)
    s.mottoAnswered('back', now - 30 * 60000)
    s.mottoAnswered('on', now - 10 * 60000)
    s.completePomodoro(25)
    window.hiyori.ui.today.render()
  })
  await expect(back.locator('li')).toHaveText(['專注 25 分', '想分心時忍住 3 次最常想去滑手機', '警語提醒時回神 2／3 次'])
  // 拉回來的：忍住的 3 次＋提醒之後回到正事的 1 次（本來就在做的不算）
  await expect(back.locator('p')).toHaveText('今天把自己拉回來 4 次，很不容易。')
})

test('每天的專注目標：計時設定裡選每天專注多久；專注頁上方寫著今天已專注多少／目標和一條進度，跨過目標的那一輪慶祝一下（之後的不再）；今日反思寫著達成了', async ({ page, context, site }) => {
  await useAppMode(context)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    s.setSetting('breakMin', 5)
    // 今天已經專注了 40 分
    s.completePomodoro(40)
    window.hiyori.ui.focus.setTarget('')
    window.hiyori.ui.focus.toggleSet(true)
  })
  // 預設不設；選「1 小時」存進設定
  const goal = page.locator('#fsGoal')
  await expect(goal.getByRole('button', { name: '不設' })).toHaveAttribute('aria-pressed', 'true')
  await goal.getByRole('button', { name: '1 小時', exact: true }).click()
  await expect(goal.getByRole('button', { name: '1 小時', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.hiyori.store.state.settings.focusGoal)).toBe(60)
  // 開始專注：專注頁上方寫著還差多少，進度條走到三分之二
  await page.locator('#fsStart').click()
  await expect(page.locator('#focusFull')).toBeVisible()
  // 計時中不能改目標（那一列收起來）
  await page.evaluate(() => window.hiyori.ui.focus.toggleSet(true))
  await expect(page.locator('#fsGoalRow')).toBeHidden()
  await page.evaluate(() => window.hiyori.ui.focus.toggleSet(false))
  const today = page.locator('#ffToday')
  await expect(today).toHaveText('今天 40 分／目標 1 小時')
  await expect(today.locator('.ff-goal b')).toHaveAttribute('style', /width:\s*67%/)
  await expect(today).not.toHaveClass(/goal-done/)
  // 這一輪到點：跨過 1 小時，提示卡寫著、ふじ／もち說一聲；專注頁上換成達成了
  await page.clock.setFixedTime(T('10:25:01'))
  await toastSeen(page, '今天的專注目標達成了')
  await toastSeen(page, '已專注 1 小時 5 分・目標 1 小時')
  await expect.poll(() => chatSaid(page, '1 小時')).toBe(true)
  await expect(today).toHaveText('目標達成・今天 1 小時 5 分')
  await expect(today).toHaveClass(/goal-done/)
  // 已經達成之後的那一輪：不再慶祝一次
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.stop()
    f.toggle()
  })
  await page.clock.setFixedTime(T('10:50:02'))
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('break')
  await page.waitForTimeout(3500)
  expect(await page.evaluate(() => (window.__toasts || []).filter((x) => x.includes('今天的專注目標達成了')).length)).toBe(1)
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  // 今日反思：寫著達成了每天的目標
  await page.evaluate(() => window.hiyori.ui.setTab('today'))
  const back = page.locator('#todayRoot .td-back')
  await expect(back.locator('li')).toHaveText(['專注 1 小時 30 分達成每天的目標 1 小時'])
  await expect(back.locator('p')).toHaveText('今天的專注目標 1 小時 達成了，辛苦了。')
})

test('接下來：專注頁寫著今天下一個日程（2 小時內）；這一輪結束前就要開始的寫「記得提早收尾」、ふじ提醒一聲；進行中的寫到幾點', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  await useAppMode(context)
  await page.clock.setFixedTime(new Date(`${ymd}T10:00:00+08:00`))
  await page.goto(site.url)
  await bootReady(page)
  const id = await page.evaluate(() => {
    const s = window.hiyori.store
    // 範例的例行日程先拿掉，只留這一場
    for (const e of s.eventsOn(s.today)) s.deleteEvent(e.id)
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    return s.addEvent({ title: '設計週會', date: s.today, start: '10:20', end: '11:00' }).id
  })
  const move = (start, end) => page.evaluate(([id, start, end]) => window.hiyori.store.updateEvent(id, { start, end }), [id, start, end])
  // 10:00 開始 25 分鐘：10:20 的會議會在這一輪結束前開始
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  const next = page.locator('#ffNext')
  await expect(next).toHaveText(/這一輪結束前\s*10:20 設計週會\s*還有 20 分鐘，記得提早收尾/)
  await expect(next).toHaveClass(/clash/)
  await expect.poll(() => chatSaid(page, '設計週會')).toBe(true)
  // 改到 10:40：不會撞到這一輪（10:25 結束），只寫接下來
  await move('10:40', '11:20')
  await expect(next).toHaveText(/接下來\s*10:40 設計週會\s*還有 40 分鐘/)
  await expect(next).not.toHaveClass(/clash/)
  // 改到 13:00：還早，不寫
  await move('13:00', '14:00')
  await expect(next).toBeHidden()
  // 進行中：寫到幾點
  await move('09:30', '10:30')
  await expect(next).toHaveText(/進行中\s*設計週會\s*到 10:30/)
  // 標成做完了（提早結束的會議）：不寫
  await page.evaluate((id) => window.hiyori.store.toggleEvent(id), id)
  await expect(next).toBeHidden()
})

test('接下來：帶著秒數開始也算得準（10:00:30 開始的 25 分鐘會撞到 10:25）；暫停時照真的時間更新；停掉重來的那一輪不說上一輪的「會撞到」', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await useAppMode(context)
  await page.clock.setFixedTime(T('10:00:30'))
  await page.goto(site.url)
  await bootReady(page)
  const id = await page.evaluate(() => {
    const s = window.hiyori.store
    for (const e of s.eventsOn(s.today)) s.deleteEvent(e.id)
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    // 專注在一件自己的任務上（範例不算進「現在該做」）
    s.addTask({ title: '寫報告', date: s.today, priority: 3 })
    return s.addEvent({ title: '設計週會', date: s.today, start: '10:25', end: '11:00' }).id
  })
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  const next = page.locator('#ffNext')
  // 這一輪結束在 10:25:30：會撞到 10:25 的會議
  await expect(next).toHaveClass(/clash/)
  await expect.poll(() => chatSaid(page, '設計週會')).toBe(true)
  // 過了一分鐘（10:01:30）還是會撞到：不會每過半分鐘就變一次
  await page.clock.setFixedTime(T('10:01:30'))
  await expect(next).toHaveText(/這一輪結束前\s*10:25 設計週會\s*還有 24 分鐘/)
  await page.waitForTimeout(1200)
  await expect(next).toHaveClass(/clash/)
  // 暫停：計時停著（不寫會撞到），時間照走——會議開始了就寫進行中
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  await expect(next).toHaveText(/接下來\s*10:25 設計週會/)
  await expect(next).not.toHaveClass(/clash/)
  await page.clock.setFixedTime(T('10:26:00'))
  await expect(next).toHaveText(/進行中\s*設計週會\s*到 11:00/)
  // 開始一輪會撞到「看牙醫」，馬上停掉、把牙醫改到 11:30 再開始：2.6 秒後不說上一輪的「會撞到」
  const tooth = await page.evaluate((id) => {
    const h = window.hiyori
    h.store.deleteEvent(id)
    h.ui.focus.stop()
    const e = h.store.addEvent({ title: '看牙醫', date: h.store.today, start: '10:40', end: '11:00' })
    h.ui.focus.toggle()
    return { id: e.id, clash: h.ui.focus.nextUp().clash }
  }, id)
  expect(tooth.clash).toBe(true)
  await page.evaluate((id) => {
    const h = window.hiyori
    h.ui.focus.stop()
    h.store.updateEvent(id, { start: '11:30', end: '12:00' })
    h.ui.focus.toggle()
  }, tooth.id)
  await page.waitForTimeout(3200)
  expect(await chatSaid(page, '看牙醫')).toBe(false)
  await page.evaluate(() => window.hiyori.ui.focus.stop())
})

test('休息前留一步：到點時還沒寫下一步的那件，提示卡上按「留一步給等等」打開專注頁直接寫；休息時寫著「等等從這裡開始」，下一輪從那一步開始；專注頁開著時頁面上就有、提示卡不再放', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await useAppMode(context)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const step = page.locator('#ffStep')
  const input = page.locator('#ffStepText')
  const mode = () => page.evaluate(() => window.hiyori.ui.focus.mode)
  const task = (id) => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id), id)
  const id = await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    s.setSetting('breakMin', 5)
    const t = s.addTask({ title: '寫期末報告', date: s.today })
    window.hiyori.ui.focus.startWith(t.id)
    return t.id
  })
  await expect(page.locator('#focusFull')).toBeVisible()
  await expect(step.locator('[data-step-open]')).toHaveText('＋ 拆出第一小步')
  // 專注頁縮小著到點：提示卡上有「留一步給等等」，按了打開專注頁、焦點在輸入框
  await page.locator('#ffMin').click()
  await expect(page.locator('#focusFull')).toBeHidden()
  await page.clock.setFixedTime(T('10:25:01'))
  await expect.poll(mode).toBe('break')
  await page.locator('#toasts .toast', { hasText: '專注完成' }).getByRole('button', { name: '留一步給等等' }).click()
  await expect(page.locator('#focusFull')).toBeVisible()
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('placeholder', /等等回來先做什麼/)
  await input.fill('把第二節的三個重點列出來')
  await input.press('Enter')
  await expect(step.locator('.ff-step-t small')).toHaveText('等等從這裡開始')
  await expect(step.locator('.ff-step-t b')).toHaveText('把第二節的三個重點列出來')
  await expect(step.locator('[data-step]')).toBeFocused()
  expect((await task(id)).subs.map((x) => x.title)).toEqual(['把第二節的三個重點列出來'])
  await expect.poll(() => chatSaid(page, '把第二節的三個重點列出來')).toBe(true)
  // 休息完（只有一輪）再來一輪：專注頁寫著那一步，從它開始
  await page.clock.setFixedTime(T('10:30:02'))
  await expect.poll(mode).toBe('idle')
  await page.evaluate(() => window.hiyori.ui.focus.again())
  await expect(page.locator('#focusFull')).toBeVisible()
  await expect(step.locator('.ff-step-t small')).toHaveText('下一步')
  await expect(step.locator('.ff-step-t b')).toHaveText('把第二節的三個重點列出來')
  // 專注頁開著到點：頁面上就寫著「休息前留一步」，提示卡上不再放一次
  const id2 = await page.evaluate(() => {
    const s = window.hiyori.store
    const t = s.addTask({ title: '整理房間', date: s.today })
    window.hiyori.ui.focus.setTarget(`t:${t.id}`)
    return t.id
  })
  await page.clock.setFixedTime(T('10:55:03'))
  await expect.poll(mode).toBe('break')
  await expect(step.locator('[data-step-open]')).toHaveText('＋ 休息前留一步給等等的自己')
  await expect(page.locator('#toasts .toast', { hasText: '專注完成' })).toBeVisible()
  await expect(page.locator('#toasts .toast').getByRole('button', { name: '留一步給等等' })).toHaveCount(0)
  // Esc 只收起寫的那一行；再寫一次
  await step.locator('[data-step-open]').click()
  await input.fill('先把衣服')
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(step.locator('[data-step-open]')).toBeFocused()
  await expect(page.locator('#focusFull')).toBeVisible()
  await step.locator('[data-step-open]').click()
  await input.fill('先把衣服收進衣櫃')
  await input.press('Enter')
  await expect(step.locator('.ff-step-t b')).toHaveText('先把衣服收進衣櫃')
  // 休息時就做完了：勾掉，任務跟著完成、這一行收起來；焦點交給專注頁（選目標的那一格休息時看不到）
  await step.locator('[data-step]').click()
  await expect.poll(async () => (await task(id2)).done).toBe(true)
  await expect(step).toBeHidden()
  await expect(page.locator('#focusFull')).toBeFocused()
  await page.evaluate(() => window.hiyori.ui.focus.stop())
})

test('沒選目標就開始專注：專注頁建議現在該做的那一件（本命在前），「就做這件」選成這一輪的目標；按 × 這一輪不再問（延長也是同一輪）、下一輪再問；建議的換了焦點接回「就做這件」', async ({ page, context, site }) => {
  await useAppMode(context)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const step = page.locator('#ffStep')
  const id = await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    // 只留這兩件：本命的那件排在前面
    s.clearSamples()
    for (const t of s.tasksOn(s.today)) s.deleteTask(t.id)
    s.addTask({ title: '回信', date: s.today })
    const t = s.addTask({ title: '寫期末報告', date: s.today, priority: 3 })
    s.toggleStar(t.id)
    window.hiyori.ui.focus.setTarget('')
    window.hiyori.ui.focus.toggle()
    return t.id
  })
  await expect(page.locator('#focusFull')).toBeVisible()
  await expect(step.locator('.ff-step-t small')).toHaveText('要專注這一件嗎？')
  await expect(step.locator('.ff-step-t b')).toHaveText('寫期末報告')
  // 目標的選單先讓位給這一行（版面一樣高）
  await expect(page.locator('#ffTargetWrap')).toBeHidden()
  // 就做這件：這一輪的目標換成它，這一行換成拆出第一小步（焦點接過去），選單回來寫著它，ふじ／もち說一聲
  await step.getByRole('button', { name: '就做這件' }).click()
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.taskId)).toBe(id)
  await expect(step.locator('[data-step-open]')).toBeFocused()
  await expect(page.locator('#ffTargetWrap')).toBeVisible()
  await expect(page.locator('#ffTarget')).toHaveValue(`t:${id}`)
  await expect.poll(() => chatSaid(page, '寫期末報告')).toBe(true)
  // 不指定也可以：按 ×，這一輪不再問（每秒重畫也不會再跑出來），選單出來、焦點在上面
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.stop()
    f.setTarget('')
    f.toggle()
  })
  await expect(step.locator('.ff-step-t b')).toHaveText('寫期末報告')
  await step.getByRole('button', { name: '這一輪不指定目標' }).click()
  await expect(step).toBeHidden()
  await expect(page.locator('#ffTargetWrap')).toBeVisible()
  await expect(page.locator('#ffTarget')).toBeFocused()
  await page.waitForTimeout(1300)
  await expect(step).toBeHidden()
  // 按了 × 的這一輪到點、還沒做完延長：同一輪接著做，也不再問
  await page.clock.setFixedTime(T('10:25:01'))
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('break')
  expect(await page.evaluate(() => window.hiyori.ui.focus.extend())).toBe(true)
  await page.waitForTimeout(1300)
  expect(await page.evaluate(() => window.hiyori.ui.focus.ext)).toBe(true)
  await expect(step).toBeHidden()
  // 下一輪再問（加時按 ■ 是做完了、接著休息：再按一次結束）
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.stop()
    if (f.mode !== 'idle') f.stop()
    f.toggle()
  })
  await expect(step.locator('.ff-step-t small')).toHaveText('要專注這一件嗎？')
  // 焦點停在「就做這件」上時，建議的那一件換了（例如另一個分頁把它做完了）：焦點接到換上來的「就做這件」
  await step.getByRole('button', { name: '就做這件' }).focus()
  await page.evaluate((id) => window.hiyori.store.toggleTask(id), id)
  await expect(step.locator('.ff-step-t b')).toHaveText('回信')
  await expect(step.getByRole('button', { name: '就做這件' })).toBeFocused()
  await page.evaluate(() => window.hiyori.ui.focus.stop())
})

test('休息前留一步（小島模式）：提示卡上按「留一步給等等」打開計時設定的小視窗直接寫，收起來再點 Dock 上的時間打開時打到一半的字還在；換了目標之後按舊的提示卡不會寫到別件上', async ({ page, site }) => {
  // 小島模式一直在畫 3D 的小島：機器忙的時候每一步都慢一點
  test.setTimeout(120000)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const mode = () => page.evaluate(() => window.hiyori.ui.focus.mode)
  const subs = (id) => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id).subs.map((x) => x.title), id)
  const [a, b] = await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    s.setSetting('breakMin', 5)
    const a = s.addTask({ title: '寫期末報告', date: s.today })
    const b = s.addTask({ title: '整理房間', date: s.today })
    window.hiyori.ui.focus.startWith(a.id)
    return [a.id, b.id]
  })
  expect(await page.evaluate(() => window.hiyori.ui.appMode)).toBe(false)
  // 到點：提示卡上有「留一步給等等」。按之前另一個分頁把目標換成別件：按了不會寫到那一件上
  // （到點那一下要記專注、放提示卡、兩人走出小木屋：機器很忙時多等一下）
  await page.clock.setFixedTime(T('10:25:01'))
  await expect.poll(mode, { timeout: 30000 }).toBe('break')
  const first = page.locator('#toasts .toast', { hasText: '專注完成' })
  await expect(first.getByRole('button', { name: '留一步給等等' })).toBeVisible()
  await page.evaluate((b) => window.hiyori.ui.focus.setTarget(`t:${b}`), b)
  // （直接送點擊：小島一直在畫，機器很忙的時候等「捲到看得到、不再動」可能等到逾時）
  await first.getByRole('button', { name: '留一步給等等' }).dispatchEvent('click')
  await expect(page.locator('#focusSet')).toBeHidden()
  expect(await subs(b)).toEqual([])
  expect(await subs(a)).toEqual([])
  // 換回來、再一輪：這次按了打開計時設定的小視窗，焦點在輸入框
  await page.evaluate((a) => {
    const f = window.hiyori.ui.focus
    f.stop()
    f.startWith(a)
  }, a)
  await page.clock.setFixedTime(T('10:50:02'))
  await expect.poll(mode, { timeout: 30000 }).toBe('break')
  await page.locator('#toasts .toast', { hasText: '專注完成' }).getByRole('button', { name: '留一步給等等' }).dispatchEvent('click')
  await expect(page.locator('#focusSet')).toBeVisible()
  const input = page.locator('#fsStepText')
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('placeholder', /等等回來先做什麼/)
  await input.fill('把第二節的三個重點')
  // 先收起小視窗（Esc 在別的地方按），再點 Dock 上的時間打開：打到一半的字還在
  await page.locator('#fsTarget').focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('#focusSet')).toBeHidden()
  // （直接送點擊：機器很忙的時候，等「捲到看得到、不再動」可能等到逾時）
  await page.locator('#focusTime').dispatchEvent('click')
  await expect(page.locator('#focusSet')).toBeVisible()
  await expect(input).toHaveValue('把第二節的三個重點')
  await input.fill('把第二節的三個重點列出來')
  await input.press('Enter')
  await expect(page.locator('#fsStep .ff-step-t small')).toHaveText('等等從這裡開始')
  await expect(page.locator('#fsStep .ff-step-t b')).toHaveText('把第二節的三個重點列出來')
  expect(await subs(a)).toEqual(['把第二節的三個重點列出來'])
  await page.evaluate(() => window.hiyori.ui.focus.stop())
})

test('回來了，現在該做：離開 20 分鐘以上再回到 App、沒在計時時，提示卡寫現在該做的那一件和下一步，一鍵開始專注；一陣子內只說一次、離開不久不說、專注中不說；設定裡可以關', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await context.addInitScript(({ ymd }) => {
    Object.defineProperty(Document.prototype, 'hidden', { get: () => !!window.__hidden, configurable: true })
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => (window.__hidden ? 'hidden' : 'visible'), configurable: true })
    if (!localStorage.getItem('hiyori-daily-v1')) {
      const tasks = [{ id: 'e2e-b1', title: '寫期末報告', priority: 3, date: ymd, star: true, subs: [{ id: 'e2e-s1', title: '列出三個重點', done: false }] }]
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, settings: {} }))
    }
  }, { ymd })
  await useAppMode(context)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  const away = async (from, to) => {
    await page.clock.setFixedTime(T(from))
    await page.evaluate(() => {
      window.__hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.setFixedTime(T(to))
    await page.evaluate(() => {
      window.__hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }
  const welcomes = () => page.evaluate(() => (window.__toasts || []).filter((x) => x.includes('歡迎回來')).length)
  const mode = () => page.evaluate(() => [window.hiyori.ui.focus.mode, window.hiyori.ui.focus.taskId])
  // 剛打開（之前沒離開過的紀錄）：不說
  await page.waitForTimeout(1500)
  expect(await welcomes()).toBe(0)
  // 離開 30 分鐘回來：提示卡寫現在該做的那一件和下一步，ふじ說一聲；按「▶ 開始專注」開始專注那一件
  await away('10:00:00', '10:30:00')
  const card = page.locator('#toasts .toast', { hasText: '歡迎回來' })
  await expect(card).toContainText('現在該做：寫期末報告・下一步：列出三個重點')
  await expect.poll(() => chatSaid(page, '寫期末報告')).toBe(true)
  await card.getByRole('button', { name: '▶ 開始專注' }).click()
  await expect.poll(mode).toEqual(['focus', 'e2e-b1'])
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  // 一個半小時內只說一次：又離開一小時回來，不說
  await away('10:31:00', '11:30:00')
  await page.waitForTimeout(1500)
  expect(await welcomes()).toBe(1)
  // 過了一個半小時：離開不久（10 分鐘）不說；離開半小時才說，「只做 5 分鐘」也可以
  await away('12:05:00', '12:15:00')
  await page.waitForTimeout(1500)
  expect(await welcomes()).toBe(1)
  await away('12:15:00', '12:45:00')
  await expect.poll(welcomes).toBe(2)
  await card.getByRole('button', { name: '只做 5 分鐘' }).click()
  await expect.poll(() => page.evaluate(() => [window.hiyori.ui.focus.mode, window.hiyori.ui.focus.small, window.hiyori.ui.focus.taskId])).toEqual(['focus', true, 'e2e-b1'])
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  // 專注中離開又回來（過了一個半小時）：交給「回來了，還剩幾分鐘」那一句，不放這張
  await page.clock.setFixedTime(T('14:20:00'))
  await page.evaluate(() => window.hiyori.ui.focus.startWith('e2e-b1'))
  await away('14:21:00', '14:42:00')
  await page.waitForTimeout(1500)
  expect(await mode()).toEqual(['focus', 'e2e-b1'])
  expect(await welcomes()).toBe(2)
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  // 警語先停著（開會、吃飯，停到 16:00）：不說
  await page.clock.setFixedTime(T('14:43:00'))
  await page.evaluate(() => window.hiyori.store.pauseMottos(Date.now() + 77 * 60000))
  await away('14:43:00', '15:20:00')
  await page.waitForTimeout(1500)
  expect(await welcomes()).toBe(2)
  // 設定裡關掉：不說
  await page.evaluate(() => window.hiyori.store.setSetting('backNudge', false))
  await away('16:30:00', '17:10:00')
  await page.waitForTimeout(1500)
  expect(await welcomes()).toBe(2)
  await page.evaluate(() => window.hiyori.store.setSetting('backNudge', true))
  // 重新打開（App 被收掉了）也一樣：今天看過摘要、離開一陣子才打開，打開時就說（打招呼換成那一句）。
  // 先離開（關掉頁面時記下 17:20 還在看），18:30 再打開
  await page.clock.setFixedTime(T('17:20:00'))
  await page.goto('about:blank')
  await page.clock.setFixedTime(T('18:30:00'))
  await page.goto(site.url)
  await bootReady(page)
  // CI 的機器（2 核心、軟體算圖）重新打開後第一次畫出畫面要等快 10 秒，提示卡跟著晚出來：多等一下
  await expect.poll(welcomes, { timeout: 30000 }).toBe(1)
  await expect(page.locator('#toasts .toast', { hasText: '歡迎回來' })).toContainText('現在該做：寫期末報告')
  // 睡覺時間（預設 23:00 就寢）：不說
  await away('18:31:00', '23:40:00')
  await page.waitForTimeout(1500)
  expect(await welcomes()).toBe(1)
})

test('做完一件，接著下一件：沒在計時的時候勾掉現在該做的那一件，提示卡寫下一件（和下一步），一鍵開始專注；不是最前面那一件、專注中、20 分鐘內再勾、今天都做完了不說；設定裡可以關', async ({ page, context, site }) => {
  // 「不說」要等過提示卡出來的那 2.6 秒才看得出來，一共好幾次；勾完還有慶祝、升級：機器忙的時候給多一點時間
  test.setTimeout(120000)
  await useAppMode(context)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  const ids = await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.clearSamples()
    for (const t of s.tasksOn(s.today)) s.deleteTask(t.id)
    const a = s.addTask({ title: '寫期末報告', date: s.today, priority: 3 })
    s.toggleStar(a.id)
    const b = s.addTask({ title: '整理筆記', date: s.today, priority: 3 })
    s.addSub(b.id, '把第三章的重點抄下來')
    const c = s.addTask({ title: '回信', date: s.today, priority: 2 })
    const d = s.addTask({ title: '買牛奶', date: s.today, priority: 1 })
    return { a: a.id, b: b.id, c: c.id, d: d.id }
  })
  const done = (id) => page.evaluate((id) => window.hiyori.store.toggleTask(id), id)
  const nexts = () => page.evaluate(() => (window.__toasts || []).filter((x) => x.includes('下一件')).length)
  // 不是排在最前面的那一件：不說
  await done(ids.d)
  await page.waitForTimeout(3200)
  expect(await nexts()).toBe(0)
  // 勾掉現在該做的那一件（本命）：慶祝之後提示卡寫下一件和下一步，ふじ說一聲
  await done(ids.a)
  const card = page.locator('#toasts .toast', { hasText: '下一件：整理筆記' })
  await expect(card).toContainText('下一步：把第三章的重點抄下來')
  await expect.poll(() => chatSaid(page, '整理筆記')).toBe(true)
  // ▶ 開始專注：開始專注那一件
  await card.getByRole('button', { name: '▶ 開始專注' }).click()
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.taskId)).toBe(ids.b)
  // 專注中勾掉的不說（專注那邊自己會接著問）
  await done(ids.b)
  await page.waitForTimeout(3200)
  expect(await nexts()).toBe(1)
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  // 20 分鐘內又勾掉現在該做的那一件：已經很順了，不吵
  await page.clock.setFixedTime(T('10:05:00'))
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.addTask({ title: '洗衣服', date: s.today, priority: 1 })
    s.addTask({ title: '寫週報', date: s.today, priority: 1 })
  })
  await done(ids.c)
  await page.waitForTimeout(3200)
  expect(await nexts()).toBe(1)
  // 過了 20 分鐘：又說
  await page.clock.setFixedTime(T('10:30:00'))
  const top = () => page.evaluate(() => {
    const s = window.hiyori.store
    return s.tasksOn(s.today).filter((t) => !t.done).map((t) => t.id)
  })
  const [first] = await top()
  await done(first)
  await expect.poll(nexts).toBe(2)
  // 今天剩下最後一件、勾掉了：沒有下一件，不說（過了 20 分鐘也一樣）
  await page.clock.setFixedTime(T('11:00:00'))
  const [last] = await top()
  await done(last)
  await page.waitForTimeout(3200)
  expect(await nexts()).toBe(2)
  // 設定裡關掉：不說
  await page.clock.setFixedTime(T('11:30:00'))
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.addTask({ title: '倒垃圾', date: s.today })
    s.addTask({ title: '澆花', date: s.today })
    window.hiyori.ui.setTab('settings')
  })
  // （勾了好幾件，可能剛好升級、「升級了」的視窗蓋在上面：直接送點擊）
  await page.locator('#nextBtn').dispatchEvent('click')
  await expect(page.locator('#nextBtn')).toHaveText('關')
  const [one] = await top()
  await done(one)
  await page.waitForTimeout(3200)
  expect(await nexts()).toBe(2)
})

test('做完一件，接著下一件（提示卡出來前的那一下子）：又取消了完成、關掉了提醒就不說（再勾一次照樣說）；排第二的移到明天了，說現在排第一的；專案裡的長期任務勾掉了不說', async ({ page, context, site }) => {
  test.setTimeout(120000)
  await useAppMode(context)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  const tmr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(T('12:00:00').getTime() + 86400000))
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  const ids = await page.evaluate(() => {
    const s = window.hiyori.store
    s.clearSamples()
    for (const t of s.tasksOn(s.today)) s.deleteTask(t.id)
    const a = s.addTask({ title: '寫期末報告', date: s.today, priority: 3 })
    const b = s.addTask({ title: '整理筆記', date: s.today, priority: 3 })
    const c = s.addTask({ title: '回信', date: s.today, priority: 2 })
    const d = s.addTask({ title: '買牛奶', date: s.today, priority: 1 })
    return { a: a.id, b: b.id, c: c.id, d: d.id }
  })
  const done = (id) => page.evaluate((id) => window.hiyori.store.toggleTask(id), id)
  const nexts = () => page.evaluate(() => (window.__toasts || []).filter((x) => x.includes('下一件')))
  // 勾掉現在該做的那一件，馬上又取消：不說
  await done(ids.a)
  await done(ids.a)
  await page.waitForTimeout(3200)
  expect(await nexts()).toEqual([])
  // 再勾一次：照樣說（剛才那次不算進「20 分鐘內只說一次」）
  await done(ids.a)
  await expect.poll(nexts).toEqual([expect.stringContaining('下一件：整理筆記')])
  // 20 分鐘後勾掉現在該做的那一件，提示卡出來前把排第二的（回信）移到明天：說現在排第一的那一件
  await page.clock.setFixedTime(T('10:30:00'))
  await done(ids.b)
  await page.evaluate(({ id, tmr }) => window.hiyori.store.updateTask(id, { date: tmr }), { id: ids.c, tmr })
  await expect.poll(async () => (await nexts()).length).toBe(2)
  expect((await nexts())[1]).toContain('下一件：買牛奶')
  // 再 20 分鐘：勾掉現在該做的那一件，提示卡出來前關掉這個提醒：不說
  await page.clock.setFixedTime(T('11:00:00'))
  await page.evaluate(() => window.hiyori.store.addTask({ title: '洗衣服', date: window.hiyori.store.today, priority: 1 }))
  await done(ids.d)
  await page.evaluate(() => window.hiyori.store.setSetting('nextNudge', false))
  await page.waitForTimeout(3200)
  expect(await nexts()).toHaveLength(2)
  // 打開回來；專案裡的長期任務（勾掉之前不在今天的清單上，不是「現在該做的那一件」）勾掉了：不說
  await page.clock.setFixedTime(T('11:30:00'))
  const long = await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('nextNudge', true)
    const p = s.addProject({ name: '畢業專題' })
    return s.addTask({ title: '讀論文', project: p.id, ongoing: true, priority: 3 }).id
  })
  await done(long)
  await page.waitForTimeout(3200)
  expect(await nexts()).toHaveLength(2)
})

test('建議類的提示：打字中先不說、停下來再說；兩則至少隔 20 分鐘、一天最多 6 則；「現在該做」同時只留一張；晚上回顧和上週的回顧卡放在總覽上、不再自己跳出來；設定裡的四個總開關', async ({ page, context, site }) => {
  test.setTimeout(180000)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await context.addInitScript(({ ymd }) => {
    Object.defineProperty(Document.prototype, 'hidden', { get: () => !!window.__hidden, configurable: true })
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => (window.__hidden ? 'hidden' : 'visible'), configurable: true })
    if (!localStorage.getItem('hiyori-daily-v1')) {
      const tasks = [
        { id: 'e2e-b1', title: '寫期末報告', priority: 3, date: ymd, star: true },
        { id: 'e2e-b2', title: '整理筆記', priority: 3, date: ymd },
        { id: 'e2e-b3', title: '回信', priority: 1, date: ymd },
      ]
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, settings: {} }))
      // 今天的摘要看過了
      localStorage.setItem('hiyori-brief-day', JSON.stringify(ymd))
    }
  }, { ymd })
  await useAppMode(context)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  const away = async (from, to) => {
    await page.clock.setFixedTime(T(from))
    await page.evaluate(() => {
      window.__hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.setFixedTime(T(to))
    await page.evaluate(() => {
      window.__hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }
  const seen = (t) => page.evaluate((t) => (window.__toasts || []).filter((x) => x.includes(t)).length, t)
  const shown = (t) => page.locator('#toasts .toast:not(.out)', { hasText: t })
  const done = (id) => page.evaluate((id) => window.hiyori.store.toggleTask(id), id)
  const log = (v) => page.evaluate((v) => localStorage.setItem('hiyori-suggest', JSON.stringify(v)), v)

  // 打字打到一半時回來：先不說；打完（框空了、離開輸入框）就說
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await page.locator('#taskTitle').fill('買')
  await away('10:00:00', '10:30:00')
  await page.waitForTimeout(2000)
  expect(await seen('歡迎回來')).toBe(0)
  await page.locator('#taskTitle').fill('')
  await page.evaluate(() => document.activeElement.blur())
  await expect(shown('歡迎回來')).toContainText('現在該做：寫期末報告')

  // 20 分鐘內：勾掉現在該做的那一件，不說下一件；過了 20 分鐘再勾，說
  await page.clock.setFixedTime(T('10:31:00'))
  await done('e2e-b1')
  await page.waitForTimeout(3200)
  expect(await seen('下一件')).toBe(0)
  await page.clock.setFixedTime(T('10:51:00'))
  await done('e2e-b2')
  await expect(shown('下一件：回信')).toBeVisible()
  // 警語到點：寫著「現在該做」的只留一張（下一件那張收起來）
  await page.evaluate(() => window.hiyori.reminders.onRemind({ text: '手機放遠一點', at: Date.now() }, 0, 'motto'))
  await expect(shown('手機放遠一點')).toContainText('現在該做：回信')
  await expect(shown('下一件')).toHaveCount(0)

  // 今天已經說了 6 則：離開夠久回來也不說
  await log({ day: ymd, n: 6, at: T('09:00:00').getTime() })
  await away('12:05:00', '12:35:00')
  await page.waitForTimeout(2000)
  expect(await seen('歡迎回來')).toBe(1)
  await log({ day: ymd, n: 0, at: 0 })

  // 設定的「通知與提醒」：時間到的提醒關掉，日程到點不說；打開照常
  await page.evaluate(() => window.hiyori.ui.setTab('settings'))
  await expect(page.locator('#alertT')).toBeVisible()
  const remind = page.locator('#remindOnBtn')
  await expect(remind).toHaveText('開')
  await remind.click()
  await expect(remind).toHaveText('關')
  const ring = () => page.evaluate(() => window.hiyori.reminders.onRemind({ id: 'e2e-ev', title: '和老師開會', start: '12:50' }, 10, 'event'))
  await ring()
  await page.waitForTimeout(500)
  expect(await seen('和老師開會')).toBe(0)
  await remind.click()
  await ring()
  await expect(shown('和老師開會')).toBeVisible()
  // 建議和鼓勵關掉：回來了也不說；「更多」裡一項一項的開關淡一點、照樣改得了
  const nudge = page.locator('#nudgeOnBtn')
  await nudge.click()
  await expect(nudge).toHaveText('關')
  await expect(page.locator('#nudgeMore')).toHaveClass(/muted/)
  await away('14:05:00', '14:35:00')
  await page.waitForTimeout(2000)
  expect(await seen('歡迎回來')).toBe(1)
  await page.evaluate(() => window.hiyori.ui.setTab('settings'))
  await nudge.click()
  await expect(nudge).toHaveText('開')
  // 警語關掉：三樣都關；打開時放回原本的樣子
  const motto = page.locator('#mottoOnBtn')
  await page.evaluate(() => Object.assign(window.hiyori.store.state.settings, { mottoEvery: 30, catMotto: 10, mottoBar: true }))
  await page.evaluate(() => window.hiyori.ui.renderSettings())
  await expect(motto).toHaveText('開')
  await motto.click()
  await expect(motto).toHaveText('關')
  const mottoSet = () => page.evaluate(() => (({ mottoEvery, catMotto, mottoBar }) => [mottoEvery, catMotto, mottoBar])(window.hiyori.store.state.settings))
  expect(await mottoSet()).toEqual([0, 0, false])
  await motto.click()
  expect(await mottoSet()).toEqual([30, 10, true])

  // 晚上 9 點後還沒回顧：不跳出回顧的視窗，總覽的今日反思排到「現在」下面，提示卡問一聲。
  // 頁面在背景時過了 9 點：不說、不算問過（看得到了再說）
  await page.evaluate(() => window.hiyori.ui.setTab('today'))
  await page.clock.setFixedTime(T('20:55:00'))
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    window.__hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.setFixedTime(T('21:05:00'))
  await page.waitForTimeout(2500)
  expect(await seen('今天過得怎麼樣')).toBe(0)
  expect(await page.evaluate(() => localStorage.getItem('hiyori-review-asked'))).not.toBe(ymd)
  await page.evaluate(() => {
    window.__hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.setFixedTime(T('21:30:00'))
  const ask = shown('今天過得怎麼樣')
  await expect(ask).toBeVisible()
  await expect(page.locator('#reviewModal')).toBeHidden()
  const order = () => page.evaluate(() => [...document.querySelectorAll('#todayRoot .td-grid > section')].slice(0, 2).map((x) => x.className.match(/td-(nowc|ref|top)/)?.[1]))
  await expect.poll(order).toEqual(['nowc', 'ref'])
  // 「寫回顧」：焦點放在今日反思的天氣上
  await ask.locator('.toast-act', { hasText: '寫回顧' }).click()
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('td-mood'))).toBe(true)
  // 今日反思上的「之後再說」：放回原本的位置
  await page.locator('#todayRoot [data-act="review-later"]').click()
  await expect.poll(order).toEqual(['nowc', 'top'])

  // 新的一週、上週有在用：總覽上放上週的回顧卡，提示卡說一聲（不自己打開回顧卡的視窗）
  await page.evaluate(() => {
    const s = window.hiyori.store
    const t = new Date(s.today + 'T00:00:00')
    const mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7) - 7)
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    Object.assign(s.day(ymd(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 1))), { tasks: 3, focus: 50 })
    s.state.weekCard = ''
    s.save()
  })
  await page.clock.setFixedTime(T('21:55:00'))
  const week = shown('上週的回顧卡好了')
  await expect(week).toBeVisible()
  await expect(page.locator('#weekModal')).toBeHidden()
  const card = page.locator('#todayRoot .td-weekc')
  await expect(card).toContainText('3 朵花綻放')
  // 總覽上的「收起來」：卡和提示卡一起收（不留一張按了會再打開的提示卡）
  await card.locator('[data-act="week-seen"]').click()
  await expect(card).toHaveCount(0)
  await expect(week).toHaveCount(0)
  // 再放回來：「看看」打開回顧卡的視窗，關掉也收起來
  await page.evaluate(() => {
    window.hiyori.store.state.weekCard = ''
    window.hiyori.ui.today.render()
  })
  await card.locator('[data-act="week-open"]').click()
  await expect(page.locator('#weekModal')).toBeVisible()
  await page.locator('#weekClose').click()
  await expect(card).toHaveCount(0)
})

test('專注頁的鍵盤：有按鈕的提示卡用 Tab 轉得到（在第一顆按 Shift+Tab 就到）、焦點在上面時不收；收掉、換成新的一張、按了之後，焦點交回剛才的地方；「先記下來」按 Esc 焦點到旁邊的「記下」；Dock 上的時間指向專注頁', async ({ page, context, site }) => {
  // 步驟多：同時跑很多個測試、機器很忙時光是打開頁面就可能要一分多鐘
  test.setTimeout(150000)
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    window.hiyori.ui.focus.toggle()
  })
  const full = page.locator('#focusFull')
  const time = page.locator('#focusTime')
  const min = page.locator('#ffMin')
  await expect(full).toBeVisible()
  await expect(time).toHaveAttribute('aria-controls', 'focusFull')
  await expect(time).toHaveAttribute('aria-expanded', 'true')
  // 「先記下來」：按 N 打開那一行，Esc 放開——焦點到旁邊的「記下」，專注頁還開著
  await expect(min).toBeFocused()
  await page.keyboard.press('n')
  await expect(page.locator('#ffParkText')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('#ffPark button[type="submit"]')).toBeFocused()
  await expect(full).toBeVisible()
  // 有按鈕的提示卡：在專注頁的第一顆按 Shift+Tab 就到它的最後一顆；焦點在上面時過了平常該收的時間也還在
  const show = (label) => page.evaluate((label) => window.hiyori.ui.toast({ icon: '測', title: '測試的提示卡', tag: 'e2e', actions: [{ label, run: () => (window.__ran = label) }, { label: '等等', soft: true, run: () => {} }] }), label)
  const card = page.locator('#toasts .toast', { hasText: '測試的提示卡' })
  await min.focus()
  await show('好')
  await expect(card).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  await expect(card.getByRole('button', { name: '等等' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(card.getByRole('button', { name: '好' })).toBeFocused()
  await page.waitForTimeout(4000)
  await expect(card).toBeVisible()
  // 同一類的換成新的一張：焦點接到新的那一張同一個位置的按鈕
  await show('知道了')
  await expect(card.getByRole('button', { name: '知道了' })).toBeFocused()
  // 收掉（例如回來了，限時去的那一張跟著收）：焦點交回進來之前的地方，不掉到頁面最外面
  await page.evaluate(() => window.hiyori.ui.dropToasts('e2e'))
  await expect(card).toHaveCount(0)
  await expect(min).toBeFocused()
  // 從專注頁的最後一顆按 Tab：接到提示卡；按了上面的按鈕（做的事沒有移動焦點），焦點也交回剛才的地方
  await show('好')
  await page.evaluate(() => {
    const sel = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ;[...document.querySelectorAll(`#focusFull :is(${sel})`)].filter((el) => el.getClientRects().length).at(-1).focus()
  })
  const last = await page.evaluate(() => document.activeElement.id || document.activeElement.textContent)
  await page.keyboard.press('Tab')
  await expect(card.getByRole('button', { name: '好' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__ran)).toBe('好')
  expect(await page.evaluate(() => document.activeElement.id || document.activeElement.textContent)).toBe(last)
  // 焦點在上面時換成新的一張、之後才移出去：照完整的時間倒數（不會被當成已經過了很久、一下子就收掉）
  await show('好')
  await page.keyboard.press('Tab')
  await expect(card.getByRole('button', { name: '好' })).toBeFocused()
  await page.waitForTimeout(800)
  await show('知道了')
  await expect(card.getByRole('button', { name: '知道了' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(card.getByRole('button', { name: '知道了' })).not.toBeFocused()
  await expect.poll(() => card.evaluate((el) => el.style.getPropertyValue('--from'))).toBe('1.000')
  await page.waitForTimeout(1600)
  await expect(card).toBeVisible()
  // 縮小專注頁：Dock 上的時間寫著收起來了
  await min.click()
  await expect(full).toBeHidden()
  await expect(time).toHaveAttribute('aria-expanded', 'false')
  // 對話框（這一版的新功能）比提示卡高一層：開著時提示卡在遮罩後面，Tab 只在對話框裡轉
  await page.evaluate(() => window.hiyori.ui.openNews())
  const news = page.locator('#newsModal')
  await expect(news).toBeVisible()
  await page.evaluate(() => {
    const sel = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ;[...document.querySelectorAll(`#newsModal :is(${sel})`)].filter((el) => el.getClientRects().length)[0].focus()
  })
  await page.keyboard.press('Shift+Tab')
  expect(await page.evaluate(() => document.getElementById('newsModal').contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(news).toBeHidden()
})

test('專注時的背景聲：計時設定、專注頁右上的耳機都可以選；只在專注中放，暫停、休息、結束時停；音效關著不放；Esc 先收選單', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await useAppMode(context)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const state = () => page.evaluate(() => window.hiyori.noise.state())
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    window.hiyori.ui.focus.toggleSet(true)
  })
  // 計時設定：預設關著；選雨聲（還沒開始，不放）
  const row = page.locator('#fsNoiseRow')
  await expect(row.getByRole('button', { name: '關' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#focusSet .noise-vol')).toBeHidden()
  await row.getByRole('button', { name: '雨聲' }).click()
  await expect(row.getByRole('button', { name: '雨聲' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#focusSet .noise-vol')).toBeVisible()
  expect(await state()).toMatchObject({ want: 'off', playing: 'off' })
  // 開始專注：放雨聲
  await page.locator('#fsStart').click()
  await expect.poll(state).toMatchObject({ want: 'rain', playing: 'rain', mine: true })
  // 專注頁右上的耳機：亮著；打開選單（焦點在選著的那一個），換成褐噪音、調音量（放開才存）
  const btn = page.locator('#ffNoiseBtn')
  await expect(btn).toHaveClass(/\bon\b/)
  await expect(btn).toHaveAttribute('aria-label', '背景聲：雨聲')
  await btn.click()
  const panel = page.locator('#ffNoise')
  await expect(panel).toBeVisible()
  await expect(btn).toHaveAttribute('aria-expanded', 'true')
  await expect(panel.getByRole('button', { name: '雨聲' })).toBeFocused()
  await panel.getByRole('button', { name: '褐噪音' }).click()
  await expect.poll(state).toMatchObject({ want: 'brown', playing: 'brown' })
  // 計時設定裡的那一組也跟著換（藏著的時候也一樣）
  await expect(page.locator('#fsNoiseRow [data-noise="brown"]')).toHaveAttribute('aria-pressed', 'true')
  await panel.locator('[data-noise-vol]').fill('80')
  await expect.poll(state).toMatchObject({ vol: 80 })
  await expect.poll(() => page.evaluate(() => window.hiyori.store.state.settings.noiseVol)).toBe(80)
  // 焦點還停在音量上（沒在拖）、別的地方改了音量：滑桿跟著變，下一次按方向鍵從新的接著調
  await panel.locator('[data-noise-vol]').focus()
  await page.evaluate(() => window.hiyori.store.setSetting('noiseVol', 30))
  await expect(panel.locator('[data-noise-vol]')).toHaveValue('30')
  await expect.poll(state).toMatchObject({ vol: 30 })
  await page.evaluate(() => window.hiyori.store.setSetting('noiseVol', 80))
  await expect(panel.locator('[data-noise-vol]')).toHaveValue('80')
  await expect(panel.locator('.noise-hint')).toHaveText('專注時放褐噪音，休息、暫停時會停')
  // Esc 先收選單、焦點回到耳機；專注頁還開著
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(btn).toBeFocused()
  await expect(page.locator('#focusFull')).toBeVisible()
  // 點選單外面也會收
  await btn.click()
  await expect(panel).toBeVisible()
  await page.locator('#ffTime').click()
  await expect(panel).toBeHidden()
  // 暫停：停；繼續：再放
  await page.locator('#ffToggle').click()
  await expect.poll(state).toMatchObject({ want: 'off', playing: 'off' })
  // 暫停中打開選單、用鍵盤縮小專注頁（沒有點到外面）：選單跟著收，再打開專注頁時不會還開著
  await btn.click()
  await expect(panel).toBeVisible()
  await page.locator('#ffMin').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#focusFull')).toBeHidden()
  await page.evaluate(() => window.hiyori.ui.focus.toggleBig(true))
  await expect(page.locator('#focusFull')).toBeVisible()
  await expect(panel).toBeHidden()
  await expect(btn).toHaveAttribute('aria-expanded', 'false')
  await page.locator('#ffToggle').click()
  await expect.poll(state).toMatchObject({ want: 'brown', playing: 'brown' })
  // 音效關著：不放，選單裡說一聲；打開音效又放
  await page.evaluate(() => window.hiyori.store.setSetting('sound', false))
  await expect.poll(state).toMatchObject({ want: 'off', playing: 'off' })
  await expect(btn).not.toHaveClass(/\bon\b/)
  await btn.click()
  await expect(panel.locator('.noise-hint')).toContainText('音效關著')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.hiyori.store.setSetting('sound', true))
  await expect.poll(state).toMatchObject({ want: 'brown', playing: 'brown' })
  // 到點、進到休息：停
  await page.clock.setFixedTime(T('10:25:01'))
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('break')
  await expect.poll(state).toMatchObject({ want: 'off', playing: 'off' })
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  // 重新整理之後設定還在
  await page.reload()
  await bootReady(page)
  expect(await page.evaluate(() => window.hiyori.store.state.settings)).toMatchObject({ focusNoise: 'brown', noiseVol: 80 })
})

test('提示卡一口氣來很多張：先收沒有按鈕的，有按鈕的留著來得及按；全都有按鈕時最多多留一張', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  const shown = () => page.locator('#toasts .toast:not(.out) b').allTextContents()
  await page.evaluate(() => {
    const ui = window.hiyori.ui
    ui.toast({ icon: '眠', title: '就寢時間快到了', ms: 12000, actions: [{ label: '挑明天的第一件', run() {} }] })
    for (let i = 1; i <= 4; i++) ui.toast({ icon: '花', title: `慶祝 ${i}`, ms: 9000 })
  })
  expect(await shown()).toEqual(['就寢時間快到了', '慶祝 3', '慶祝 4'])
  await page.evaluate(() => {
    for (let i = 1; i <= 4; i++) window.hiyori.ui.toast({ icon: '時', title: `到點 ${i}`, ms: 12000, actions: [{ label: '▶ 開始專注', run() {} }] })
  })
  expect(await shown()).toEqual(['到點 1', '到點 2', '到點 3', '到點 4'])
})

test('打勾的手感：列表不會整串重播淡入，做完的那件滑到後面；花瓣從勾爆開、App 模式冒出經驗值；今天全部做完時飄花瓣', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    const s = window.hiyori.store
    // 今天只留這三件：全部做完時才會飄花瓣
    for (const t of s.tasksOn(s.today)) s.deleteTask(t.id)
    for (const title of ['寫信給老師', '洗衣服', '讀一章小說']) s.addTask({ title, date: s.today })
    window.hiyori.ui.setTab('tasks')
  })
  const items = page.locator('#taskList .item')
  await expect(items).toHaveCount(3)
  // 升級的視窗會擋住下一個勾：出現就先關掉
  const closeModals = () => page.evaluate(() => document.querySelectorAll('.modal:not([hidden]) .btn-primary').forEach((b) => b.click()))
  const fadeUps = () => page.evaluate(() => document.getAnimations().filter((a) => a.animationName === 'fadeUp' && a.effect?.target?.closest?.('#taskList')).length)
  await expect.poll(fadeUps).toBe(3)

  // 特效放完一兩秒就拿掉：先請頁面記下出現過的（機器很忙時，測試可能來不及在它還在的時候看到）
  await page.evaluate(() => {
    window.__fx = []
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains('mo-burst') || n.classList?.contains('mo-float')) window.__fx.push(`${n.className}|${n.textContent}`)
    }).observe(document.body, { childList: true })
  })
  const fx = () => page.evaluate(() => window.__fx)
  const title = await items.first().locator('.item-title').textContent()
  await items.first().locator('.check').click()
  // 花瓣從勾爆開、經驗值冒出來
  await expect.poll(async () => (await fx()).filter((x) => x.startsWith('mo-burst')).length).toBe(1)
  await expect.poll(async () => (await fx()).some((x) => /^mo-float[^|]*\|\+\d+ XP$/.test(x))).toBe(true)
  // 打勾前就在的三件都不再重播淡入，做完的那件排到最後
  await expect(page.locator('#taskList .item.settled')).toHaveCount(3)
  expect(await fadeUps()).toBe(0)
  await expect(items.last().locator('.item-title')).toHaveText(title)
  // 放完就拿掉
  await expect(page.locator('.mo-burst, .mo-float')).toHaveCount(0, { timeout: 5000 })

  // 新加一件：只有它淡入
  await page.evaluate(() => window.hiyori.store.addTask({ title: '澆花', date: window.hiyori.store.today }))
  await expect(items).toHaveCount(4)
  expect(await fadeUps()).toBe(1)

  // 剩下的都做完：飄一陣花瓣，飄完拿掉
  for (let i = 0; i < 3; i++) {
    await closeModals()
    await page.locator('#taskList .item:not(.done) .check').first().click()
  }
  await expect(page.locator('.mo-rain')).toHaveCount(1, { timeout: 5000 })
  await expect(page.locator('.mo-rain')).toHaveCount(0, { timeout: 10000 })
})
test('手機往下捲時，右下角的番茄鐘膠囊讓開；往上捲一點、換分頁時回來', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  const body = page.locator('body')
  const dock = page.locator('.dock')
  await expect(dock).toHaveCSS('opacity', '1')
  // 開場畫面淡出、剛換分頁的那一下（還原捲動位置）都過了才開始捲
  await expect.poll(() => page.evaluate(() => document.querySelector('.panel-body').contains(document.elementFromPoint(200, 420))), { timeout: 30000 }).toBe(true)
  await page.waitForTimeout(300)
  await page.mouse.move(200, 420)
  await page.mouse.wheel(0, 500)
  await expect(body).toHaveClass(/dock-tuck/)
  await expect(dock).toHaveCSS('opacity', '0')
  // 讓開時按不到（點擊穿過去到下面的內容）
  await expect(dock).toHaveCSS('pointer-events', 'none')
  await page.mouse.wheel(0, -90)
  await expect(body).not.toHaveClass(/dock-tuck/)
  await expect(dock).toHaveCSS('opacity', '1')
  await page.mouse.wheel(0, 500)
  await expect(body).toHaveClass(/dock-tuck/)
  // 鍵盤 Tab 進去：先回來，不讓焦點停在看不見的按鈕上
  await page.locator('#captureBtn').focus()
  await expect(body).not.toHaveClass(/dock-tuck/)
  await page.locator('#captureBtn').blur()
  await page.mouse.wheel(0, 400)
  await expect(body).toHaveClass(/dock-tuck/)
  // 藏著的時候開始專注（F 鍵），再把全螢幕計時縮小：膠囊要回來，計時器按得到
  await page.evaluate(() => window.hiyori.ui.focus.toggle())
  await page.evaluate(() => window.hiyori.ui.focus.toggleBig(false))
  await expect(body).not.toHaveClass(/dock-tuck/)
  await expect(dock).toHaveCSS('opacity', '1')
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  // 縮小時焦點被放回 Dock 的按鈕上（這個測試沒有用滑鼠點過東西，瀏覽器當成鍵盤的焦點，Dock 會一直留著）：先移開
  await page.evaluate(() => document.activeElement?.blur())
  await page.mouse.wheel(0, 400)
  await expect(body).toHaveClass(/dock-tuck/)
  // 換分頁：回來；換回來還原捲動位置的那一下不算往下捲
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await expect(body).not.toHaveClass(/dock-tuck/)
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  await page.waitForTimeout(500)
  await expect(body).not.toHaveClass(/dock-tuck/)
})
test.describe('手機上的任務', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })
  test('任務列只留完成和專注，點任務打開編輯面板：截止日、本命、排進最近空檔（說排在哪、可以撤銷）；寫了時間的那一行可以改成有時段的任務；記下一件說一聲', async ({ page, context, site }) => {
    test.setTimeout(90000)
    await useAppMode(context)
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
    const tmr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(Date.parse(`${ymd}T12:00:00+08:00`) + 86400000))
    await page.clock.setFixedTime(new Date(`${ymd}T10:00:00+08:00`))
    await page.goto(site.url)
    await bootReady(page)
    const id = await page.evaluate(() => {
      const s = window.hiyori.store
      s.clearSamples()
      for (const t of s.tasksOn(s.today)) s.deleteTask(t.id)
      const t = s.addTask({ title: '寫報告', date: s.today, dur: 60 })
      window.hiyori.ui.setTab('tasks')
      return t.id
    })
    const task = () => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id), id)
    const row = page.locator(`#taskList .item[data-id="${id}"]`)
    // 只留完成圈和 ▶，點得到的範圍至少 40px
    await expect(row.locator('.item-actions .mini:visible')).toHaveCount(1)
    expect((await row.locator('[data-act="focus"]').boundingBox()).width).toBeGreaterThanOrEqual(40)
    // 點任務本身：打開編輯面板
    await row.locator('.item-title').click()
    const sheet = page.locator('#editSheet')
    await expect(sheet).toBeVisible()
    await sheet.locator('[name="due"]').fill(tmr)
    await sheet.locator('[data-star]').click()
    await sheet.locator('button[type="submit"]').click()
    await expect(sheet).toBeHidden()
    expect(await task()).toMatchObject({ due: tmr, star: true })
    // 排進最近空檔：提示卡說排在今天幾點，撤銷回到沒排的樣子
    await row.locator('.item-title').click()
    await sheet.locator('[data-ec="slot"]').click()
    const toast = page.locator('#toasts .toast', { hasText: '排在今天' })
    await expect(toast).toBeVisible()
    expect((await task()).at).toMatch(/^\d\d:\d\d$/)
    await toast.locator('.toast-act', { hasText: '撤銷' }).click()
    await expect.poll(async () => (await task()).at).toBe(null)
    // 排好之後又改了時段：舊的撤銷不蓋掉新的
    await row.locator('.item-title').click()
    await sheet.locator('[data-ec="slot"]').click()
    const again = page.locator('#toasts .toast:not(.out)', { hasText: '排在今天' })
    await expect(again).toBeVisible()
    await page.evaluate((id) => window.hiyori.store.scheduleTask(id, '20:00'), id)
    await again.locator('.toast-act', { hasText: '撤銷' }).click()
    await expect(page.locator('#toasts .toast', { hasText: '排好之後又改過了' })).toBeVisible()
    expect((await task()).at).toBe('20:00')
    // 面板開著時別處改了名稱：這邊只改截止日，名稱不會被蓋回去
    await row.locator('.item-title').click()
    await expect(sheet).toBeVisible()
    await page.evaluate((id) => window.hiyori.store.updateTask(id, { title: '寫期末報告' }), id)
    await sheet.locator('[name="due"]').fill('')
    await sheet.locator('button[type="submit"]').click()
    expect(await task()).toMatchObject({ title: '寫期末報告', due: null })
    // 草稿：長度改成 2 小時，「分成幾段」跟著出現；名稱清空時按工具不動、面板留著
    await row.locator('.item-title').click()
    await expect(sheet.locator('[data-ec="split"]')).toBeHidden()
    await sheet.locator('[name="dur"]').selectOption('120')
    await expect(sheet.locator('[data-ec="split"]')).toBeVisible()
    await sheet.locator('[name="title"]').fill('')
    await sheet.locator('[data-ec="split"]').click()
    await expect(sheet).toBeVisible()
    expect(await page.evaluate(() => window.hiyori.store.state.tasks.filter((t) => t.title.includes('報告')).length)).toBe(1)
    await sheet.locator('[data-ec="cancel"]').click()
    // 快速記錄：「明天 15:00 牙醫」預設是日程，點「改成任務」記成明天 15:00 的任務（一小時）
    await page.locator('#captureBtn').click()
    const input = page.locator('#capInput')
    await input.fill('明天 15:00 牙醫')
    const swap = page.locator('#capPreview [data-swap]')
    await expect(swap).toHaveText('改成任務')
    await swap.click()
    await expect(page.locator('#capPreview')).toContainText('任務・15:00')
    await expect(input).toBeFocused()
    const events = await page.evaluate(() => window.hiyori.store.state.events.length)
    await input.press('Enter')
    await expect.poll(() => page.evaluate(() => window.hiyori.store.state.tasks.find((t) => t.title === '牙醫'))).toMatchObject({ date: tmr, at: '15:00', dur: 60 })
    expect(await page.evaluate(() => window.hiyori.store.state.events.length)).toBe(events)
    // 下一行回到預設（日程）；跨過半夜的改成任務照原本的長度（兩小時）
    await input.fill('後天 9:00 開會')
    await expect(swap).toHaveText('改成任務')
    await input.fill('明天 23:00-01:00 趕報告')
    await swap.click()
    await input.press('Enter')
    await expect.poll(() => page.evaluate(() => window.hiyori.store.state.tasks.find((t) => t.title === '趕報告'))).toMatchObject({ date: tmr, at: '23:00', dur: 120 })
    // 記下的日程之後改了名：「復原」留著現在的樣子、說一聲，清單上不寫「已復原」
    await input.fill('後天 10:00 看牙醫')
    await input.press('Enter')
    await expect.poll(() => page.evaluate(() => window.hiyori.store.state.events.some((x) => x.title === '看牙醫'))).toBe(true)
    await page.evaluate(() => {
      const s = window.hiyori.store
      const e = s.state.events.find((x) => x.title === '看牙醫')
      s.updateEvent(e.id, { title: '看牙醫（二樓）' })
    })
    const undoEv = page.locator('.cap-undo[aria-label="復原：看牙醫"]')
    await undoEv.click()
    await expect(page.locator('#toasts .toast', { hasText: '記下之後又改過了' })).toBeVisible()
    await expect(undoEv).toHaveCount(0)
    expect(await page.evaluate(() => window.hiyori.store.state.events.some((x) => x.title === '看牙醫（二樓）'))).toBe(true)
    await input.fill('')
    await page.keyboard.press('Escape')
    // 任務頁的輸入框記下一件：提示卡說記下了，可以撤銷
    await page.locator('#taskTitle').fill('買牛奶')
    await page.locator('#taskTitle').press('Enter')
    const added = page.locator('#toasts .toast', { hasText: '記下了「買牛奶」' })
    await expect(added).toBeVisible()
    await added.locator('.toast-act', { hasText: '撤銷' }).click()
    await expect.poll(() => page.evaluate(() => window.hiyori.store.state.tasks.some((t) => t.title === '買牛奶'))).toBe(false)
  })
  test('編輯日程只存改過的欄位：打開之後別處改了名稱、備註，這裡只切成整天，名稱和備註留著別處改的', async ({ page, context, site }) => {
    await useAppMode(context)
    await page.goto(site.url)
    await bootReady(page)
    const id = await page.evaluate(() => {
      const s = window.hiyori.store
      window.hiyori.ui.setTab('schedule')
      const e = s.addEvent({ title: '牙醫', date: s.today, start: '15:00', end: '16:00', color: 0 })
      window.hiyori.ui.schedule.openEdit('event', e.id)
      return e.id
    })
    const sheet = page.locator('#editSheet')
    await expect(sheet).toBeVisible()
    // 另一台改的（同步進來）
    await page.evaluate((id) => window.hiyori.store.updateEvent(id, { title: '牙醫（改到二樓）', note: '帶健保卡' }), id)
    await sheet.locator('[data-allday]').click()
    await sheet.locator('button[type="submit"]').click()
    await expect(sheet).toBeHidden()
    const got = await page.evaluate((id) => window.hiyori.store.state.events.find((e) => e.id === id), id)
    expect(got).toMatchObject({ title: '牙醫（改到二樓）', note: '帶健保卡', allDay: true })
  })
})
test.describe('手機的觸控', () => {
  test.use({ hasTouch: true, viewport: { width: 393, height: 852 } })
  test('任務列左右滑：往右滑完成、往左滑明天再做（可以復原）、逾期的往左滑移到今天；滑一點點會彈回去', async ({ page, context, site }) => {
    await useAppMode(context)
    await page.goto(site.url)
    await bootReady(page)
    await page.evaluate(() => {
      const s = window.hiyori.store
      // 勾掉現在該做的那一件時「下一件：…」的提示卡（有按鈕、接得到手指）不出來：機器忙的時候它可能剛好蓋在要滑的那一列上
      s.setSetting('nextNudge', false)
      for (const t of s.tasksOn(s.today)) s.deleteTask(t.id)
      for (const title of ['寫信給老師', '洗衣服', '讀一章小說']) s.addTask({ title, date: s.today })
      const y = new Date(Date.now() - 86400000)
      s.addTask({ title: '昨天沒做的', date: `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}` })
      window.hiyori.ui.setTab('tasks')
    })
    await expect.poll(() => page.evaluate(() => document.querySelector('.panel-body').contains(document.elementFromPoint(200, 420))), { timeout: 30000 }).toBe(true)
    // 第一次在任務頁看到任務：提一下可以左右滑
    await expect(page.locator('#toasts')).toContainText('任務可以左右滑')
    const cdp = await context.newCDPSession(page)
    const swipe = async (title, dx) => {
      // 有按鈕的提示卡接得到手指（也可以左右滑掉）：先收掉，手指才會落在那一列上
      await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()))
      const row = page.locator('.item', { hasText: title }).first()
      await row.scrollIntoViewIfNeeded()
      const b = await row.boundingBox()
      const x = b.x + b.width / 2
      const y = b.y + b.height / 2
      // 照真人的速度滑、放開前停一下：一瞬間滑完的話 Chrome 會當成甩動，下一下點擊會被拿去停住甩動
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let i = 1; i <= 12; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 12, y }] })
        await page.waitForTimeout(16)
      }
      await page.waitForTimeout(80)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const task = (title) => page.evaluate((title) => window.hiyori.store.state.tasks.find((t) => t.title === title), title)
    const today = await page.evaluate(() => window.hiyori.store.today)

    // 往右滑：完成，花瓣從那一列的勾爆開（花瓣一秒就拿掉：請頁面記下出現過的）
    await page.evaluate(() => {
      window.__bursts = 0
      new MutationObserver((list) => {
        for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains('mo-burst')) window.__bursts++
      }).observe(document.body, { childList: true })
    })
    await swipe('寫信給老師', 170)
    await expect.poll(async () => (await task('寫信給老師')).done).toBe(true)
    await expect.poll(() => page.evaluate(() => window.__bursts)).toBe(1)
    await expect(page.locator('.item.sw')).toHaveCount(0)

    // 滑一點點：彈回去，什麼都不做；彈回去之後馬上點勾照樣算數（不會被當成滑動補的那一下吃掉）
    await swipe('洗衣服', 45)
    expect(await task('洗衣服')).toMatchObject({ done: false, date: today })
    await page.locator('#taskList .item', { hasText: '洗衣服' }).locator('.check').tap()
    await expect.poll(async () => (await task('洗衣服')).done).toBe(true)
    await expect(page.locator('.item.sw')).toHaveCount(0)
    await page.locator('#taskList .item', { hasText: '洗衣服' }).locator('.check').tap()
    await expect.poll(async () => (await task('洗衣服')).done).toBe(false)

    // 往左滑：明天再做；提示卡上可以復原
    await swipe('洗衣服', -170)
    await expect.poll(async () => (await task('洗衣服')).date).not.toBe(today)
    await expect(page.locator('#taskList .item', { hasText: '洗衣服' })).toHaveCount(0)
    await page.locator('.toast-act', { hasText: '復原' }).click()
    await expect.poll(async () => (await task('洗衣服')).date).toBe(today)
    await expect(page.locator('#taskList .item', { hasText: '洗衣服' })).toHaveCount(1)

    // 逾期的往左滑：移到今天
    await swipe('昨天沒做的', -170)
    await expect.poll(async () => (await task('昨天沒做的')).date).toBe(today)

    // 做完的往右滑：還沒做完
    await swipe('寫信給老師', 170)
    await expect.poll(async () => (await task('寫信給老師')).done).toBe(false)

    // 滑到一半整串被重畫（同步、別的分頁、計時器）：這一次作罷，之後照樣滑得動
    await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()))
    const row = page.locator('#taskList .item', { hasText: '讀一章小說' })
    const b = await row.boundingBox()
    const x = b.x + b.width / 2
    const y = b.y + b.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 14, y }] })
      await page.waitForTimeout(16)
    }
    await page.evaluate(() => window.hiyori.ui.renderTasks())
    for (let i = 7; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 14, y: y + 200 }] })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    expect((await task('讀一章小說')).done).toBe(false)
    await swipe('讀一章小說', 170)
    await expect.poll(async () => (await task('讀一章小說')).done).toBe(true)
  })
  test('觸感回饋：打勾時手機輕震一下、選滿本命時震兩下；設定裡可以關掉（只改這台裝置），打開時震一下', async ({ page, context, site }) => {
    await useAppMode(context)
    // 記下叫了幾次 vibrate、用什麼節奏（測試的瀏覽器不會真的震）
    await page.addInitScript(() => {
      window.__buzz = []
      Object.defineProperty(Navigator.prototype, 'vibrate', { value: (p) => (window.__buzz.push(p), true), configurable: true })
    })
    await page.goto(site.url)
    await bootReady(page)
    await page.evaluate(() => {
      const s = window.hiyori.store
      for (const t of s.tasksOn(s.today)) s.deleteTask(t.id)
      for (const title of ['一', '二', '三', '四', '五']) s.addTask({ title, date: s.today })
      window.hiyori.ui.setTab('tasks')
    })
    await expect.poll(() => page.evaluate(() => document.querySelector('.panel-body').contains(document.elementFromPoint(200, 420))), { timeout: 30000 }).toBe(true)
    const buzz = () => page.evaluate(() => window.__buzz)
    const row = (title) => page.locator('#taskList .item', { hasText: title }).first()
    await row('一').locator('.check').tap()
    await expect.poll(buzz).toEqual([14])
    // 本命已經選滿三件：再選第四件時震兩下（選到的那三下各輕震一下）
    await page.evaluate(() => {
      const s = window.hiyori.store
      window.__buzz.length = 0
      for (const t of s.tasksOn(s.today).filter((x) => !x.done).slice(0, 3)) s.toggleStar(t.id)
    })
    // 手機上本命在編輯面板裡：點任務打開、點「★ 本命」、存下來
    await row('五').locator('.item-title').tap()
    await page.locator('#editSheet [data-star]').tap()
    await page.locator('#editSheet button[type="submit"]').tap()
    await expect.poll(buzz).toEqual([8, 8, 8, [24, 50, 24]])

    // 設定裡關掉：打勾不再震；這台裝置記住了，重新整理也一樣
    await page.evaluate(() => window.hiyori.ui.setTab('settings'))
    const btn = page.locator('#hapticBtn')
    await expect(page.locator('#hapticRow')).toBeVisible()
    await expect(btn).toHaveText('開')
    await btn.tap()
    await expect(btn).toHaveText('關')
    await page.evaluate(() => (window.__buzz.length = 0))
    await page.reload()
    await bootReady(page)
    await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
    await expect.poll(() => page.evaluate(() => document.querySelector('.panel-body').contains(document.elementFromPoint(200, 420))), { timeout: 30000 }).toBe(true)
    await row('二').locator('.check').tap()
    await expect.poll(() => page.evaluate(() => window.hiyori.store.state.tasks.find((t) => t.title === '二').done)).toBe(true)
    await page.waitForTimeout(300)
    expect(await buzz()).toEqual([])
    // 再打開：馬上震一下
    await page.evaluate(() => window.hiyori.ui.setTab('settings'))
    await btn.tap()
    await expect(btn).toHaveText('開')
    await expect.poll(buzz).toEqual([14])

    // 多輪番茄鐘：休息結束、自動接著下一輪時，只震「休息結束」那一段（下一輪開始的輕震不會把它截斷）
    await page.evaluate(() => {
      window.__buzz.length = 0
      const f = window.hiyori.ui.focus
      Object.assign(f, { mode: 'break', round: 1, rounds: 2, paused: null, endAt: Date.now() - 10 })
      f.tick()
    })
    await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
    expect(await buzz()).toEqual([[40, 90, 40, 90, 70]])
  })
  test('提示卡：手指從按鈕上按下去、往下滑（瀏覽器拿去捲動）再放開，照樣接著倒數、時間到就收', async ({ page, context, site }) => {
    await useAppMode(context)
    await page.goto(site.url)
    await bootReady(page)
    // 開場的載入畫面拿掉了（它還蓋著的話手指按不到提示卡）
    await page.waitForFunction(() => !document.getElementById('loader'), null, { timeout: 30000 })
    await expect(page.locator('#toasts .toast')).toHaveCount(0, { timeout: 15000 })
    await page.evaluate(() => {
      window.__ptr = []
      for (const t of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(t, (e) => window.__ptr.push(e.type), true)
      window.hiyori.ui.toast({ icon: '試', title: '有按鈕的提示', ms: 4000, actions: [{ label: '好', run: () => (window.__ran = true) }] })
    })
    const card = page.locator('#toasts .toast', { hasText: '有按鈕的提示' })
    const btn = card.locator('.toast-act')
    // 開場畫面讓開、手指真的按得到按鈕。位置每次重新量：進場的動畫、上面多出一張提示卡（例如每日任務達成）時按鈕會挪
    let x = 0
    let y = 0
    await expect
      .poll(async () => {
        const b = await btn.boundingBox()
        if (!b) return false
        x = b.x + b.width / 2
        y = b.y + b.height / 2
        return page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.toast-act'), [x, y])
      })
      .toBe(true)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await expect(card).toHaveClass(/held/)
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + i * 18 }] })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const seen = await page.evaluate(() => window.__ptr)
    expect(seen[0]).toBe('pointerdown')
    expect(seen.some((t) => t === 'pointercancel' || t === 'pointerup')).toBe(true)
    // 放開了：接著倒數，時間到就收；按鈕沒有被按到。
    // （瀏覽器拿去捲動的那一下就接著倒數了：電腦忙、後面幾下滑動送得慢時，看的時候可能已經收掉，收掉也算放開了）
    await expect.poll(() => card.evaluateAll((els) => els.some((el) => el.classList.contains('held')))).toBe(false)
    await expect(card).toHaveCount(0, { timeout: 8000 })
    expect(await page.evaluate(() => window.__ran)).toBeFalsy()
  })
  test('按下去縮一下：手指按著才縮；剛用手指點過、接著換成鍵盤按住空白鍵就不縮', async ({ page, context, site }) => {
    await useAppMode(context)
    await page.goto(site.url)
    await bootReady(page)
    await page.evaluate(() => window.hiyori.ui.setTab('settings'))
    const btn = page.locator('#fontPick button[data-v="1"]')
    await btn.scrollIntoViewIfNeeded()
    await expect.poll(() => btn.evaluate((b) => {
      const r = b.getBoundingClientRect()
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b
    }), { timeout: 30000 }).toBe(true)
    const scale = () => btn.evaluate((b) => getComputedStyle(b).scale)
    const input = () => page.evaluate(() => document.documentElement.dataset.input)
    await btn.tap()
    expect(await input()).toBe('touch')
    // 手指按著的樣子：縮一點（無頭瀏覽器模擬的觸控不會有 :active，用開發者工具把它設成按著）
    const cdp = await context.newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument')
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fontPick button[data-v="1"]' })
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] })
    await expect.poll(scale).toBe('0.94')
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
    await expect.poll(scale).toBe('none')
    // 換成鍵盤：焦點在同一顆、按住空白鍵（按著時是 :active，但這一下不是手指）
    await btn.focus()
    await page.keyboard.down(' ')
    expect(await input()).toBe('key')
    expect(await btn.evaluate((b) => b.matches(':active'))).toBe(true)
    expect(await scale()).toBe('none')
    await page.keyboard.up(' ')
  })
})
test('番茄鐘自己到點時，經驗值不會從剛點的別的東西冒出來', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    window.hiyori.ui.focus.toggle()
    window.hiyori.ui.focus.toggleBig(false)
    window.hiyori.ui.setTab('tasks')
  })
  // 開場畫面讓開、輸入框真的點得到了，才開始倒數（不然點下去的時候早就到點了，測不到）
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector('#taskTitle')
        const r = el.getBoundingClientRect()
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el
      }),
    )
    .toBe(true)
  // 到點前剛好點了任務的輸入框：到點的經驗值不是它給的，不要從那裡冒出來。
  // 點完馬上讓計時器自己到點（不靠等：機器很忙時點下去可能已經過了到點的時間）
  await page.locator('#taskTitle').click()
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.endAt = Date.now() - 1
    f.tick()
  })
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('break')
  expect(await page.evaluate(() => window.hiyori.store.stats.pomodoros)).toBe(1)
  await page.waitForTimeout(600)
  await expect(page.locator('.mo-float')).toHaveCount(0)
})
test('提示卡：同時最多三張，多的從最舊的收；有按鈕的游標停著時不收，離開後接著倒數', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await expect(page.locator('#toasts .toast')).toHaveCount(0, { timeout: 15000 })
  // 都留得夠久：測試的機器很忙時，檢查到之前不會自己先到時間
  await page.evaluate(() => {
    const ui = window.hiyori.ui
    ui.toast({ icon: '一', title: '第一張', ms: 30000 })
    ui.toast({ icon: '二', title: '第二張', ms: 6000, actions: [{ label: '好', run: () => {} }] })
    // 游標一放上去就停住（直接發事件：不用等滑鼠移過去）
    document.querySelector('#toasts .toast.has-act').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    ui.toast({ icon: '三', title: '第三張', ms: 30000 })
    ui.toast({ icon: '四', title: '第四張', ms: 30000 })
  })
  await expect(page.locator('#toasts .toast:not(.out)')).toHaveCount(3)
  await expect(page.locator('#toasts .toast', { hasText: '第一張' })).toHaveCount(0)
  // 留得久的有一條倒數的細線；停住的時候不收
  const second = page.locator('#toasts .toast', { hasText: '第二張' })
  await expect(second).toHaveClass(/timed/)
  await expect(second).toHaveClass(/held/)
  await page.waitForTimeout(7000)
  await expect(second).toBeVisible()
  // 游標離開：接著倒數，時間到就收
  await second.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })))
  await expect(second).not.toHaveClass(/held/)
  await expect(second).toHaveCount(0, { timeout: 10000 })
})
test('分頁列選到的那一格墊的膠囊會滑過去、停在選到的那一格；換到後一天時任務從右邊滑進來', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto(site.url)
  await bootReady(page)
  const ink = page.locator('#panel .tabs .tab-ink')
  await expect(ink).toBeVisible()
  const gap = (tab) =>
    page.evaluate((tab) => {
      const a = document.querySelector('#panel .tabs .tab-ink').getBoundingClientRect()
      const b = document.querySelector(`.tab[data-tab="${tab}"]`).getBoundingClientRect()
      return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width)
    }, tab)
  for (const tab of ['habits', 'tasks', 'records']) {
    await page.locator(`.tab[data-tab="${tab}"]`).click()
    await expect.poll(() => gap(tab)).toBeLessThan(2)
  }
  // 電腦的側欄也一樣
  await page.setViewportSize({ width: 1400, height: 860 })
  await expect.poll(() => gap('records')).toBeLessThan(2)
  // 滑鼠在分頁的邊緣按住一下再原地放開：照樣換過去（滑鼠按著時按鈕不縮小，放開的地方不會落到按鈕外面）
  const edge = await page.locator('.tab[data-tab="habits"]').boundingBox()
  await page.mouse.move(edge.x + 2, edge.y + edge.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(200)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.tab)).toBe('habits')
  await page.locator('.tab[data-tab="tasks"]').click()
  await expect.poll(() => gap('tasks')).toBeLessThan(2)

  // 換到後一天：新的那一頁從右邊滑進來（淡入的位移換成水平的）
  await page.evaluate(() => window.hiyori.store.addTask({ title: '明天的事', date: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })() }))
  // 位移只留 0.7 秒：請頁面記下設過的值（機器很忙時，按完再回頭問可能已經拿掉了）
  await page.evaluate(() => {
    window.__enter = []
    const b = document.querySelector('.panel-body')
    new MutationObserver(() => window.__enter.push(b.style.getPropertyValue('--enter-x'))).observe(b, { attributes: true, attributeFilter: ['style'] })
  })
  const seen = () => page.evaluate(() => window.__enter)
  await page.locator('#nextDay').click()
  await expect.poll(seen).toContain('22px')
  await expect(page.locator('#taskList .item', { hasText: '明天的事' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.querySelector('.panel-body').style.getPropertyValue('--enter-x'))).toBe('')
  await page.locator('#prevDay').click()
  await expect.poll(seen).toContain('-22px')
})
test('今日總覽的進度：做完幾件時百分比從原本的數字一路走到新的', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    const s = window.hiyori.store
    for (const t of s.tasksOn(s.today)) s.deleteTask(t.id)
    for (const title of ['一', '二', '三', '四']) s.addTask({ title, date: s.today })
    window.hiyori.ui.setTab('today')
  })
  const pct = page.locator('.td-ring b')
  await expect(pct).toHaveText('0%')
  // CI 的機器用軟體算圖，一秒只畫得出兩三格畫面（時間戳也走得比真的慢）：畫面更新改成每 16ms 一次，
  // 數字照真的時間走，中間的每一格都看得到（不然 0.9 秒裡可能只畫出一兩格）
  await page.evaluate(() => {
    let id = 0
    const timers = new Map()
    window.requestAnimationFrame = (cb) => {
      const i = ++id
      timers.set(i, setTimeout(() => (timers.delete(i), cb(performance.now())), 16))
      return i
    }
    window.cancelAnimationFrame = (i) => {
      clearTimeout(timers.get(i))
      timers.delete(i)
    }
  })
  // 數字每變一次就記下來（走到 50% 為止，最多 6 秒）：要看到中間的數字，不是一下子跳到 50%；也不會往反方向閃。
  // 看的是畫面上每一次改寫（不是每隔一格畫面抽一次：電腦忙的時候抽樣的那一格可能剛好錯過）
  const seen = page.evaluate(
    () =>
      new Promise((done) => {
        const read = () => document.querySelector('.td-ring b')?.textContent
        const vals = new Set([read()])
        let timer = 0
        const mo = new MutationObserver(() => {
          const v = read()
          vals.add(v)
          if (v !== '50%') return
          mo.disconnect()
          clearTimeout(timer)
          done([...vals])
        })
        mo.observe(document.querySelector('#todayRoot'), { subtree: true, childList: true, characterData: true })
        timer = setTimeout(() => {
          mo.disconnect()
          done([...vals])
        }, 6000)
      }),
  )
  await page.evaluate(() => {
    const s = window.hiyori.store
    const [a, b] = s.tasksOn(s.today)
    s.toggleTask(a.id)
    s.toggleTask(b.id)
  })
  const vals = await seen
  expect(vals).toContain('50%')
  expect(vals.filter((v) => v !== '0%' && v !== '50%').length).toBeGreaterThan(1)
  expect(vals.filter((v) => v?.startsWith('-'))).toEqual([])
  await expect(pct).toHaveText('50%')

  // 走到一半整頁又重畫了（接著又有變動）：從走到的數字接著走，不會先跳到終點
  const mid = await page.evaluate(async () => {
    const s = window.hiyori.store
    const num = () => parseInt(document.querySelector('.td-ring b').textContent, 10)
    s.toggleTask(s.tasksOn(s.today).find((t) => !t.done).id)
    // 等數字開始走（離開 50%；電腦忙的時候第一格畫面會晚一點）
    const t0 = performance.now()
    while (num() <= 50 && performance.now() - t0 < 3000) await new Promise((r) => requestAnimationFrame(r))
    const before = num()
    window.hiyori.ui.today.render()
    return { before, after: num() }
  })
  expect(mid.before).toBeGreaterThan(50)
  expect(mid.before).toBeLessThan(75)
  expect(mid.after).toBe(mid.before)
  await expect(pct).toHaveText('75%')
})
test('手機的 App 模式：捲到最底時最後一張卡片在分頁列和番茄鐘膠囊上面；紀錄頁最上面那一排跟著捲動亮起現在那一段；分頁列上的件數變了會跳一下', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    const s = window.hiyori.store
    for (const t of s.tasksOn(s.today)) s.deleteTask(t.id)
    for (let i = 1; i <= 14; i++) s.addTask({ title: `第 ${i} 件`, date: s.today })
    window.hiyori.ui.setTab('tasks')
  })
  // 捲到最底：內容的最下緣在膠囊和分頁列上面
  const gap = await page.evaluate(async () => {
    const b = document.querySelector('.panel-body')
    b.scrollTop = b.scrollHeight
    await new Promise((r) => setTimeout(r, 400))
    const bottom = Math.max(...[...b.querySelectorAll('.tab-page.active *')].filter((x) => x.getClientRects().length).map((x) => x.getBoundingClientRect().bottom))
    return { bottom, tabs: document.querySelector('#panel .tabs').getBoundingClientRect().top, dock: document.querySelector('.dock').getBoundingClientRect().top }
  })
  expect(gap.bottom).toBeLessThanOrEqual(gap.tabs)
  expect(gap.bottom).toBeLessThanOrEqual(gap.dock + 1)
  // 教練的輸入列黏在膠囊上面一點（不會因為底下留了空間，就浮到畫面中間蓋住問卷）
  await page.evaluate(() => window.hiyori.ui.setTab('coach'))
  await expect(page.locator('.coach-say')).toBeVisible()
  const say = await page.evaluate(() => ({ say: document.querySelector('.coach-say').getBoundingClientRect().bottom, dock: document.querySelector('.dock').getBoundingClientRect().top }))
  expect(say.say).toBeLessThanOrEqual(say.dock)
  expect(say.say).toBeGreaterThan(say.dock - 80)
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))

  // 分頁列「任務」上的件數：做完一件，數字變了輕輕跳一下
  await expect(page.locator('#tnTasks')).toHaveText('14')
  const popped = await page.evaluate(() => {
    const s = window.hiyori.store
    s.toggleTask(s.tasksOn(s.today)[0].id)
    return new Promise((r) => queueMicrotask(() => setTimeout(() => r(document.getElementById('tnTasks').getAnimations().length), 0)))
  })
  await expect(page.locator('#tnTasks')).toHaveText('13')
  expect(popped).toBeGreaterThan(0)

  // 紀錄頁：最上面是第一段，捲到「睡眠」亮睡眠，捲到底亮設定（設定那格有個小圖示）
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  const on = page.locator('#recNav button.on')
  await expect(on).toHaveCount(1)
  await page.evaluate(() => {
    const b = document.querySelector('.panel-body')
    const h = [...document.querySelectorAll('[data-page="records"] h3.sec-title')].find((x) => x.textContent.includes('睡眠'))
    b.scrollTop += h.getBoundingClientRect().top - 140
  })
  await expect(on).toHaveText('睡眠')
  await expect(on).toHaveAttribute('aria-current', 'location')
  await page.evaluate(() => {
    const b = document.querySelector('.panel-body')
    b.scrollTop = b.scrollHeight
  })
  await expect(on).toHaveText('設定')
  await expect(page.locator('#recNav button.set svg')).toHaveCount(1)
  // 資料一變紀錄頁會重畫：段落沒變時跳轉列不重建，鍵盤焦點留在原本那一格
  const kept = await page.evaluate(async () => {
    const b = document.querySelector('#recNav button.on')
    b.focus()
    window.hiyori.store.addTask({ title: '重畫一下', date: window.hiyori.store.today })
    await new Promise((r) => setTimeout(r, 100))
    return b.isConnected && document.activeElement === b
  })
  expect(kept).toBe(true)

  // 看別天時的「回到今天」：在日期列左邊的同一列，整顆按得到（以前掉到下面、被內容蓋住）
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await page.locator('#nextDay').click()
  const chip = page.locator('#todayBtn')
  await expect(chip).toBeVisible()
  expect(await chip.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el && document.elementFromPoint(r.left + 4, r.bottom - 4) === el
  })).toBe(true)
  await chip.click()
  await expect(chip).toBeHidden()
  expect(await page.evaluate(() => window.hiyori.store.selectedDate === window.hiyori.store.today)).toBe(true)
})
test('手機的 App 模式：用鍵盤移到下面的按鈕時停在輸入列和分頁列上面；橫放時日期列和「回到今天」在最上面一條、按得到', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto(site.url)
  await bootReady(page)
  const shown = (loc) => loc.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return e === el || el.contains(e)
  })
  // 教練頁最下面的選項：捲到最上面再用鍵盤移過去，停在黏在下面的輸入列（和分頁列）上面
  await page.evaluate(() => window.hiyori.ui.setTab('coach'))
  await expect(page.locator('#coachRoot .coach')).toBeVisible({ timeout: 20000 })
  const last = page.locator('#coachRoot button[data-v="90"]')
  await page.evaluate(() => (document.querySelector('.panel-body').scrollTop = 0))
  expect(await shown(last)).toBe(false)
  await last.focus()
  await expect.poll(() => shown(last)).toBe(true)
  expect(await last.evaluate((el) => el.getBoundingClientRect().bottom <= document.querySelector('.coach-say').getBoundingClientRect().top)).toBe(true)

  // 橫放：問候那一列不放，日期列留在最上面；內容從它下面開始（以前整個被內容蓋住，換不了日期）
  await page.setViewportSize({ width: 740, height: 360 })
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  const next = page.locator('#nextDay')
  await expect.poll(() => shown(next), { timeout: 30000 }).toBe(true)
  await next.click()
  const back = page.locator('#todayBtn')
  await expect(back).toBeVisible()
  expect(await shown(back)).toBe(true)
  expect(await shown(page.locator('#taskTitle'))).toBe(true)
  await back.click()
  await expect(back).toBeHidden()
  expect(await page.evaluate(() => window.hiyori.store.selectedDate === window.hiyori.store.today)).toBe(true)
  // 提示卡在畫面正中間（小島模式橫放時右邊是面板，才放在左邊空間的中間）
  await page.evaluate(() => window.hiyori.ui.toast({ icon: '試', title: '橫放的提示卡', ms: 6000 }))
  const mid = await page.locator('#toasts .toast', { hasText: '橫放的提示卡' }).evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.left + r.width / 2
  })
  expect(Math.abs(mid - 370)).toBeLessThan(4)
  // 總覽那一頁自己有日期：日期列藏起來，整頁往上用
  await page.evaluate(() => window.hiyori.ui.setTab('today'))
  expect(await page.evaluate(() => Math.round(document.querySelector('#panel').getBoundingClientRect().top))).toBe(0)
})
test('用上面的輸入框加任務：看得到的那件亮一下；排到看不到的地方時輸入框下面冒「剛加的在下面」，點了捲過去', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    const s = window.hiyori.store
    for (const t of s.tasksOn(s.today)) s.deleteTask(t.id)
    for (const t of s.overdue()) s.deleteTask(t.id)
    window.hiyori.ui.setTab('tasks')
  })
  await expect.poll(() => page.evaluate(() => document.querySelector('.panel-body').contains(document.elementFromPoint(200, 420))), { timeout: 30000 }).toBe(true)
  const input = page.locator('#taskTitle')
  const hint = page.locator('#addedHint')
  // 哪幾列亮過一下（亮 1.6 秒就收：電腦忙的時候等看的時候已經亮完了，所以在亮的那一下記下來）
  await page.evaluate(() => {
    window.__glows = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (kf, opt) {
      if (this.matches?.('.item') && Array.isArray(kf) && kf.some((k) => k.backgroundColor)) window.__glows.push(this.textContent)
      return animate.call(this, kf, opt)
    }
  })
  const glowed = (title) => page.evaluate((t) => window.__glows.some((x) => x.includes(t)), title)
  // 清單還短：加了就看得到，那一列亮一下，不用膠囊
  await input.fill('澆花')
  await input.press('Enter')
  const first = page.locator('#taskList .item', { hasText: '澆花' })
  await expect(first).toBeVisible()
  await expect.poll(() => glowed('澆花')).toBe(true)
  await expect(hint).toBeHidden()

  // 清單很長、新的一件排到下面去了：輸入框還在原地（可以接著打），下面冒膠囊；點了捲過去
  await page.evaluate(() => {
    const s = window.hiyori.store
    for (let i = 1; i <= 12; i++) s.addTask({ title: `重要的第 ${i} 件`, date: s.today, priority: 3 })
    document.querySelector('.panel-body').scrollTop = 0
  })
  await input.fill('買花盆')
  await input.press('Enter')
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('買花盆')
  await expect(input).toBeFocused()
  await hint.click()
  await expect(hint).toBeHidden()
  await expect.poll(() => page.evaluate(() => {
    const s = window.hiyori.store
    const t = s.tasksOn(s.today).find((x) => x.title === '買花盆')
    return window.hiyori.ui._inView(document.querySelector(`#taskList .item[data-id="${t.id}"]`))
  })).toBe(true)
  await expect.poll(() => glowed('買花盆')).toBe(true)
})
test.describe('還沒下載好的畫面', () => {
  // Service Worker 接管頁面後會直接從快取給程式，繞過下面的閘門：這個測試不開
  test.use({ serviceWorkers: 'block' })
  test('第一次打開還沒下載好的畫面：教練先放閃著的底，下載超過一下下時提示卡說正在打開，載好就收掉', async ({ page, context, site }) => {
    await useAppMode(context)
    // 教練的程式先卡住不給（網路慢、剛打開就點），看完載入中的樣子再放行
    let release
    const gate = new Promise((r) => (release = r))
    await page.route(/\/assets\/coach-[^/]*\.js$/, async (route) => {
      await gate
      await route.continue()
    })
    await page.goto(site.url)
    await bootReady(page)
    await page.evaluate(() => window.hiyori.ui.setTab('coach'))
    await expect(page.locator('#coachRoot .lz-skel')).toBeVisible()
    const busy = page.locator('#toasts .toast.busy', { hasText: '正在打開' })
    await expect(busy).toBeVisible()
    release()
    await expect(page.locator('#coachRoot .coach')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('#coachRoot .lz-skel')).toHaveCount(0)
    await expect(busy).toHaveCount(0)
  })
  test('離線時教練沒下載到：不再一直閃著準備中，說「這一頁還沒下載到」；連上網路按「再試一次」就打開', async ({ page, context, site }) => {
    await useAppMode(context)
    // 教練的程式先卡住，切成離線後才讓它失敗（連著網路時失敗，會當成部署了新版去重新整理）
    let fail
    const gate = new Promise((r) => (fail = r))
    let blocked = true
    await page.route(/\/assets\/coach-[^/]*\.js$/, async (route) => {
      if (!blocked) return route.continue()
      await gate
      await route.abort('internetdisconnected')
    })
    await page.goto(site.url)
    await bootReady(page)
    await page.evaluate(() => window.hiyori.ui.setTab('coach'))
    await expect(page.locator('#coachRoot .lz-skel')).toBeVisible()
    await context.setOffline(true)
    fail()
    const box = page.locator('#coachRoot .lz-fail')
    await expect(box).toBeVisible({ timeout: 15000 })
    await expect(box).toContainText('這一頁還沒下載到')
    await expect(page.locator('#coachRoot .lz-skel')).toHaveCount(0)
    await expect(page.locator('#toasts .toast.busy')).toHaveCount(0)
    // 連上網路再按一次：放回準備中的底，載好就換成教練
    await context.setOffline(false)
    blocked = false
    await box.getByRole('button', { name: '再試一次' }).click()
    await expect(page.locator('#coachRoot .coach')).toBeVisible({ timeout: 20000 })
    await expect(box).toHaveCount(0)
  })
})
test('提示卡：先用鍵盤移到按鈕上、再用滑鼠按另一顆拖出去放開，照樣接著倒數；停過的倒數細線從停住的地方接著縮', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await expect(page.locator('#toasts .toast')).toHaveCount(0, { timeout: 15000 })
  // 開場畫面完全收掉了才開始（不然滑鼠移過去碰不到提示卡，提示卡先到時間）
  await expect
    .poll(() =>
      page.evaluate(() => {
        const l = document.getElementById('loader')
        return !l || getComputedStyle(l).visibility === 'hidden'
      }),
    )
    .toBe(true)
  // 用鍵盤移進來：停住（放上來和移進去在同一步，機器很忙時也不會先到時間）
  await page.keyboard.press('Shift')
  await page.evaluate(() => {
    // 留久一點：機器很忙時，下面拖滑鼠的那幾步就要好幾秒（測的是停住、接著倒數，不是幾秒）
    window.hiyori.ui.toast({ icon: '試', title: '兩顆按鈕', ms: 12000, actions: [{ label: '甲', run: () => (window.__ran = 1) }, { label: '乙', run: () => (window.__ran = 2) }] })
    const el = [...document.querySelectorAll('#toasts .toast')].find((x) => x.textContent.includes('兩顆按鈕'))
    el.querySelector('.toast-act').focus()
  })
  const card = page.locator('#toasts .toast', { hasText: '兩顆按鈕' })
  expect(await card.evaluate((el) => !!el.querySelector(':focus-visible'))).toBe(true)
  await expect(card).toHaveClass(/held/)
  const second = card.locator('.toast-act', { hasText: '乙' })
  const b = await second.boundingBox()
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  // 滑鼠按另一顆、拖出去放開（不算按到）：焦點換成滑鼠的、游標也離開了，接著倒數
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 300, { steps: 6 })
  await page.mouse.up()
  await expect(card).not.toHaveClass(/held/)
  await expect(card).toHaveCount(0, { timeout: 16000 })
  expect(await page.evaluate(() => window.__ran)).toBeFalsy()

  // 有倒數細線的：停一下再走，細線從停住的地方、照剩下的時間縮到 0
  const bar = await page.evaluate(async () => {
    window.hiyori.ui.toast({ icon: '試', title: '有細線', ms: 30000, actions: [{ label: '好', run: () => {} }] })
    const el = [...document.querySelectorAll('#toasts .toast')].find((x) => x.textContent.includes('有細線'))
    await new Promise((r) => setTimeout(r, 300))
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    return { timed: el.classList.contains('timed'), from: +el.style.getPropertyValue('--from'), life: parseInt(el.style.getPropertyValue('--life'), 10) }
  })
  expect(bar.timed).toBe(true)
  expect(bar.from).toBeGreaterThan(0.95)
  expect(bar.from).toBeLessThan(1)
  expect(bar.life).toBeGreaterThan(28000)
  expect(bar.life).toBeLessThan(29800)
})

test('Android 殼：警語排好整串交給手機（App 關著也照時間通知）；看著 App 時頁面自己念，提示卡寫現在該做', async ({ page, context, site }) => {
  // 步驟多：機器忙（好幾個測試一起用軟體算圖）的時候會超過一分鐘
  test.setTimeout(120000)
  // 台北今天上午 9:59:30 打開 App（醒著的時間）；上一則警語排在 9:45，開好之後到了 10:00 輪到下一則。
  // （開場還沒好時不提醒：機器忙的時候開場很久，提示卡在測試看到之前就收掉了）
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T10:00:00+08:00`)
  await context.addInitScript(({ t, ymd }) => {
    // 假的 Android 殼：記下每一次交給手機的那一串
    window.__mottos = []
    window.__handled = 0
    window.HiyoriNative = {
      version: () => 2, canNotify: () => true, canLive: () => false, askNotify() {}, timer() {}, notify() {},
      mottos: (json) => window.__mottos.push(json),
      // 念到哪一則：頁面要念之前先 claim（手機就不發）
      mottoHandled: () => window.__handled,
      mottoClaim: (at) => (at > window.__handled ? ((window.__handled = at), true) : false),
      foreground: () => true,
    }
    // 打開之前就有一句警語（每 15 分鐘）、今天的本命「寫期末報告」，開著系統通知；上一則排在 9:45。
    // 開機時就要有警語：沒有的話，記著的「上一則」會被當成停過，加了警語才從那時開始算
    if (!localStorage.getItem('hiyori-daily-v1')) {
      const tasks = [{ id: 'e2e-t1', title: '寫期末報告', priority: 3, date: ymd, star: true }]
      const mottos = [{ id: 'e2e-m1', text: '先做最重要的那一件', on: true, createdAt: t - 86400000 }]
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, mottos, settings: { notify: true, mottoEvery: 15 } }))
    }
    if (!localStorage.getItem('hiyori-motto-at')) localStorage.setItem('hiyori-motto-at', JSON.stringify({ at: t - 15 * 60000, i: 0 }))
  }, { t: T, ymd })
  // 打開通知時順便訂閱推播：不連到真的伺服器
  await context.route('**/v1/push/**', (route) => route.fulfill({ json: { key: 'BAAA', ok: true }, headers: { 'Access-Control-Allow-Origin': '*' } }))
  await useAppMode(context)
  await page.clock.setFixedTime(new Date(T - 30000))
  await page.goto(site.url)
  await bootReady(page)
  await page.clock.setFixedTime(new Date(T))
  // 看著 App：頁面自己念（手機那時在前面不發），提示卡上寫現在該做的那一件，按一下就開始專注
  const toast = page.locator('#toasts .toast', { hasText: '先做最重要的那一件' })
  await expect(toast).toBeVisible()
  // 焦點先放在「先停 1 小時」上：提示卡先不收（下面先檢查提示卡和交給手機的那一串，機器忙的時候會超過提示卡的 12 秒）
  await toast.locator('.toast-act', { hasText: '先停 1 小時' }).focus()
  await expect(toast).toContainText('現在該做：寫期末報告')
  await expect(toast.locator('.toast-act')).toHaveText(['▶ 開始專注', '只做 5 分鐘', '✓ 在做了', '先停 1 小時'])
  // 回神紀錄：提醒了一次
  expect(await page.evaluate(() => window.hiyori.store.peekDay(window.hiyori.store.today).nudges)).toBe(1)
  // 頁面念之前跟手機說了：10:00 那一則手機不會再發
  expect(await page.evaluate(() => window.__handled)).toBe(T)
  // 交給手機的那一串：從 10:15 起每 15 分鐘一則，排到明天就寢；通知上也寫著現在該做的那一件
  const plan = async () => {
    const last = await page.evaluate(() => window.__mottos.at(-1))
    return last ? JSON.parse(last).items : null
  }
  await expect.poll(async () => (await plan())?.[0]?.at).toBe(T + 15 * 60000)
  const items = await plan()
  expect(items[1].at - items[0].at).toBe(15 * 60000)
  expect(items.length).toBeGreaterThan(60)
  // focus：有現在該做的那一件，手機的通知上多一顆「▶ 開始專注」
  expect(items[0]).toEqual({ at: T + 15 * 60000, title: 'ひより · 給自己的警語', body: '先做最重要的那一件\n現在該做：寫期末報告', focus: true })
  // 開會、吃飯時：提示卡上按「先停 1 小時」。停著的那一小時手機上也不排，11:00 起照常
  await toast.locator('.toast-act', { hasText: '先停 1 小時' }).click()
  const paused = page.locator('#toasts .toast', { hasText: '警語先停到 11:00' })
  await expect(paused).toBeVisible()
  await expect(paused).toContainText('下一句 11:00')
  await expect.poll(async () => (await plan())?.[0]?.at).toBe(T + 60 * 60000)
  // 紀錄頁的警語卡：寫著 App 關著也會通知、停到幾點；按「現在就恢復」又照原本的間隔排回去
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  await expect(page.locator('#mottoRoot .mt-reach')).toContainText('App 關著、手機鎖著也會照時間通知')
  await expect(page.locator('#mottoRoot .mt-pause')).toContainText('先停到 11:00')
  await page.locator('#mottoRoot [data-act="resume"]').click()
  await expect(page.locator('#mottoRoot .mt-pause')).toContainText('先停一下')
  await expect(page.locator('#mottoRoot [data-act="pause"][data-v="hour"]')).toBeFocused()
  await expect.poll(async () => (await plan())?.[0]?.at).toBe(T + 15 * 60000)
  // 到日程頁關掉系統通知：手機上排著的取消；回到紀錄頁，卡片上請你打開
  await page.evaluate(() => window.hiyori.ui.setTab('schedule'))
  await page.locator('#notifyBtn').click()
  await expect.poll(() => page.evaluate(() => window.__mottos.at(-1))).toBe('')
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  await expect(page.locator('#mottoRoot .mt-reach')).toContainText('打開系統通知後')
  // 卡片上直接打開：又排回手機上
  await page.locator('#mottoRoot .mt-reach [data-act="notify"]').click()
  await expect(page.locator('#mottoRoot .mt-reach')).toContainText('App 關著、手機鎖著也會照時間通知')
  await expect.poll(async () => (await plan())?.length ?? 0).toBeGreaterThan(60)
})

test('日程中先不提醒：開會那一段到點的警語不交給手機、看著 App 時也不念；警語卡上寫著現在是哪一場、可以關掉', async ({ page, context, site }) => {
  test.setTimeout(120000)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T10:00:00+08:00`)
  await context.addInitScript(({ t, ymd }) => {
    window.__mottos = []
    window.__handled = 0
    window.HiyoriNative = {
      version: () => 3, canNotify: () => true, canLive: () => false, askNotify() {}, timer() {}, notify() {},
      mottos: (json) => window.__mottos.push(json),
      mottoHandled: () => window.__handled,
      mottoClaim: (at) => (at > window.__handled ? ((window.__handled = at), true) : false),
      foreground: () => true, mottoSeen() {}, takeAct: () => '',
    }
    if (!localStorage.getItem('hiyori-daily-v1')) {
      const tasks = [{ id: 'e2e-t1', title: '寫期末報告', priority: 3, date: ymd, star: true }]
      const mottos = [{ id: 'e2e-m1', text: '先做最重要的那一件', on: true, createdAt: t - 86400000 }]
      // 10:20～11:00 開會
      const events = [{ id: 'e2e-e1', title: '組會', date: ymd, start: '10:20', end: '11:00', color: 0, done: false }]
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, events, player: {}, mottos, settings: { notify: true, mottoEvery: 15, remindLead: -1 } }))
    }
    if (!localStorage.getItem('hiyori-motto-at')) localStorage.setItem('hiyori-motto-at', JSON.stringify({ at: t - 15 * 60000, i: 0 }))
  }, { t: T, ymd })
  await useAppMode(context)
  await page.clock.setFixedTime(new Date(T - 30000))
  await page.goto(site.url)
  await bootReady(page)
  await page.clock.setFixedTime(new Date(T))
  const plan = async () => {
    const last = await page.evaluate(() => window.__mottos.at(-1))
    return last ? JSON.parse(last).items.map((x) => (x.at - T) / 60000) : []
  }
  // 10:00 那一則照常念；交給手機的那一串跳過 10:30、10:45（開會中），11:00 照常
  await expect(page.locator('#toasts .toast', { hasText: '先做最重要的那一件' })).toBeVisible()
  await expect.poll(async () => (await plan()).slice(0, 3)).toEqual([15, 60, 75])
  // 警語卡：寫著日程中不打擾；開會時寫現在是哪一場
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  await expect(page.locator('#mottoRoot .mt-events')).toContainText('日程中先不提醒')
  await page.clock.setFixedTime(new Date(T + 30 * 60000 + 5000))
  await page.evaluate(() => window.hiyori.ui.dropToasts('motto'))
  // 看著 App、開會中到點的 10:30 那一則：不念（回神紀錄也不算）
  await page.waitForTimeout(2000)
  await expect(page.locator('#toasts .toast', { hasText: '先做最重要的那一件' })).toHaveCount(0)
  expect(await page.evaluate(() => window.hiyori.store.peekDay(window.hiyori.store.today).nudges)).toBe(1)
  await page.evaluate(() => window.hiyori.ui.renderRecords())
  await expect(page.locator('#mottoRoot .mt-events')).toContainText('現在是「組會」（到 11:00）')
  // 關掉：開會中也照常排（10:45 那一則回到交給手機的那一串裡）
  await page.locator('#mottoRoot [data-act="events"]').click()
  await expect(page.locator('#mottoRoot [data-act="events"]')).toHaveText('關')
  await expect.poll(async () => (await plan())[0]).toBe(45)
})

test('排定的任務到點：提示卡上直接開始專注、只做 5 分鐘或晚 15 分鐘（卡片留了一陣子才按，從現在算）；提前提醒時也可以先開始；專注別件時可以換成這件；時間在別處改過的卡片不蓋回去', async ({ page, context, site }) => {
  test.setTimeout(120000)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T10:20:00+08:00`)
  const min = (n) => new Date(T + n * 60000)
  await context.addInitScript(({ ymd }) => {
    if (!localStorage.getItem('hiyori-daily-v1')) {
      const tasks = [
        // 拆成了小步驟：到點的提示卡寫著從哪一步開始
        { id: 'e2e-a', title: '寫期末報告', priority: 3, date: ymd, at: '10:30', dur: 50, subs: [{ id: 'e2e-a1', title: '列出三個重點', done: false }] },
        { id: 'e2e-b', title: '回覆老師的信', priority: 2, date: ymd, at: '10:55', dur: 15 },
      ]
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, settings: { remindLead: 10 } }))
    }
  }, { ymd })
  await useAppMode(context)
  await page.clock.setFixedTime(min(-0.5))
  await page.goto(site.url)
  await bootReady(page)
  const taskAt = (id) => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id).at, id)
  // 10:20：提前 10 分鐘的那一次，想先開始也可以
  await page.clock.setFixedTime(min(0))
  const early = page.locator('#toasts .toast', { hasText: '10 分鐘後開始（10:30）' })
  await expect(early).toContainText('寫期末報告')
  await expect(early.locator('.toast-act')).toHaveText(['▶ 現在就開始'])
  // 10:30：到了開始的時間，提示卡上直接開始專注、只做 5 分鐘，或晚 15 分鐘
  await page.clock.setFixedTime(min(10))
  const start = page.locator('#toasts .toast', { hasText: '排在 10:30' })
  await expect(start).toContainText('先做「列出三個重點」')
  await expect(start.locator('.toast-act')).toHaveText(['▶ 開始專注', '只做 5 分鐘', '晚 15 分鐘'])
  // 卡片留到 10:33 才按「晚 15 分鐘」：從現在起再過 15 分鐘（10:48），不會改到已經過去的 10:45
  await page.clock.setFixedTime(min(13))
  await start.locator('.toast-act', { hasText: '晚 15 分鐘' }).click()
  await expect.poll(() => taskAt('e2e-a')).toBe('10:48')
  await expect(page.locator('#toasts .toast', { hasText: '改到 10:48' })).toBeVisible()
  // 10:38：新的時間也照樣提前提醒；按「▶ 現在就開始」
  await page.clock.setFixedTime(min(18))
  const again = page.locator('#toasts .toast', { hasText: '10 分鐘後開始（10:48）' })
  await again.locator('.toast-act', { hasText: '▶ 現在就開始' }).click()
  await expect.poll(() => page.evaluate(() => [window.hiyori.ui.focus.mode, window.hiyori.ui.focus.task?.title])).toEqual(['focus', '寫期末報告'])
  // 10:48：已經在專注這一件，到了開始的時間也不吵（檢查過了：開始的那一次記下了，但沒有提示卡）
  await page.clock.setFixedTime(min(28))
  await expect.poll(() => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('hiyori-reminded') || '{}')))).toContain('e2e-a@10:48!')
  await expect(page.locator('#toasts .toast', { hasText: '排在 10:48' })).toHaveCount(0)
  // 10:55：專注中到了另一件的時間：可以換成這件，或晚 15 分鐘再提醒
  await page.clock.setFixedTime(min(35))
  const next = page.locator('#toasts .toast', { hasText: '排在 10:55' })
  await expect(next).toContainText('現在正在專注別件')
  await expect(next.locator('.toast-act')).toHaveText(['換成這件', '晚 15 分鐘'])
  // 卡片還在的時候，這件的時間在別處（另一個分頁）改成 11:20：按「晚 15 分鐘」不會拿卡片上的 10:55 蓋回去
  await page.evaluate(() => window.hiyori.store.updateTask('e2e-b', { at: '11:20' }))
  await next.locator('.toast-act', { hasText: '晚 15 分鐘' }).click()
  await expect(page.locator('#toasts .toast', { hasText: '的時間已經改過了' })).toContainText('現在排在 11:20')
  expect(await taskAt('e2e-b')).toBe('11:20')
})

test('排定的任務時間到了：還沒做完就問一聲（寫著下一件），再 15 分鐘到新的時間再問，做完了就勾掉；正在專注這一件不吵', async ({ page, context, site }) => {
  test.setTimeout(120000)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hm) => new Date(`${ymd}T${hm}:00+08:00`)
  await context.addInitScript(({ ymd }) => {
    if (!localStorage.getItem('hiyori-daily-v1')) {
      const tasks = [
        { id: 'e2e-a', title: '寫期末報告', priority: 3, date: ymd, at: '10:00', dur: 30 },
        { id: 'e2e-b', title: '回覆老師的信', priority: 2, date: ymd, at: '11:00', dur: 15 },
      ]
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, settings: { remindLead: 10 } }))
    }
  }, { ymd })
  await useAppMode(context)
  await page.clock.setFixedTime(T('10:29'))
  await page.goto(site.url)
  await bootReady(page)
  const task = (id) => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id), id)
  // 10:30：排的時間到了，寫著下一件
  await page.clock.setFixedTime(T('10:30'))
  const end = page.locator('#toasts .toast', { hasText: '「寫期末報告」排的時間到了' })
  await expect(end).toContainText('下一件：11:00 回覆老師的信')
  await expect(end.locator('.toast-act')).toHaveText(['✓ 做完了', '再 15 分鐘', '明天再做'])
  // 再 15 分鐘：預估變 45 分鐘，10:45 再問一次
  await end.locator('.toast-act', { hasText: '再 15 分鐘' }).click()
  await expect.poll(async () => (await task('e2e-a')).dur).toBe(45)
  await toastSeen(page, '排到 10:45')
  await page.clock.setFixedTime(T('10:45'))
  const again = page.locator('#toasts .toast', { hasText: '「寫期末報告」排的時間到了' })
  await again.locator('.toast-act', { hasText: '✓ 做完了' }).click()
  await expect.poll(async () => (await task('e2e-a')).done).toBe(true)
  // 正在專注這一件：時間到了也不吵（到點時專注那邊會問）
  await page.evaluate(() => window.hiyori.ui.focus.startWith('e2e-b'))
  await page.clock.setFixedTime(T('11:15'))
  await expect.poll(() => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('hiyori-reminded') || '{}')))).toContain('e2e-b@11:00~15')
  await expect(page.locator('#toasts .toast', { hasText: '「回覆老師的信」排的時間到了' })).toHaveCount(0)
})

test('排的時間到了：昨晚開始、過了午夜才結束的那件也問，「明天再做」挪到今天算的明天；預估快到 10 小時只加到 600 分鐘，到了就不再給「再 15 分鐘」', async ({ page, context, site }) => {
  test.setTimeout(120000)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const shift = (d, n) => {
    const x = new Date(`${d}T12:00:00Z`)
    x.setUTCDate(x.getUTCDate() + n)
    return x.toISOString().slice(0, 10)
  }
  const T = (hm) => new Date(`${ymd}T${hm}:00+08:00`)
  await context.addInitScript(({ yday, ymd }) => {
    if (!localStorage.getItem('hiyori-daily-v1')) {
      const tasks = [
        { id: 'e2e-n', title: '趕期末作業', priority: 2, date: yday, at: '23:30', dur: 60 },
        { id: 'e2e-l', title: '整理房間', priority: 1, date: ymd, at: '00:40', dur: 595 },
      ]
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, settings: { remindLead: 10 } }))
    }
  }, { yday: shift(ymd, -1), ymd })
  await useAppMode(context)
  await page.clock.setFixedTime(T('00:29'))
  await page.goto(site.url)
  await bootReady(page)
  const task = (id) => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id), id)
  // 昨天 23:30 開始 60 分鐘：今天 00:30 問
  await page.clock.setFixedTime(T('00:30'))
  const night = page.locator('#toasts .toast', { hasText: '「趕期末作業」排的時間到了' })
  await expect(night.locator('.toast-act')).toHaveText(['✓ 做完了', '再 15 分鐘', '明天再做'])
  await night.locator('.toast-act', { hasText: '明天再做' }).click()
  await expect.poll(async () => (await task('e2e-n')).date).toBe(shift(ymd, 1))
  // 預估 595 分鐘（00:40 到 10:35）：再 15 分鐘只加得上 5 分鐘
  await page.clock.setFixedTime(T('10:35'))
  const long = page.locator('#toasts .toast', { hasText: '「整理房間」排的時間到了' })
  await long.locator('.toast-act', { hasText: '再 15 分鐘' }).click()
  await expect.poll(async () => (await task('e2e-l')).dur).toBe(600)
  await toastSeen(page, '再 5 分鐘')
  // 10:40 到了 600 分鐘：不再給「再 15 分鐘」
  await page.clock.setFixedTime(T('10:40'))
  await expect(page.locator('#toasts .toast', { hasText: '「整理房間」排的時間到了' }).locator('.toast-act')).toHaveText(['✓ 做完了', '明天再做'])
})

test('明天先做哪一件：晚上在今日總覽挑一件（明天的、今天沒做完挪過去的、或寫一件新的），就寢提醒提一下；早上的今日摘要從這件開始', async ({ page, context, site }) => {
  test.setTimeout(120000)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const d = new Date(`${ymd}T12:00:00+08:00`)
  d.setUTCDate(d.getUTCDate() + 1)
  const tmr = d.toISOString().slice(0, 10)
  const at = (day, hm) => new Date(`${day}T${hm}:00+08:00`)
  await context.addInitScript(({ ymd, tmr }) => {
    // 晚上 9 點後的晚間回顧先當成今天問過了（不然對話框會蓋住今日總覽）
    localStorage.setItem('hiyori-review-later', ymd)
    if (!localStorage.getItem('hiyori-daily-v1')) {
      const tasks = [
        { id: 'e2e-a', title: '讀英文單字', priority: 2, date: tmr },
        { id: 'e2e-b', title: '寫期末報告', priority: 3, date: tmr },
        { id: 'e2e-c', title: '回覆老師的信', priority: 2, date: ymd },
      ]
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, settings: {} }))
    }
  }, { ymd, tmr })
  await useAppMode(context)
  // 下午還不問
  await page.clock.setFixedTime(at(ymd, '17:00'))
  await page.goto(site.url)
  await bootReady(page)
  await expect(page.locator('#todayRoot .td-hero')).toBeVisible()
  await expect(page.locator('#todayRoot .td-first')).toHaveCount(0)
  // 20:30（就寢 23:30 前 3 小時）：問明天先做哪一件。明天的任務（重要的在前），再來是今天沒做完的
  await page.clock.setFixedTime(at(ymd, '20:30'))
  await page.evaluate(() => window.hiyori.ui.today.render())
  const card = page.locator('#todayRoot .td-first')
  await expect(card.locator('h3')).toContainText('明天先做哪一件？')
  await expect(card.locator('.td-first-pick > span')).toHaveText(['寫期末報告', '讀英文單字', '回覆老師的信'])
  await expect(card.locator('.td-first-pick').nth(2)).toContainText('今天沒做完・挪到明天')
  const task = (id) => page.evaluate((id) => { const t = window.hiyori.store.state.tasks.find((x) => x.id === id); return t && { date: t.date, first: t.first } }, id)
  // 字打到一半，別台同步過來已經挑好了：先留在可以寫的樣子，字不會不見；「先不換了」才收起來
  await card.locator('.td-first-in').fill('打到一半')
  await page.evaluate(() => window.hiyori.store.setFirst('e2e-b'))
  await page.evaluate(() => window.hiyori.ui.today.render())
  await expect(card.locator('.td-first-in')).toHaveValue('打到一半')
  await expect(card.locator('.td-first-pick.on')).toContainText('寫期末報告')
  await card.locator('[data-act="first-cancel"]').click()
  await expect(card.locator('.td-first-now b')).toHaveText('寫期末報告')
  await page.evaluate(() => window.hiyori.store.setFirst('e2e-b', false))
  await expect(card.locator('.td-first-in')).toHaveValue('')
  // 挑今天沒做完的那件：挪到明天，當成先做的那一件
  await card.locator('.td-first-pick', { hasText: '回覆老師的信' }).click()
  await expect.poll(() => task('e2e-c')).toEqual({ date: tmr, first: true })
  await expect(card.locator('h3')).toContainText('明天先做這件')
  await expect(card.locator('.td-first-now b')).toHaveText('回覆老師的信')
  // 換一件：挑了別件就換過去（原本那件留在明天）
  await card.locator('[data-act="first-edit"]').click()
  await expect(card.locator('.td-first-pick.on')).toContainText('回覆老師的信')
  await card.locator('.td-first-pick', { hasText: '讀英文單字' }).click()
  await expect.poll(() => Promise.all([task('e2e-a'), task('e2e-c')])).toEqual([{ date: tmr, first: true }, { date: tmr, first: false }])
  // 寫一件新的
  await card.locator('[data-act="first-edit"]').click()
  await card.locator('.td-first-in').fill('早上先散步十分鐘')
  await card.locator('.td-first-in').press('Enter')
  await expect(card.locator('.td-first-now b')).toHaveText('早上先散步十分鐘')
  expect(await page.evaluate((tmr) => window.hiyori.store.firstOn(tmr)?.title, tmr)).toBe('早上先散步十分鐘')
  expect((await task('e2e-a')).first).toBe(false)
  // 不挑了 → 23:00 就寢提醒的提示卡上可以去挑；按了回到這張卡片
  await card.locator('[data-act="first-clear"]').click()
  await expect(card.locator('h3')).toContainText('明天先做哪一件？')
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  await page.clock.setFixedTime(at(ymd, '23:00'))
  const bed = page.locator('#toasts .toast', { hasText: '就寢時間快到了' })
  await bed.locator('.toast-act', { hasText: '挑明天的第一件' }).click()
  await expect(card).toBeVisible()
  await expect(card.locator('.td-first-pick').first()).toBeFocused()
  await card.locator('.td-first-pick', { hasText: '寫期末報告' }).click()
  await expect(card.locator('.td-first-now b')).toHaveText('寫期末報告')
  // 重新整理也還在
  await page.reload()
  await bootReady(page)
  await expect(page.locator('#todayRoot .td-first .td-first-now b')).toHaveText('寫期末報告')
  // 隔天早上：今日摘要第一項就是它，「專注第一件」專注它
  await page.clock.setFixedTime(at(tmr, '08:00'))
  await page.evaluate(() => { window.hiyori.store.tick(); window.hiyori.ui.brief.show() })
  const brief = page.locator('#brief .bf-card')
  await brief.click()
  await expect(brief.locator('.bf-body')).toBeVisible({ timeout: 20000 })
  await expect(brief.locator('.bf-list button').first()).toContainText('寫期末報告')
  await expect(brief.locator('.bf-list button').first()).toContainText('昨晚挑好先做這件')
  await brief.locator('[data-act="focus"]').click()
  // 先打開計時設定（目標已經選好），按「開始專注」
  await expect(page.locator('#focusSet')).toBeVisible()
  expect(await page.evaluate(() => window.hiyori.ui.focus.task?.title)).toBe('寫期末報告')
  await page.locator('#fsStart').click()
  await expect.poll(() => page.evaluate(() => [window.hiyori.ui.focus.mode, window.hiyori.ui.focus.task?.title])).toEqual(['focus', '寫期末報告'])
  // 早上不再問
  await expect(page.locator('#todayRoot .td-first')).toHaveCount(0)
})

// 專注中切去用別的 App：Android 的 App 分得出鎖著手機和切走（awayLocked），鎖著手機專心的不算中途離開。
// 叫你回來的那一則交給手機排（到點時手機鎖著就不發，在 MottoNotice 裡）
test('專注中離開 App：切走時交給手機一則「回來吧」；回來時說還剩幾分鐘、記一次中途離開（鎖著手機的不算）；到點的提示卡寫中途離開幾次；設定裡可以關', async ({ page, context, site }) => {
  test.setTimeout(120000)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T10:00:00+08:00`)
  await context.addInitScript(({ ymd }) => {
    // 假的 Android 殼（4 起有 awayLocked）：記下每一次交給手機的那一串；__fg：App 在不在前面，__locked：離開時手機鎖著嗎
    window.__mottos = []
    window.__fg = true
    window.__locked = false
    window.HiyoriNative = {
      version: () => 4, canNotify: () => true, canLive: () => false, askNotify() {}, timer() {}, notify() {},
      mottos: (json) => window.__mottos.push(json), mottoHandled: () => 0, mottoClaim: () => true, mottoSeen() {}, takeAct: () => '',
      foreground: () => window.__fg,
      awayLocked: () => window.__locked,
    }
    Object.defineProperty(Document.prototype, 'hidden', { get: () => !!window.__hidden, configurable: true })
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => (window.__hidden ? 'hidden' : 'visible'), configurable: true })
    if (!localStorage.getItem('hiyori-daily-v1')) {
      const tasks = [{ id: 'e2e-t1', title: '寫期末報告', priority: 3, date: ymd, star: true }]
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, settings: { notify: true } }))
    }
  }, { ymd })
  await useAppMode(context)
  await page.clock.setFixedTime(new Date(T))
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const plan = async () => {
    const last = await page.evaluate(() => window.__mottos.at(-1))
    return last ? JSON.parse(last).items : []
  }
  const leave = (locked) => page.evaluate((l) => Object.assign(window, { __fg: false, __locked: l, __hidden: true }) && document.dispatchEvent(new Event('visibilitychange')), locked)
  const back = () => page.evaluate(() => Object.assign(window, { __fg: true, __hidden: false }) && document.dispatchEvent(new Event('visibilitychange')))
  const leaves = () => page.evaluate(() => [window.hiyori.store.peekDay(window.hiyori.store.today).leaves, window.hiyori.ui.focus.away])
  await page.evaluate(() => window.hiyori.ui.focus.startWith('e2e-t1'))
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  // 切去用別的 App：3 分鐘後叫你回來的那一則交給手機（通知上沒有警語的按鈕）
  await leave(false)
  await expect.poll(plan).toEqual([{ at: T + 3 * 60000, title: 'ひより · 專注中', body: '「寫期末報告」還在專注中，還剩 22 分鐘。回來吧', back: true }])
  // 2 分鐘後回來：說一聲還剩幾分鐘、記一次中途離開；排著的那一則取消
  await page.clock.setFixedTime(new Date(T + 2 * 60000))
  await back()
  await expect(page.locator('#appChat')).toContainText('23 分鐘')
  expect(await leaves()).toEqual([1, 1])
  await expect.poll(plan).toEqual([])
  // 鎖著手機專心做事：回來時照樣說一聲，但不算中途離開
  await leave(true)
  await page.clock.setFixedTime(new Date(T + 5 * 60000))
  await back()
  await expect(page.locator('#appChat')).toContainText('20 分鐘')
  expect(await leaves()).toEqual([1, 1])
  // 看一眼訊息就回來（不到 1 分鐘）：不吵、不算
  await page.evaluate(() => window.hiyori.ui.chatter('mochi', '（測試）', 9000))
  await leave(false)
  await page.clock.setFixedTime(new Date(T + 5 * 60000 + 30000))
  await back()
  await page.waitForTimeout(300)
  await expect(page.locator('#appChat')).toContainText('（測試）')
  expect(await leaves()).toEqual([1, 1])
  // 切走之後 Android 在背景把 App 收掉了：重新打開時（計時接回來）接著算剛才那一次
  await page.clock.setFixedTime(new Date(T + 6 * 60000))
  await leave(false)
  await page.clock.setFixedTime(new Date(T + 8 * 60000))
  await page.reload()
  await bootReady(page)
  await expect.poll(leaves).toEqual([2, 2])
  // 到點時還在別的 App 裡：也算一次，提示卡寫這一輪中途離開了幾次
  await page.clock.setFixedTime(new Date(T + 9 * 60000))
  await leave(false)
  await page.clock.setFixedTime(new Date(T + 25 * 60000 + 1000))
  await expect(page.locator('#toasts .toast', { hasText: '專注完成' })).toContainText('中途離開 3 次')
  // 到點那一次也記進這一輪的次數（延長、重新整理後接得回來）
  expect(await leaves()).toEqual([3, 3])
  await back()
  // 設定裡關掉：切走時不排那一則（回來時照樣說一聲）。先縮小專注頁（休息中還開著）
  await page.evaluate(() => {
    window.hiyori.ui.focus.toggleBig(false)
    window.hiyori.ui.setTab('settings')
  })
  await expect(page.locator('#awayRow')).toBeVisible()
  await page.locator('#awayBtn').click()
  await expect(page.locator('#awayBtn')).toHaveText('關')
  await page.evaluate(() => window.hiyori.ui.focus.startWith('e2e-t1'))
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  await leave(false)
  await page.waitForTimeout(1500)
  expect(await plan()).toEqual([])
  // 到點前 10 秒才切走、頁面到點後 2 分鐘才醒來：到點之後的那段不算，這一輪沒有中途離開
  await back()
  const end = await page.evaluate(() => window.hiyori.ui.focus.boundary.at)
  await page.clock.setFixedTime(new Date(end - 10000))
  await leave(false)
  await page.clock.setFixedTime(new Date(end + 2 * 60000))
  const done = page.locator('#toasts .toast[data-tag="focus"]', { hasText: '專注完成' })
  await expect(done).toBeVisible()
  await expect(done).not.toContainText('中途離開')
  expect((await leaves())[0]).toBe(3)
})

test('限時去（Android 的 App）：切去用別的 App 時，叫你回來的那一則排在說好的時間（「專注中叫我回來」關著也排）；手機排著時頁面不再叫，回到 App 算回來了；這一輪再一下就到點、手機沒排的，頁面自己發通知', async ({ page, context, site }) => {
  test.setTimeout(120000)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await context.addInitScript(({ ymd }) => {
    // 假的 Android 殼：App 在背景時（__fg）頁面還看得到、JavaScript 照跑；頁面發的通知記在 __notes
    window.__mottos = []
    window.__notes = []
    window.__fg = true
    window.HiyoriNative = {
      version: () => 4, canNotify: () => true, canLive: () => false, askNotify() {}, timer() {},
      notify: (title, body, tag) => window.__notes.push(`${title}|${body}|${tag}`),
      mottos: (json) => window.__mottos.push(json), mottoHandled: () => 0, mottoClaim: () => true, mottoSeen() {}, takeAct: () => '',
      foreground: () => window.__fg,
      awayLocked: () => false,
    }
    if (!localStorage.getItem('hiyori-daily-v1')) {
      const tasks = [{ id: 'e2e-t1', title: '寫期末報告', priority: 3, date: ymd, star: true }]
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, settings: { notify: true, awayNudge: false, focusRounds: 1, focusUp: false, focusMin: 25 } }))
    }
  }, { ymd })
  await useAppMode(context)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  const plan = async () => {
    const last = await page.evaluate(() => window.__mottos.at(-1))
    return last ? JSON.parse(last).items : []
  }
  const returns = () => page.evaluate(() => window.hiyori.store.peekDay(window.hiyori.store.today).returns || 0)
  const dues = () => page.evaluate(() => (window.__toasts || []).filter((x) => x.includes('說好的 5 分鐘到了')).length)
  const go = async (ask, at) => {
    await page.clock.setFixedTime(T(ask))
    await page.locator('#ffUrgeBtn').click()
    await page.clock.setFixedTime(T(at))
    await page.locator('#ffUrgeAlt', { hasText: '去 5 分鐘就回來' }).click()
  }
  await page.evaluate(() => window.hiyori.ui.focus.startWith('e2e-t1'))
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  // 去 5 分鐘就回來（10:06 叫你回來），4 分鐘後才切去別的 App：那一則照樣排在說好的時間（不是離開後的 3 分鐘）
  await go('10:00:00', '10:01:01')
  await expect(page.locator('#ffDetourT')).toHaveText('去一下・10:06 叫你回來')
  await page.clock.setFixedTime(T('10:05:00'))
  await page.evaluate(() => (window.__fg = false))
  await expect.poll(plan).toEqual([{ at: T('10:06:01').getTime(), title: 'ひより · 專注中', body: '說好的 5 分鐘到了，回來接著做「寫期末報告」吧', back: true }])
  // 說好的時間過了、App 還在背景（頁面還在跑）：手機排著那一則，頁面不再叫（不放提示卡、不發通知）
  await page.clock.setFixedTime(T('10:06:30'))
  await page.waitForTimeout(1500)
  expect(await dues()).toBe(0)
  expect(await page.evaluate(() => window.__notes)).toEqual([])
  // 回到 App：算回來了，那一行收起來，剛回來的那一下也不叫
  await page.evaluate(() => (window.__fg = true))
  await expect.poll(returns).toBe(1)
  await expect(page.locator('#ffDetour')).toBeHidden()
  await page.waitForTimeout(600)
  expect(await dues()).toBe(0)
  // 這一輪 10:25 到點，10:24:31 才是說好的時間：再一下就到點了，手機那邊不排（到點的通知會叫你）；
  // 頁面還在跑的話，說好的時間到了自己發一則
  await page.waitForTimeout(900)
  await go('10:18:30', '10:19:31')
  await expect(page.locator('#ffDetourT')).toHaveText('去一下・10:24 叫你回來')
  await page.evaluate(() => (window.__fg = false))
  await page.waitForTimeout(1200)
  expect(await plan()).toEqual([])
  await page.clock.setFixedTime(T('10:24:40'))
  await expect.poll(() => page.evaluate(() => window.__notes.length)).toBe(1)
  expect(await page.evaluate(() => window.__notes[0])).toContain('說好的 5 分鐘到了')
  expect(await dues()).toBe(1)
})

test('桌機的網頁：「專注中切到別的分頁太久叫我回來」（預設關著）打開後，離開 3 分鐘、這段時間也沒有別的分頁看著 App 時通知一次（同一段離開只叫一次）；回到頁面收掉那則通知；限時去的時候、再一下就到點的不叫', async ({ page, context, site }) => {
  test.setTimeout(120000)
  await useAppMode(context)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await context.addInitScript(() => {
    // 無頭瀏覽器不給通知權限：當成允許；Service Worker 顯示的通知記在 __shown，收掉的記在 __closed
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' })
    window.__shown = []
    window.__closed = []
    ServiceWorkerRegistration.prototype.showNotification = async function (title, o = {}) {
      window.__shown.push({ title, body: o.body, tag: o.tag })
    }
    ServiceWorkerRegistration.prototype.getNotifications = async function (f = {}) {
      return window.__shown.filter((n) => !f.tag || n.tag === f.tag).map((n) => ({ ...n, close: () => window.__closed.push(n.tag) }))
    }
    // 切到別的分頁：設了 window.__hidden 就照它算（沒設照瀏覽器的：重新整理時不能被當成回到頁面）
    const real = (k) => Object.getOwnPropertyDescriptor(Document.prototype, k).get
    const hidden = real('hidden')
    const state = real('visibilityState')
    Object.defineProperty(Document.prototype, 'hidden', { get() { return window.__hidden ?? hidden.call(this) }, configurable: true })
    Object.defineProperty(Document.prototype, 'visibilityState', { get() { return window.__hidden == null ? state.call(this) : window.__hidden ? 'hidden' : 'visible' }, configurable: true })
  })
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
  // 這個測試看的是到點就休息：關掉到點自動延長（自動延長另外測）
  await page.evaluate(() => window.hiyori.store.setSetting('flowMax', 0))
  await swReady(page)
  const id = await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('notify', true)
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    s.setSetting('focusMin', 25)
    return s.addTask({ title: '寫期末報告', date: s.today }).id
  })
  const away = () => page.evaluate(() => window.__shown.filter((n) => n.tag === 'away'))
  const closed = () => page.evaluate(() => window.__closed)
  const leave = () => page.evaluate(() => (window.__hidden = true) && document.dispatchEvent(new Event('visibilitychange')))
  const back = () => page.evaluate(() => (window.__hidden = false) || document.dispatchEvent(new Event('visibilitychange')))
  // 桌機才有這一列，預設關著；打開
  await page.evaluate(() => window.hiyori.ui.setTab('settings'))
  await expect(page.locator('#tabRow')).toBeVisible()
  await expect(page.locator('#tabBtn')).toHaveText('關')
  await page.locator('#tabBtn').click()
  await expect(page.locator('#tabBtn')).toHaveText('開')
  // 專注中切到別的分頁：3 分鐘前不叫，過了 3 分鐘叫一次（寫著還剩幾分鐘），之後不再叫
  await page.evaluate((id) => window.hiyori.ui.focus.startWith(id), id)
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  await leave()
  await page.clock.setFixedTime(T('10:02:50'))
  await page.waitForTimeout(1500)
  expect(await away()).toEqual([])
  await page.clock.setFixedTime(T('10:03:01'))
  await expect.poll(away).toEqual([{ title: 'ひより · 專注中', body: '「寫期末報告」還在專注中，還剩 22 分鐘。回來吧', tag: 'away' }])
  await page.clock.setFixedTime(T('10:05:00'))
  await page.waitForTimeout(1500)
  expect(await away()).toHaveLength(1)
  // 回到頁面：那一則收掉
  await back()
  await expect.poll(closed).toContain('away')
  // 再切走，這段時間裡別的分頁看著 App（每分鐘記一次「還在看」）：從那之後算 3 分鐘才叫
  await page.clock.setFixedTime(T('10:06:00'))
  await leave()
  await page.clock.setFixedTime(T('10:08:00'))
  await page.evaluate(() => localStorage.setItem('hiyori-seen-at', String(Date.now())))
  await page.clock.setFixedTime(T('10:09:30'))
  await page.waitForTimeout(1500)
  expect(await away()).toHaveLength(1)
  await page.clock.setFixedTime(T('10:11:01'))
  await expect.poll(async () => (await away()).length).toBe(2)
  expect((await away())[1].body).toContain('還剩 14 分鐘')
  await back()
  // 限時去（說好 10:18 回來）的時候切走：過了 3 分鐘也不叫，到說好的時間才叫（「說好的 5 分鐘到了」）；回來時收掉
  await page.clock.setFixedTime(T('10:12:00'))
  await page.waitForTimeout(900)
  await page.locator('#ffUrgeBtn').click()
  await page.clock.setFixedTime(T('10:13:01'))
  await page.locator('#ffUrgeAlt', { hasText: '去 5 分鐘就回來' }).click()
  await expect(page.locator('#ffDetourT')).toHaveText('去一下・10:18 叫你回來')
  await page.clock.setFixedTime(T('10:13:05'))
  await leave()
  await page.clock.setFixedTime(T('10:16:30'))
  await page.waitForTimeout(1500)
  expect(await away()).toHaveLength(2)
  await page.clock.setFixedTime(T('10:18:05'))
  await expect.poll(() => page.evaluate(() => window.__shown.filter((n) => n.tag === 'detour').length)).toBe(1)
  // 叫過「說好的 5 分鐘到了」了：不再另外叫「回來吧」
  await page.waitForTimeout(1500)
  expect(await away()).toHaveLength(2)
  await back()
  await expect.poll(closed).toContain('detour')
  // 這一輪 10:25 到點：快到點時才切走（3 分鐘後只剩 30 秒）不叫，到點的通知會叫你
  await page.clock.setFixedTime(T('10:21:30'))
  await leave()
  await page.clock.setFixedTime(T('10:24:31'))
  await page.waitForTimeout(1500)
  expect(await away()).toHaveLength(2)
  // 設定裡關掉：不叫
  await back()
  await page.evaluate((id) => {
    window.hiyori.store.setSetting('tabNudge', false)
    const f = window.hiyori.ui.focus
    f.stop()
    f.startWith(id)
  }, id)
  await leave()
  await page.clock.setFixedTime(T('10:28:40'))
  await page.waitForTimeout(1500)
  expect(await away()).toHaveLength(2)
})

// 通知本身（Android 的 MottoNotice、Service Worker 的 notificationclick）在 tests/sw.test.js 測；這裡是打開 App 之後頁面照著做
test('警語通知上的按鈕：手機的 App 按了「先停 1 小時」「▶ 開始專注」打開後照著做；瀏覽器照 Service Worker 留在快取裡的、傳過來的做，網址上的 ?act= 不算', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T10:00:00+08:00`)
  // 假的 Android 殼：記著按了哪一顆按鈕（開機時就按了的放在 sessionStorage，重新整理也帶得到）
  await context.addInitScript(() => {
    // 「今天還沒看過今日摘要」放在新頁面開機前才設（在舊頁面上設的話，重新整理之前舊頁面的檢查可能先把摘要叫出來、記成看過了）
    if (sessionStorage.getItem('briefOld') === '1') {
      sessionStorage.removeItem('briefOld')
      localStorage.setItem('hiyori-brief-day', JSON.stringify('2000-01-01'))
    }
    if (sessionStorage.getItem('native') !== '1') return
    window.__acts = JSON.parse(sessionStorage.getItem('acts') || '[]')
    sessionStorage.removeItem('acts')
    window.HiyoriNative = {
      version: () => 3, canNotify: () => true, canLive: () => false, askNotify() {}, timer() {}, notify() {},
      mottos() {}, mottoHandled: () => 0, mottoClaim: () => true, foreground: () => true, mottoSeen() {},
      takeAct: () => window.__acts.shift() || '',
      // 新版的殼（5）：按鈕是哪一則警語通知上的、App 不在前面時發過哪幾則（只是讀，不清掉）
      actAt: () => window.__actAt || 0,
      shown: () => JSON.stringify(window.__shown || []),
    }
  })
  await useAppMode(context)
  await page.clock.setFixedTime(new Date(T))
  await page.goto(site.url)
  await page.evaluate(() => sessionStorage.setItem('native', '1'))
  await page.reload()
  await bootReady(page)
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('notify', true)
    s.setSetting('mottoEvery', 15)
    s.toggleStar(s.addTask({ title: '寫期末報告', priority: 3, date: s.today }).id)
    s.addMotto('先做最重要的那一件')
  })
  // App 開著時按了「先停 1 小時」：殼叫網頁來拿
  await page.evaluate(() => {
    window.__acts.push('pause')
    window.dispatchEvent(new Event('hiyori-native-act'))
  })
  await expect(page.locator('#toasts .toast', { hasText: '警語先停到 11:00' })).toBeVisible()
  expect(await page.evaluate(() => window.hiyori.store.state.settings.mottoPause)).toBe(T + 3600000)
  // 「▶ 開始專注」：開始專注現在該做的那一件
  await page.evaluate(() => {
    window.__acts.push('focus')
    window.dispatchEvent(new Event('hiyori-native-act'))
  })
  await expect.poll(() => page.evaluate(() => [window.hiyori.ui.focus.mode, window.hiyori.ui.focus.task?.title])).toEqual(['focus', '寫期末報告'])
  // 已經在專注了：不換掉，說一聲
  await page.evaluate(() => {
    window.__acts.push('focus')
    window.dispatchEvent(new Event('hiyori-native-act'))
  })
  await expect(page.locator('#toasts .toast', { hasText: '已經在專注了' })).toBeVisible()
  // App 沒在跑、從按鈕打開：開機時照著做。今天還沒看過今日摘要也不出來蓋住專注頁
  await page.evaluate(() => {
    window.hiyori.ui.focus.stop()
    sessionStorage.setItem('acts', JSON.stringify(['focus']))
    sessionStorage.setItem('briefOld', '1')
  })
  await page.reload()
  await bootReady(page)
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
  await page.waitForTimeout(1500)
  await expect(page.locator('#brief')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('hiyori-brief-day'))).toBe('"2000-01-01"')
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  // 新版的殼（5）：App 不在前面時手機發過的那幾則，回到 App 時算進回神紀錄；按了其中一則通知上的按鈕，只記回應、不再多算一次提醒
  const tally = () => page.evaluate(() => { const h = window.hiyori.store.peekDay(window.hiyori.store.today); return [h.nudges, h.backs] })
  const [n0, b0] = await tally()
  await page.evaluate((t) => {
    window.__shown = [t - 30 * 60000, t - 15 * 60000]
    document.dispatchEvent(new Event('visibilitychange'))
  }, T)
  await expect.poll(tally).toEqual([n0 + 2, b0])
  await page.evaluate((t) => {
    window.__actAt = t - 15 * 60000
    window.__acts.push('focus')
    window.dispatchEvent(new Event('hiyori-native-act'))
  }, T)
  await expect.poll(tally).toEqual([n0 + 2, b0 + 1])
  await page.evaluate(() => window.hiyori.ui.focus.stop())
  // 殼那邊留著那幾則（不清掉）：再回到 App 時不重算，多了一則才多算一次
  await page.evaluate((t) => {
    window.__shown.push(t - 5 * 60000)
    document.dispatchEvent(new Event('visibilitychange'))
  }, T)
  await expect.poll(tally).toEqual([n0 + 3, b0 + 1])
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.waitForTimeout(300)
  expect(await tally()).toEqual([n0 + 3, b0 + 1])

  // 瀏覽器（沒有殼）：別的網站連過來帶 ?act=pause 不算（不然誰都能替你按）
  await page.evaluate(() => {
    sessionStorage.removeItem('native')
    window.hiyori.store.pauseMottos(0)
  })
  await page.goto(`${site.url}?act=pause`)
  await bootReady(page)
  await swReady(page)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.hiyori.store.state.settings.mottoPause)).toBe(T)
  // Service Worker 開新視窗前把按了哪一顆留在快取裡：開機時拿走、照著做，拿了就刪掉
  const actFile = () =>
    page.evaluate(async () => {
      const url = new URL('__act', (await navigator.serviceWorker.getRegistration()).scope).href
      return (await (await caches.open('hiyoripush')).match(url))?.json() ?? null
    })
  await page.evaluate(async (t) => {
    const url = new URL('__act', (await navigator.serviceWorker.getRegistration()).scope).href
    await (await caches.open('hiyoripush')).put(url, new Response(JSON.stringify({ id: 'x1', act: 'pause', at: t })))
  }, T)
  await page.reload()
  await bootReady(page)
  await expect.poll(() => page.evaluate(() => window.hiyori.store.state.settings.mottoPause)).toBe(T + 3600000)
  expect(await actFile()).toBeNull()
  // 叫出開著的視窗：Service Worker 直接傳過來
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'hiyori-act', act: 'focus', id: 'x2' } })))
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('focus')
})

test('網頁版：日程開始前的提醒在頁面關掉時也會響（跟警語同一串交給伺服器，字留在這台的快取）；看著頁面時頁面自己提醒', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T10:00:00+08:00`)
  await context.addInitScript(({ ymd }) => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' })
    const cur = { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e', options: {}, unsubscribe: async () => true }
    PushManager.prototype.getSubscription = async () => cur
    PushManager.prototype.subscribe = async () => cur
    Object.defineProperty(Document.prototype, 'hidden', { get: () => !!window.__hidden, configurable: true })
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => (window.__hidden ? 'hidden' : 'visible'), configurable: true })
    if (sessionStorage.getItem('seed') === '1') {
      sessionStorage.removeItem('seed')
      const events = [
        { id: 'e2e-ev1', title: '牙醫', date: ymd, start: '10:30', end: '11:30' },
        { id: 'e2e-ev2', title: '健身', date: ymd, start: '12:00', end: '13:00' },
      ]
      localStorage.removeItem('hiyori-daily-rev')
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks: [], events, player: {}, mottos: [], settings: { notify: true, remindLead: 10 } }))
    }
  }, { ymd })
  const calls = []
  await context.route('**/v1/push/**', (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    calls.push({ path, body: req.postDataJSON() })
    route.fulfill({ json: path.endsWith('/key') ? { key: 'BAAA' } : { ok: true }, headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  const armed = () => calls.filter((c) => c.path === '/v1/push/mottos')
  await useAppMode(context)
  await page.clock.setFixedTime(new Date(T))
  await page.goto(site.url)
  await bootReady(page)
  await swReady(page)
  await page.evaluate(() => sessionStorage.setItem('seed', '1'))
  await page.reload()
  await bootReady(page)
  await swReady(page)
  const file = (name) =>
    page.evaluate(async (n) => {
      const hit = await (await caches.open('hiyoripush')).match(new URL(n, (await navigator.serviceWorker.ready).scope).href)
      return hit ? hit.json() : null
    }, name)
  // 顯示過的提醒：一則一個檔案（__remind-shown/key|date）
  const shownFiles = () =>
    page.evaluate(async () => {
      const c = await caches.open('hiyoripush')
      const dir = new URL('__remind-shown/', (await navigator.serviceWorker.ready).scope).href
      const out = []
      for (const r of await c.keys()) if (r.url.startsWith(dir)) out.push(await (await c.match(r.url)).json())
      return out
    })
  // 10:20 那一則（10:30 開始前 10 分鐘）的字留在快取裡；看著頁面時不交給伺服器
  await expect
    .poll(async () => (await file('__motto-plan'))?.find((x) => x.remind))
    .toEqual({ at: T + 20 * 60000, key: 'e2e-ev1@10:30', date: ymd, title: 'ひより · 牙醫', body: '10 分鐘後開始（10:30）', tag: 'e2e-ev1', remind: true, until: T + 45 * 60000 })
  expect(armed()).toEqual([])
  // 離開頁面：那一則的時間交給伺服器
  await page.evaluate(() => {
    window.__hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => armed().length).toBe(1)
  // （後面還有就寢前 30 分鐘的那幾則）
  expect(armed()[0].body.after[0]).toBe(20 * 60000)
  // Service Worker 推播到了、顯示過（這裡直接寫進它記的那一份）；回到頁面、到了 10:20：記成提醒過了，不再跳提示卡
  await page.evaluate(async ({ ymd, at }) => {
    const url = new URL('__remind-shown', (await navigator.serviceWorker.ready).scope).href
    await (await caches.open('hiyoripush')).put(url, new Response(JSON.stringify([{ key: 'e2e-ev1@10:30', date: ymd, at }])))
  }, { ymd, at: T + 20 * 60000 })
  await page.clock.setFixedTime(new Date(T + 20 * 60000 + 5000))
  await page.evaluate(() => {
    window.__hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => page.evaluate((d) => JSON.parse(localStorage.getItem('hiyori-reminded') || '{}')[d] || [], ymd)).toContain('e2e-ev1@10:30')
  await page.waitForTimeout(1500)
  await expect(page.locator('#toasts .toast', { hasText: '牙醫' })).toHaveCount(0)

  // 健身（12:00，11:50 提醒）：頁面在背景時到點 → 交給 Service Worker，頁面不跳卡、不響；
  // 推播一直沒送到（沒顯示過）→ 回到頁面時還在期限內，照常提醒，也記給 Service Worker（推播晚到也不會再顯示一次）
  await page.evaluate(() => {
    window.__hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  // 伺服器排著 11:50 那一則（第一次離開頁面時就交了）
  expect(armed().at(-1).body.after.some((x) => Math.abs(x - 110 * 60000) < 1000)).toBe(true)
  await page.clock.setFixedTime(new Date(T + 110 * 60000 + 5000))
  await expect.poll(() => page.evaluate((d) => JSON.parse(localStorage.getItem('hiyori-reminded') || '{}')[d] || [], ymd)).toContain('e2e-ev2@12:00')
  await page.waitForTimeout(1200)
  await expect(page.locator('#toasts .toast', { hasText: '健身' })).toHaveCount(0)
  // 交出去、還沒送到的這一則留在交給伺服器的那一串裡（重排時不會被取消）
  expect((await file('__motto-plan')).some((x) => x.key === 'e2e-ev2@12:00')).toBe(true)
  await page.clock.setFixedTime(new Date(T + 111 * 60000))
  await page.evaluate(() => {
    window.__hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('#toasts .toast', { hasText: '健身' })).toBeVisible()
  await expect.poll(async () => (await shownFiles()).some((x) => x.key === 'e2e-ev2@12:00' && x.date === ymd)).toBe(true)
})

// 收到推播後顯示什麼、頁面和 Service Worker 怎麼分「念到哪」在 tests/sw.test.js、tests/mottoPush.test.js 測
test('網頁版的警語推播：看著頁面時頁面自己念；離開頁面時把接下來的時間交給伺服器，回來後下一則快到了才取消；關掉通知就取消', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T10:00:00+08:00`)
  await context.addInitScript(({ t, ymd }) => {
    // 測試用的瀏覽器不給通知權限、也連不到推播服務：權限當成允許、這台本來就訂閱過（假的）
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' })
    let cur = { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e', options: {}, unsubscribe: async () => ((cur = null), true) }
    PushManager.prototype.getSubscription = async () => cur
    PushManager.prototype.subscribe = async () => (cur = { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e', options: {}, unsubscribe: async () => ((cur = null), true) })
    // 切到別的分頁、鎖螢幕：window.__hidden 換掉「頁面看不看得到」
    Object.defineProperty(Document.prototype, 'hidden', { get: () => !!window.__hidden, configurable: true })
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => (window.__hidden ? 'hidden' : 'visible'), configurable: true })
    // 用了一陣子的這台：Service Worker 第一次打開時就裝好了；存檔裡有一句警語（每 15 分鐘）、今天的本命「寫期末報告」，
    // 開著系統通知，上一則排在 9:45（見上一個測試）。第一次打開、裝好之後才放進去（sessionStorage 的 seed）
    if (sessionStorage.getItem('seed') === '1') {
      sessionStorage.removeItem('seed')
      const tasks = [{ id: 'e2e-t1', title: '寫期末報告', priority: 3, date: ymd, star: true }]
      const mottos = [{ id: 'e2e-m1', text: '先做最重要的那一件', on: true, createdAt: t - 86400000 }]
      localStorage.removeItem('hiyori-daily-rev')
      localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, mottos, settings: { notify: true, mottoEvery: 15 } }))
      localStorage.setItem('hiyori-motto-at', JSON.stringify({ at: t - 15 * 60000, i: 0 }))
    }
  }, { t: T, ymd })
  const calls = []
  await context.route('**/v1/push/**', (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    calls.push({ path, body: req.postDataJSON(), type: req.headers()['content-type'] })
    route.fulfill({ json: path.endsWith('/key') ? { key: 'BAAA' } : { ok: true }, headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  const mottoCalls = () => calls.filter((c) => c.path === '/v1/push/mottos')
  await useAppMode(context)
  // 9:59:30 打開，開好之後到了 10:00（見上上一個測試）
  await page.clock.setFixedTime(new Date(T - 30000))
  await page.goto(site.url)
  await bootReady(page)
  await swReady(page)
  await page.evaluate(() => sessionStorage.setItem('seed', '1'))
  await page.reload()
  await bootReady(page)
  await swReady(page)
  await page.clock.setFixedTime(new Date(T))
  const file = (name) =>
    page.evaluate(async (n) => {
      const hit = await (await caches.open('hiyoripush')).match(new URL(n, (await navigator.serviceWorker.ready).scope).href)
      return hit ? hit.json() : null
    }, name)
  const leave = (hidden) =>
    page.evaluate((h) => {
      window.__hidden = h
      document.dispatchEvent(new Event('visibilitychange'))
    }, hidden)
  // 看著頁面：10:00 那一則頁面自己念，念之前記下「念到這一則了」（推播晚到的話 Service Worker 就不再顯示）
  await expect(page.locator('#toasts .toast', { hasText: '先做最重要的那一件' })).toContainText('現在該做：寫期末報告')
  await expect.poll(() => file('__motto-done')).toEqual({ at: T })
  // 接下來的字留在這台的快取裡；看著頁面時不交給伺服器。
  // （開機時先排好、後念的話，剛念完的 10:00 那一則也留著，見 tests/mottoPush.test.js；推播晚到時靠 __motto-done 認得出念過了）
  // （sleep：那一段醒著的時間到幾點〔作息的就寢〕，推播晚到、過了就寢才送到的話 Service Worker 不出聲地放）
  const bed = await page.evaluate(() => window.hiyori.store.state.rhythm.sleep)
  await expect
    .poll(async () => (await file('__motto-plan'))?.find((x) => x.at === T + 15 * 60000))
    .toEqual({ at: T + 15 * 60000, title: 'ひより · 給自己的警語', body: '先做最重要的那一件\n現在該做：寫期末報告', focus: true, sleep: Date.parse(`${ymd}T${bed}:00+08:00`) })
  expect((await file('__motto-plan')).every((x) => x.at >= T)).toBe(true)
  expect(mottoCalls()).toEqual([])
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  await expect(page.locator('#mottoRoot .mt-reach')).toContainText('頁面關掉、手機鎖著也會照時間通知')

  // 離開頁面：交出接下來的時間（只有網址、幾毫秒後、序號；離開時送的，用 text/plain）
  await leave(true)
  await expect.poll(() => mottoCalls().length).toBe(1)
  const [arm] = mottoCalls()
  expect(Object.keys(arm.body).sort()).toEqual(['after', 'endpoint', 'seq'])
  expect(arm.body.endpoint).toBe('https://fcm.googleapis.com/fcm/send/e2e')
  expect(arm.body.after.slice(0, 2)).toEqual([15 * 60000, 30 * 60000])
  expect(arm.type).toContain('text/plain')
  // 回到頁面：下一則還有 15 分鐘，先不取消（很快又切走也不用再交）
  await leave(false)
  await page.waitForTimeout(1500)
  expect(mottoCalls()).toHaveLength(1)
  // 下一則再 30 秒就到：取消，由頁面自己念
  await page.clock.setFixedTime(new Date(T + 14.5 * 60000))
  await expect.poll(() => mottoCalls().at(-1).body.after).toBeNull()
  expect(mottoCalls().at(-1).body.seq).toBeGreaterThan(arm.body.seq)

  // 10:05 又離開：再交一次
  await page.clock.setFixedTime(new Date(T + 5 * 60000))
  await leave(true)
  await expect.poll(() => mottoCalls().length).toBe(3)
  expect(mottoCalls()[2].body.after[0]).toBe(10 * 60000)
  await leave(false)
  await page.waitForTimeout(1500)
  expect(mottoCalls()).toHaveLength(3)
  // 回來後按了先停：念到哪推到現在（已經到點、推播還在路上的那幾則晚到時，Service Worker 當成念過了、不出聲）；
  // 排法變了，伺服器上排著的那一串取消。恢復之後再離開：照原本的那一串再交一次
  expect(await file('__motto-done')).toEqual({ at: T })
  await page.evaluate(() => window.hiyori.store.setSetting('mottoPause', Date.now() + 3600000))
  await expect.poll(() => file('__motto-done')).toEqual({ at: T + 5 * 60000 })
  await expect.poll(() => mottoCalls().length).toBe(4)
  expect(mottoCalls()[3].body.after).toBeNull()
  await page.evaluate(() => window.hiyori.store.setSetting('mottoPause', 0))
  await leave(true)
  await expect.poll(() => mottoCalls().length).toBe(5)
  expect(mottoCalls()[4].body.after[0]).toBe(10 * 60000)
  // 回來（下一則還久）關掉系統通知：伺服器上排著的取消、快取裡的字拿掉
  await leave(false)
  await page.waitForTimeout(1500)
  expect(mottoCalls()).toHaveLength(5)
  await page.evaluate(() => window.hiyori.ui.setTab('schedule'))
  await page.locator('#notifyBtn').click()
  await expect.poll(() => mottoCalls().length).toBe(6)
  expect(mottoCalls()[5].body.after).toBeNull()
  await expect.poll(() => file('__motto-plan')).toEqual([])
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  await expect(page.locator('#mottoRoot .mt-reach')).toContainText('現在只在看著這一頁時提醒')
  // 沒訂閱推播了：再按先停也不動念到哪（不會有推播來）
  await page.clock.setFixedTime(new Date(T + 6 * 60000))
  await page.evaluate(() => {
    window.hiyori.store.setSetting('mottoPause', 0)
    window.hiyori.store.setSetting('mottoPause', Date.now() + 3600000)
  })
  await page.waitForTimeout(1500)
  expect(await file('__motto-done')).toEqual({ at: T + 5 * 60000 })
})

test('回神紀錄：警語提示卡上按「✓ 在做了」記一筆、誇一句；週報寫回神了幾次，提醒時多半本來就在做的話一鍵拉長間隔', async ({ page, context, site }) => {
  // 9:59:30 打開，開好之後到了 10:00（見上面 Android 殼的測試）
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T10:00:00+08:00`)
  await context.addInitScript(({ t, ymd }) => {
    if (localStorage.getItem('hiyori-daily-v1')) return
    const tasks = [{ id: 'e2e-t1', title: '寫期末報告', priority: 3, date: ymd, star: true }]
    const mottos = [{ id: 'e2e-m1', text: '手機放遠一點', on: true, createdAt: t - 86400000 }]
    localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, player: {}, mottos, settings: { mottoEvery: 15 } }))
    localStorage.setItem('hiyori-motto-at', JSON.stringify({ at: t - 15 * 60000, i: 0 }))
  }, { t: T, ymd })
  await useAppMode(context)
  await page.clock.setFixedTime(new Date(T - 30000))
  await page.goto(site.url)
  await bootReady(page)
  await page.clock.setFixedTime(new Date(T))
  const toast = page.locator('#toasts .toast', { hasText: '手機放遠一點' })
  await expect(toast.locator('.toast-act')).toHaveText(['▶ 開始專注', '只做 5 分鐘', '✓ 在做了', '先停 1 小時'])
  await toast.locator('.toast-act', { hasText: '✓ 在做了' }).click()
  await expect(toast).toHaveCount(0)
  const today = () => page.evaluate(() => {
    const s = window.hiyori.store
    const d = s.peekDay(s.today)
    return [d.nudges, d.backs, d.onTask]
  })
  // 提醒了一次、本來就在做正事一次；沒有開始專注
  expect(await today()).toEqual([1, 0, 1])
  expect(await page.evaluate(() => window.hiyori.ui.focus.mode)).toBe('idle')

  // 今天稍早也提醒了 10 次，8 次本來就在做：週報的表現分析寫「9 / 11 次」，洞察建議間隔從 15 分拉長到 20 分
  await page.evaluate(() => {
    const s = window.hiyori.store
    const d = s.day(s.today)
    d.nudges += 10
    d.onTask += 8
    s.save()
    window.hiyori.ui.setTab('coach')
  })
  await page.locator('#coachRoot [data-v="report"]').click()
  await expect(page.locator('#coachRoot .wr-perf li', { hasText: '警語回神' })).toContainText('9 / 11 次')
  const ins = page.locator('#coachRoot .wr-ins li', { hasText: '提醒的時候，你多半已經在做正事了' })
  await expect(ins).toContainText('提醒了 11 次，有 9 次你本來就在做')
  await ins.locator('[data-act="mottoEvery"]').click()
  expect(await page.evaluate(() => window.hiyori.store.state.settings.mottoEvery)).toBe(20)
  await expect(page.locator('#toasts .toast', { hasText: '警語改成每 20 分鐘提醒一次' })).toBeVisible()
  // 已經改成 20 分了：同一批紀錄不會接著又建議再拉長（之後又提醒夠多次才會），洞察本身還在
  await expect(ins).toContainText('提醒了 11 次，有 9 次你本來就在做')
  await expect(page.locator('#coachRoot [data-act="mottoEvery"]')).toHaveCount(0)
})
test('自主的ふじ：早上打開自己把今天排好（可以整批撤銷）、總覽上說一句話就加好日程、教練分頁看得到對話和紀錄、可以改成先問我', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T10:00:00+08:00`)
  await context.addInitScript(({ ymd }) => {
    if (localStorage.getItem('hiyori-daily-v1')) return
    const tasks = [
      { id: 'e2e-t1', title: '寫期末報告', priority: 3, date: ymd },
      { id: 'e2e-t2', title: '買牛奶', priority: 1, date: ymd },
    ]
    localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, events: [], projects: [], player: {} }))
    // 測試用的通行碼（Worker 換成下面假的）
    localStorage.setItem('hiyori-ai-pass', 'e2e-test-pass')
  }, { ymd })
  // 假的 Claude：早上把今天的任務排進 10:30、11:30；對話裡說牙醫就加一個明天的日程
  const calls = []
  await context.route(/\/v1\/ai$/, async (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = route.request().postDataJSON()
    calls.push(body)
    const d = body.data
    const out = { say: '', schedule: [], add: [], steps: [], edit: [], star: [], first: '', msteps: [], next: '', remember: [], forget: [], done: [], drop: [], events: [], dates: [], ask: [] }
    if (d.run === 'morning') {
      const [a, b] = d.days[0].tasks
      out.schedule = [{ id: a.id, date: d.today, at: '10:30', dur: 50 }, { id: b.id, date: d.today, at: '11:30', dur: 15 }]
      out.star = [{ id: a.id, on: true }]
      out.next = a.id
      out.say = `今天排好了：先做「${a.title}」。`
    } else if (d.run === 'chat') {
      out.events = [{ title: '看牙醫', date: d.days[1].date, start: '15:00', end: '16:00' }]
      out.say = '明天下午三點的牙醫記好了。'
    }
    await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, model: 'mock', out }) })
  })
  await useAppMode(context)
  await page.clock.setFixedTime(new Date(T))
  await page.goto(site.url)
  await bootReady(page)
  // 開場後幾秒自己整理：提示卡說一聲，總覽的卡片上寫著做了什麼
  await toastSeen(page, 'ふじ整理了今天（3 項）')
  expect(calls[0]).toMatchObject({ task: 'agent', data: { run: 'morning', mode: 'auto' } })
  const tasks = () => page.evaluate(() => window.hiyori.store.state.tasks.map((t) => [t.title, t.at, t.dur, t.star]))
  expect(await tasks()).toEqual([['寫期末報告', '10:30', 50, true], ['買牛奶', '11:30', 15, false]])
  const card = page.locator('#todayRoot .ag-card')
  await expect(card.locator('.ag-say')).toHaveText('今天排好了：先做「寫期末報告」。')
  await expect(card.locator('.ag-did li')).toHaveText(['「寫期末報告」排在今天 10:30', '「買牛奶」排在今天 11:30', '本命：「寫期末報告」'])
  await expect(card.locator('[data-ag="focus"]')).toHaveText('專注「寫期末報告」')
  // 同一天不再整理一次
  await page.evaluate(() => window.hiyori.agent.tick())
  expect(calls).toHaveLength(1)
  // 整批撤銷：回到原本的樣子
  await card.locator('[data-ag="undo"]').click()
  expect(await tasks()).toEqual([['寫期末報告', null, null, false], ['買牛奶', null, null, false]])
  await expect(card.locator('.ag-undone')).toHaveText('已經撤銷')

  // 總覽上直接說一句：輸入框打字時頁面重畫也不會把字弄丟
  const input = card.locator('.ag-form input')
  await input.fill('明天三點')
  await page.evaluate(() => window.hiyori.ui.render())
  await expect(input).toHaveValue('明天三點')
  await input.fill('明天三點看牙醫')
  await input.press('Enter')
  await expect(card.locator('.ag-say')).toHaveText('明天下午三點的牙醫記好了。')
  expect(calls[1].data).toMatchObject({ run: 'chat', message: '明天三點看牙醫' })
  expect(await page.evaluate(() => window.hiyori.store.state.events.map((e) => [e.title, e.start]))).toEqual([['看牙醫', '15:00']])
  await expect(input).toHaveValue('')

  // 教練分頁：接了 Claude 時先看到ふじ那一頁，對話和她自己整理的紀錄排在一起
  await card.locator('[data-ag="chat"]').click()
  const feed = page.locator('#coachRoot .ag-feed')
  await expect(feed.locator('.cmsg.me')).toHaveText('明天三點看牙醫')
  await expect(feed.locator('.ag-bubble').first()).toContainText('整理今天')
  await expect(feed.locator('.ag-bubble').last()).toContainText('日程「看牙醫」（明天 15:00）')
  // 改成先問我：設定記下來，重新整理後還在
  await page.locator('#coachRoot [data-av="mode"][data-v="ask"]').click()
  await expect(page.locator('#coachRoot .ag-mode-sub')).toHaveText('看過再套用')
  await page.evaluate(() => window.hiyori.store.flushSave())
  await page.reload()
  await bootReady(page)
  expect(await page.evaluate(() => window.hiyori.store.state.settings.agentMode)).toBe('ask')
  // 原本的問卷排程還在另一頁
  await page.evaluate(() => window.hiyori.ui.setTab('coach'))
  await page.locator('#coachRoot [data-act="view"][data-v="plan"]').click()
  await expect(page.locator('#coachRoot form[data-r="ask"]')).toBeVisible()
})

test('AI 通行碼從別處到了（別台同步過來、另一個分頁設的）：設定裡那一列跟著變成已設定、可以選模型；正打開著要填、還沒打字的輸入框自己收起來', async ({ page, context, site }) => {
  await useAppMode(context)
  // 不讓ふじ真的去叫 Claude（這個測試只看設定列）
  await context.route(/\/v1\/ai$/, (route) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ ok: true, model: 'mock', out: {} }) }))
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    window.hiyori.store.setSetting('agentMode', 'off')
    window.hiyori.ui.setTab('settings')
  })
  const row = page.locator('#aiRow')
  await row.scrollIntoViewIfNeeded()
  await expect(row.locator('[data-ai="edit"]')).toHaveText('設定通行碼')
  // 按了「設定通行碼」、輸入框開著還沒打字時，別台設好的通行碼同步過來了
  await row.locator('[data-ai="edit"]').click()
  await expect(row.locator('.ai-pass')).toBeVisible()
  await page.evaluate(() => window.hiyori.cloudSync.extras.set({ aiPass: 'e2e-synced-pass', aiPassAt: Date.now() }))
  await toastSeen(page, 'ふじ的 AI 通行碼同步過來了')
  await expect(row.locator('.ai-pass')).toHaveCount(0)
  await expect(row.locator('.ai-info')).toContainText('已設定')
  await expect(row.locator('.ai-btns button')).toHaveText(['測試連線', '改通行碼', '停用'])
  // 沒選過模型：自動（對話用 Sonnet、自己整理用 Opus）
  await expect(row.locator('[data-ai="model"][data-v="auto"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(row.locator('.ai-info')).toContainText('自動選模型')
  // 可以換模型
  await row.locator('[data-ai="model"][data-v="claude-sonnet-5-5"]').click()
  await expect(row.locator('.ai-info')).toContainText('用 Sonnet')
  // 選的模型跟通行碼一起帶上去
  expect(await page.evaluate(() => window.hiyori.cloudSync.extras.get())).toMatchObject({ aiPass: 'e2e-synced-pass', aiModel: 'claude-sonnet-5-5' })
  // 別台之後換了模型（通行碼還是原來那一組）：這台跟著換、說一聲；比這台舊的不理
  await page.evaluate(() => window.hiyori.cloudSync.extras.set({ aiPass: 'e2e-synced-pass', aiPassAt: 1, aiModel: 'claude-haiku-5-5', aiModelAt: Date.now() + 5000 }))
  await toastSeen(page, 'ふじ改用 Haiku 了')
  await expect(row.locator('.ai-info')).toContainText('用 Haiku')
  await expect(row.locator('[data-ai="model"][data-v="claude-haiku-5-5"]')).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => window.hiyori.cloudSync.extras.set({ aiModel: 'claude-opus-5-5', aiModelAt: 5 }))
  await expect(row.locator('[data-ai="model"][data-v="claude-haiku-5-5"]')).toHaveAttribute('aria-pressed', 'true')
  // 自己正在打新的通行碼時，別處又變了：打到一半的字留著
  await row.locator('[data-ai="edit"]').click()
  await row.locator('.ai-pass').fill('打到一半')
  await page.evaluate(() => window.hiyori.cloudSync.extras.set({ aiPass: 'e2e-newer-pass', aiPassAt: Date.now() + 1000 }))
  await expect(row.locator('.ai-pass')).toHaveValue('打到一半')
  await row.locator('[data-ai="cancel"]').click()
  // 另一個分頁停用了（localStorage 變了）：這邊回到還沒設定的樣子，ふじ的卡片也收起來
  await page.evaluate(() => {
    localStorage.removeItem('hiyori-ai-pass')
    window.dispatchEvent(new StorageEvent('storage', { key: 'hiyori-ai-pass' }))
  })
  await expect(row.locator('[data-ai="edit"]')).toHaveText('設定通行碼')
  await expect(row.locator('.ai-models')).toHaveCount(0)
  // 在別處設好之後才打開設定：一打開就是已設定
  await page.evaluate(() => {
    window.hiyori.ui.setTab('today')
    localStorage.setItem('hiyori-ai-pass', 'e2e-other-tab')
    window.hiyori.ui.setTab('settings')
  })
  await expect(row.locator('.ai-btns button')).toHaveText(['測試連線', '改通行碼', '停用'])
})

test('App 關著時ふじ也說一聲（Android 的 App）：今晚睡前、明天早上的那幾則先寫好交給手機；第一次問要不要，說不用就取消；ふじ頁面上可以改回這台接收', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T20:00:00+08:00`)
  await context.addInitScript(({ ymd }) => {
    // 假的 Android 殼（新版，有 fujiNotes）：記下每一次交給手機的ふじ的那幾則
    window.__fuji = []
    window.__notified = []
    window.__asked = []
    window.__nativeHas = true
    window.__away = false
    window.HiyoriNative = {
      version: () => 6, canNotify: () => true, canLive: () => false, askNotify() {}, timer() {}, notify: (title, body, tag) => window.__notified.push([tag, title]),
      mottos() {}, mottoHandled: () => 0, mottoClaim: () => true, foreground: () => !window.__away,
      fujiNotes: (json) => window.__fuji.push(json),
      // 網頁到點要說那一則：手機排著的話由手機發（__nativeHas），沒排的話網頁自己說
      fujiNow: (at) => window.__asked.push(Number(at)) > 0 && window.__nativeHas,
    }
    if (localStorage.getItem('hiyori-daily-v1')) return
    const tomorrow = new Date(Date.parse(`${ymd}T12:00:00+08:00`) + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    // 明天要交的報告和簡報，各還要 10 小時：照現在的空檔來不及了
    const tasks = [
      { id: 'e2e-t1', title: '寫期末報告', priority: 3, date: tomorrow, at: '09:00', first: true, dur: 600, due: tomorrow },
      { id: 'e2e-t2', title: '準備簡報', priority: 2, date: tomorrow, dur: 600, due: tomorrow },
    ]
    localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks, events: [], projects: [], player: {}, settings: { notify: true } }))
    localStorage.setItem('hiyori-ai-pass', 'e2e-test-pass')
    // App 關著時已經送過的風險那則（19:30，說明天截止的來不及了）
    localStorage.setItem('hiyori-fuji-risk', JSON.stringify({ notes: [{ at: Date.parse(`${ymd}T19:30:17+08:00`), due: tomorrow, level: 'late' }], days: [] }))
  }, { ymd })
  // 假的 Claude：什麼都不動
  await context.route(/\/v1\/ai$/, async (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const out = { say: '', schedule: [], add: [], steps: [], edit: [], star: [], first: '', msteps: [], next: '', remember: [], forget: [], done: [], drop: [], events: [], dates: [], ask: [] }
    await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, model: 'mock', out }) })
  })
  await useAppMode(context)
  await page.clock.setFixedTime(new Date(T))
  await page.goto(site.url)
  await bootReady(page)
  const last = () => page.evaluate(() => {
    const j = window.__fuji.at(-1)
    return j === undefined ? null : j ? JSON.parse(j).items.map((x) => [new Date(x.at).toLocaleString('sv', { timeZone: 'Asia/Taipei' }).slice(11, 16), x.title, x.body]) : []
  })
  // 還沒選過哪一台：手機先送。今晚就寢（23:30）前 30 分鐘、明天起床（7:00）後 30 分鐘
  await expect.poll(async () => (await last())?.slice(0, 2).map(([t, title]) => `${t} ${title}`)).toEqual(['23:00 ふじ · 差不多該睡了', '07:30 ふじ · 今天的安排'])
  const [bed, morning] = await last()
  // 關著時送過的風險那則：打開後記成說過了，開著時不再說一次（沒有「做不完」的提示卡），今天也不再排第二則
  const tomorrow = await page.evaluate(() => window.hiyori.store.state.tasks[0].date)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hiyori-risk') || '{}').due)).toMatchObject({ [tomorrow]: 'late' })
  expect(await page.evaluate(() => (window.__toasts || []).some((x) => x.includes('做不完')))).toBe(false)
  expect((await last()).some(([, title]) => title.includes('截止日'))).toBe(false)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hiyori-fuji-risk')))).toEqual({ notes: [], days: [ymd] })
  expect(bed[2]).toContain('明天先做「寫期末報告」（09:00）')
  expect(morning[2]).toBe('今天 2 件事，先做「寫期末報告」（09:00）。「寫期末報告」 等 2 件今天截止。')
  // 半分鐘後第一次問：說不用 → 不送了（手機上排著的取消）
  await page.clock.setFixedTime(new Date(T + 31000))
  const ask = page.locator('#toasts .toast', { hasText: 'App 關著的時候，要我通知你嗎？' })
  await expect(ask).toBeVisible()
  await ask.locator('.toast-act', { hasText: '不用' }).click()
  await expect.poll(last).toEqual([])
  expect(await page.evaluate(() => window.hiyori.store.state.settings.fujiNotify)).toBe('off')
  // ふじ頁面上改回這台接收
  await page.evaluate(() => window.hiyori.ui.openAgent())
  const toggle = page.locator('#coachRoot [data-av="notes"]')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#coachRoot .ag-notes-sub')).toHaveText('早上、截止日有風險時、睡前，一天最多 3 則')
  await expect.poll(async () => (await last())?.length).toBeGreaterThan(1)
  expect(await page.evaluate(() => window.hiyori.store.state.settings.fujiNotify)).toBe(await page.evaluate(() => localStorage.getItem('hiyori-device')))
  // 23:00 App 在背景、網頁還在跑：就寢提醒跟ふじ睡前那則只跳一則。手機排著那一則：請手機現在發，網頁不另外跳
  // （畫面上的提示卡照常，回來看得到）
  const bedAt = Date.parse(`${ymd}T23:00:17+08:00`)
  await page.evaluate(() => {
    window.__away = true
    document.hasFocus = () => false
  })
  await page.clock.setFixedTime(new Date(Date.parse(`${ymd}T23:00:05+08:00`)))
  await expect(page.locator('#toasts .toast', { hasText: '就寢時間快到了' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__asked)).toEqual([bedAt])
  expect(await page.evaluate(() => window.__notified)).toEqual([])
  // 手機發了的那一則不再交給手機（明天晚上的睡前那則照排）
  const sent = () => page.evaluate(() => (window.__fuji.at(-1) ? JSON.parse(window.__fuji.at(-1)).items.map((x) => x.at) : []))
  await expect.poll(async () => (await sent()).includes(bedAt)).toBe(false)
  expect((await sent()).includes(bedAt + 86400000)).toBe(true)
  // 手機沒排那一則（例如還沒收到）：網頁用ふじ的字說一則（就寢提醒再響一次來看）
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('hiyori-fuji-bed'))
    r.claimed = []
    localStorage.setItem('hiyori-fuji-bed', JSON.stringify(r))
    localStorage.removeItem('hiyori-reminded')
    window.hiyori.reminders.sent = {}
    window.__nativeHas = false
    window.hiyori.reminders.check(new Date())
  })
  // （清掉了提醒過的紀錄，截止日那兩則也會再響：只看就寢這一則）
  await expect.poll(() => page.evaluate(() => window.__notified.filter(([tag]) => tag === 'fuji' || tag === 'bedtime'))).toEqual([['fuji', 'ふじ · 差不多該睡了']])
})

test('隨叫隨到的ふじ：任何一頁按 J 叫出來，看得到正在看哪一頁；一句話改日程、設定、新增習慣，做完打開那一頁；整批撤銷', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = Date.parse(`${ymd}T10:00:00+08:00`)
  await context.addInitScript(({ ymd }) => {
    if (localStorage.getItem('hiyori-daily-v1')) return
    const events = [{ id: 'e2e-ev', title: '組會', date: ymd, start: '15:00', end: '16:00', color: 0 }]
    localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks: [], events, projects: [], player: {}, settings: { agentMode: 'off' } }))
    localStorage.setItem('hiyori-ai-pass', 'e2e-test-pass')
  }, { ymd })
  // 假的 Claude：把組會改到 16:00、字改大、專注改成 50 分鐘、新增一個習慣，做完打開習慣頁
  const calls = []
  await context.route(/\/v1\/ai$/, async (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = route.request().postDataJSON()
    calls.push(body)
    const d = body.data
    const out = { say: '', schedule: [], add: [], steps: [], edit: [], star: [], first: '', msteps: [], next: '', remember: [], forget: [], done: [], drop: [], events: [], dates: [], ask: [], set: [], create: [], go: { do: '', id: '' } }
    if (d.run === 'chat') {
      const ev = d.world.events.find((e) => e.title === '組會').id
      out.set = [
        { id: ev, field: 'start', value: '16:00' },
        { id: ev, field: 'end', value: '17:00' },
        { id: 'settings', field: 'fontScale', value: '1.12' },
        { id: 'settings', field: 'focusMin', value: '50' },
      ]
      out.create = [{ kind: 'habit', ref: '', parent: '', title: '喝水', date: '', start: '', end: '', fields: [{ field: 'target', value: '8' }, { field: 'unit', value: '杯' }] }]
      out.go = { do: 'open', id: 'habits' }
      out.say = '組會改到四點了，字放大一點，專注改成 50 分鐘，也加了喝水的習慣。'
    }
    await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, model: 'mock', out }) })
  })
  await useAppMode(context)
  await page.clock.setFixedTime(new Date(T))
  await page.goto(site.url)
  await bootReady(page)
  // 在日程頁按 J：卡片寫著正在看哪一頁，建議跟著那一頁換
  await page.evaluate(() => window.hiyori.ui.setTab('schedule'))
  await expect(page.locator('#fujiBtn')).toBeVisible()
  await page.keyboard.press('j')
  const sheet = page.locator('#fujiSheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('.agd-here')).toHaveText('看著：日程・今天')
  await expect(sheet.locator('.agd-hints button').first()).toHaveText('明天早上空出來')
  const input = sheet.locator('input[name="fuji"]')
  await expect(input).toBeFocused()
  await input.fill('組會改到四點，字大一點，專注 50 分鐘，再加一個每天喝 8 杯水的習慣')
  await input.press('Enter')
  // 說完之後：卡片收起來、打開習慣頁；改了的東西都生效
  await expect(sheet).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.tab)).toBe('habits')
  expect(calls).toHaveLength(1)
  expect(calls[0].data.world.here).toMatchObject({ page: 'schedule', date: ymd })
  const state = () =>
    page.evaluate(() => {
      const s = window.hiyori.store.state
      const e = s.events.find((x) => x.id === 'e2e-ev')
      return { ev: [e.start, e.end], font: s.settings.fontScale, focusMin: s.settings.focusMin, habits: s.habits.map((h) => [h.name, h.target, h.unit]), zoom: getComputedStyle(document.body).getPropertyValue('--ui-zoom').trim() }
    })
  expect(await state()).toMatchObject({ ev: ['16:00', '17:00'], font: 1.12, focusMin: 50, habits: [['喝水', 8, '杯']] })
  await expect.poll(async () => (await state()).zoom).toBe('1.12')
  await expect(page.locator('#focusTime')).toHaveText('50:00')
  // 再叫出來：剛才的對話和做了什麼都在，可以整批撤銷
  await page.keyboard.press('Control+j')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('.agd-here')).toHaveText('看著：習慣')
  await expect(sheet.locator('.ag-say').last()).toHaveText('組會改到四點了，字放大一點，專注改成 50 分鐘，也加了喝水的習慣。')
  await expect(sheet.locator('.ag-did li')).toHaveText(['新增習慣「喝水」（每天 8 杯）', '日程「組會」開始時間改成 16:00、結束時間改成 17:00', '字的大小改成大、專注一輪改成 50 分鐘'])
  await sheet.locator('[data-ag="undo"]').click()
  await toastSeen(page, '撤銷了 3 項')
  expect(await state()).toMatchObject({ ev: ['15:00', '16:00'], font: 1, focusMin: 25, habits: [] })
  await expect.poll(async () => (await state()).zoom).toBe('1')
  await expect(page.locator('#focusTime')).toHaveText('25:00')
  // Esc 收起來
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

test.describe('跨裝置的計時', () => {
  // 不註冊 Service Worker：同步的請求一律從頁面發，下面的假伺服器都攔得到（不會連到真的同步伺服器）
  test.use({ serviceWorkers: 'block' })
  test('一台開始專注，另一台跟著計時；暫停也跟著；到點由開始的那一台記、另一台跟著休息（只記一次）；那一台關掉了，另一台到點等一下就接手記，那一台再打開時換成接手的那一份、不再記一次', async ({ page, context, browser, site }) => {
    test.setTimeout(180000)
    // 假的同步伺服器（只在測試的記憶體裡）：跟真的一樣只認「對得上才寫」，內容是兩台自己加密的
    const vault = { rev: null, savedAt: 0, data: null }
    const api = async (route) => {
      const req = route.request()
      const path = new URL(req.url()).pathname
      let body = {}
      try {
        body = JSON.parse(req.postData() || '{}')
      } catch {}
      const headers = { 'Access-Control-Allow-Origin': '*' }
      if (path === '/v1/pull') {
        if (!vault.rev) return route.fulfill({ json: { rev: null }, headers })
        if (body.peek || body.have === vault.rev) return route.fulfill({ json: { rev: vault.rev, savedAt: vault.savedAt, same: true }, headers })
        return route.fulfill({ json: { rev: vault.rev, savedAt: vault.savedAt, data: vault.data }, headers })
      }
      if (path === '/v1/push') {
        if ((body.base ?? null) !== vault.rev) return route.fulfill({ status: 409, json: { error: 'conflict', rev: vault.rev }, headers })
        Object.assign(vault, { rev: body.rev, savedAt: body.savedAt, data: body.data })
        return route.fulfill({ json: { rev: body.rev }, headers })
      }
      return route.fulfill({ json: { ok: true }, headers })
    }
    const CODE = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345'
    const device = async (ctx) => {
      await noFonts(ctx)
      await ctx.route(/\/v1\//, api)
      await ctx.addInitScript((code) => {
        if (!localStorage.getItem('hiyori-cloud-code')) localStorage.setItem('hiyori-cloud-code', code)
        if (!localStorage.getItem('hiyori-layout')) localStorage.setItem('hiyori-layout', '"app"')
        const d = new Date()
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (!localStorage.getItem('hiyori-brief-day')) localStorage.setItem('hiyori-brief-day', JSON.stringify(today))
      }, CODE)
    }
    const sync = (p) => p.evaluate(() => window.hiyori.cloudSync.sync())
    // 送出去了（這台沒有還沒同步的變更）
    const sent = (p) => expect.poll(() => p.evaluate(() => window.hiyori.cloudSync.state === 'linked' && !window.hiyori.cloudSync.dirty), { timeout: 15000 }).toBe(true)
    const timer = (p) => p.evaluate(() => (({ mode, sid, endAt, paused }) => ({ mode, sid, endAt, paused }))(window.hiyori.ui.focus))
    const focusMin = (p) => p.evaluate(() => window.hiyori.store.peekDay(window.hiyori.store.today).focus || 0)
    const toast = (p, text) => p.locator('#toasts .toast', { hasText: text })

    // 電腦（A）先開、放上雲端；手機（B）用同一組同步碼，拿 A 的資料
    await device(context)
    await page.goto(site.url)
    await bootReady(page)
    await sent(page)
    const ctxB = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })
    await device(ctxB)
    const b = await ctxB.newPage()
    await b.goto(site.url)
    await bootReady(b)
    await expect.poll(() => b.evaluate(() => window.hiyori.cloudSync.state), { timeout: 15000 }).toMatch(/linked|conflict/)
    if ((await b.evaluate(() => window.hiyori.cloudSync.state)) === 'conflict') await b.evaluate(() => window.hiyori.cloudSync.resolve('remote'))
    await expect.poll(() => b.evaluate(() => window.hiyori.store.state.rev)).toBe(vault.rev)
    const base = await focusMin(page)

    // A 開始專注：B 同步之後跟著計時（同一輪），說一聲
    await page.evaluate(() => {
      const s = window.hiyori.store
      s.setSetting('focusRounds', 1)
      s.setSetting('focusUp', false)
      s.setSetting('flowMax', 0)
      window.hiyori.ui.focus.toggle()
    })
    await sent(page)
    await sync(b)
    const a1 = await timer(page)
    expect(a1.mode).toBe('focus')
    await expect.poll(() => timer(b)).toMatchObject({ mode: 'focus', sid: a1.sid, endAt: a1.endAt })
    await expect(toast(b, '另一台開始專注了')).toBeVisible()

    // B 暫停：A 跟著暫停
    await b.evaluate(() => window.hiyori.ui.focus.toggle())
    await sent(b)
    await sync(page)
    await expect.poll(async () => (await timer(page)).paused).not.toBe(null)
    await expect(toast(page, '另一台暫停了計時')).toBeVisible()

    // A 繼續、這一輪 3 秒後到點：A 記下來，B 不記、跟著休息
    await page.evaluate(() => {
      const f = window.hiyori.ui.focus
      f.toggle()
      f.endAt = Date.now() + 3000
      f._save()
    })
    await sent(page)
    await sync(b)
    await expect.poll(async () => (await timer(b)).paused).toBe(null)
    await expect.poll(async () => (await timer(page)).mode, { timeout: 15000 }).toBe('break')
    await expect.poll(async () => (await timer(b)).mode, { timeout: 20000 }).toBe('break')
    await expect(toast(b, '這一輪在另一台記下了')).toBeVisible()
    const min = await page.evaluate(() => window.hiyori.ui.focus.focusMin)
    expect(await focusMin(page)).toBe(base + Math.round(min))
    expect(await focusMin(b)).toBe(base + Math.round(min))
    expect(await b.evaluate((sid) => window.hiyori.store.state.pomoSids.filter((x) => x === sid).length, a1.sid)).toBe(1)

    // A 再開始一輪、3 秒後到點，然後 A 關掉了（筆電闔上）：B 到點等一下、同步看過沒消息，接手記下
    await page.evaluate(() => {
      const f = window.hiyori.ui.focus
      f.stop()
      f.toggle()
      f.endAt = Date.now() + 3000
      f._save()
    })
    await sent(page)
    await sync(b)
    const a2 = await timer(page)
    await expect.poll(() => timer(b)).toMatchObject({ mode: 'focus', sid: a2.sid })
    await page.close()
    // 到點後還沒過 15 秒：B 還在等
    await b.waitForTimeout(6000)
    expect((await timer(b)).mode).toBe('focus')
    await expect.poll(async () => (await timer(b)).mode, { timeout: 30000 }).toBe('break')
    expect(await focusMin(b)).toBe(base + 2 * Math.round(min))
    await sent(b)
    const bId = await b.evaluate(() => localStorage.getItem('hiyori-device'))
    expect(await b.evaluate(() => window.hiyori.store.state.timer.by)).toBe(bId)

    // A 再打開：這一輪早就到點了，先同步、換成 B 接手的那一份（休息中），不再記一次、也不會變成要選邊
    const a = await context.newPage()
    await a.goto(site.url)
    await bootReady(a)
    await expect.poll(async () => (await timer(a)).mode, { timeout: 20000 }).toBe('break')
    await a.waitForTimeout(1500)
    expect(await focusMin(a)).toBe(base + 2 * Math.round(min))
    expect(await a.evaluate((sid) => window.hiyori.store.state.pomoSids.filter((x) => x === sid).length, a2.sid)).toBe(1)
    expect(await a.evaluate(() => window.hiyori.cloudSync.state)).toBe('linked')
    expect(await b.evaluate(() => window.hiyori.cloudSync.state)).toBe('linked')
    await ctxB.close()
  })
})

test.describe('線上同步：兩台都改過', () => {
  test.use({ serviceWorkers: 'block' })
  test('一台離線時兩台各加了任務、各做完一件：連回來後自動合在一起（不用選邊），兩邊的任務和經驗值都在；可以換回合併前', async ({ page, context, browser, site }) => {
    test.setTimeout(120000)
    const vault = { rev: null, savedAt: 0, data: null }
    // A 斷線時：A 的同步請求一律連不上
    const off = { a: false }
    const api = (who) => async (route) => {
      if (off[who]) return route.abort('internetdisconnected')
      const req = route.request()
      const path = new URL(req.url()).pathname
      let body = {}
      try {
        body = JSON.parse(req.postData() || '{}')
      } catch {}
      const headers = { 'Access-Control-Allow-Origin': '*' }
      if (path === '/v1/pull') {
        if (!vault.rev) return route.fulfill({ json: { rev: null }, headers })
        if (body.peek || body.have === vault.rev) return route.fulfill({ json: { rev: vault.rev, savedAt: vault.savedAt, same: true }, headers })
        return route.fulfill({ json: { rev: vault.rev, savedAt: vault.savedAt, data: vault.data }, headers })
      }
      if (path === '/v1/push') {
        if ((body.base ?? null) !== vault.rev) return route.fulfill({ status: 409, json: { error: 'conflict', rev: vault.rev }, headers })
        Object.assign(vault, { rev: body.rev, savedAt: body.savedAt, data: body.data })
        return route.fulfill({ json: { rev: body.rev }, headers })
      }
      return route.fulfill({ json: { ok: true }, headers })
    }
    const CODE = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345'
    const device = async (ctx, who) => {
      await noFonts(ctx)
      await ctx.route(/\/v1\//, api(who))
      await ctx.addInitScript((code) => {
        if (!localStorage.getItem('hiyori-cloud-code')) localStorage.setItem('hiyori-cloud-code', code)
        if (!localStorage.getItem('hiyori-layout')) localStorage.setItem('hiyori-layout', '"app"')
        const d = new Date()
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (!localStorage.getItem('hiyori-brief-day')) localStorage.setItem('hiyori-brief-day', JSON.stringify(today))
      }, CODE)
    }
    const sent = (p) => expect.poll(() => p.evaluate(() => window.hiyori.cloudSync.state === 'linked' && !window.hiyori.cloudSync.dirty), { timeout: 15000 }).toBe(true)
    const titles = (p) => p.evaluate(() => window.hiyori.store.state.tasks.map((t) => t.title))
    const xp = (p) => p.evaluate(() => window.hiyori.store.state.player.xp)
    const addDone = (p, title) =>
      p.evaluate((t) => {
        const s = window.hiyori.store
        s.toggleTask(s.addTask({ title: t, date: s.today }).id)
      }, title)

    await device(context, 'a')
    await page.goto(site.url)
    await bootReady(page)
    await sent(page)
    const ctxB = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 820, height: 1180 } })
    await device(ctxB, 'b')
    const b = await ctxB.newPage()
    await b.goto(site.url)
    await bootReady(b)
    await expect.poll(() => b.evaluate(() => window.hiyori.cloudSync.state), { timeout: 15000 }).toMatch(/linked|conflict/)
    if ((await b.evaluate(() => window.hiyori.cloudSync.state)) === 'conflict') await b.evaluate(() => window.hiyori.cloudSync.resolve('remote'))
    await expect.poll(() => b.evaluate(() => window.hiyori.store.state.rev)).toBe(vault.rev)
    // A 也拿到 B 那一份（同一版），兩台從同一版開始
    await page.evaluate(() => window.hiyori.cloudSync.sync())
    await expect.poll(() => page.evaluate(() => window.hiyori.store.state.rev)).toBe(vault.rev)
    const xp0 = await xp(page)

    // A 斷線，加了一件、做完；B 也加了一件、做完，推上去
    off.a = true
    await addDone(page, '在 A 離線時加的')
    await expect.poll(() => page.evaluate(() => window.hiyori.cloudSync.state), { timeout: 15000 }).toBe('offline')
    const gain = (await xp(page)) - xp0
    expect(gain).toBeGreaterThan(0)
    await addDone(b, '在 B 加的')
    await sent(b)

    // A 連回來：自動合在一起，說一聲；沒有變成要選邊
    off.a = false
    await page.evaluate(() => window.hiyori.cloudSync.sync())
    await sent(page)
    await expect(page.locator('#toasts .toast', { hasText: '兩台都改過，已經合在一起了' })).toBeVisible()
    expect(await titles(page)).toEqual(expect.arrayContaining(['在 A 離線時加的', '在 B 加的']))
    expect(await xp(page)).toBe(xp0 + 2 * gain)
    // B 拿回合好的那一份
    await b.evaluate(() => window.hiyori.cloudSync.sync())
    await expect.poll(() => b.evaluate(() => window.hiyori.store.state.rev)).toBe(vault.rev)
    expect(await titles(b)).toEqual(expect.arrayContaining(['在 A 離線時加的', '在 B 加的']))
    expect(await xp(b)).toBe(xp0 + 2 * gain)
    expect(await b.evaluate(() => window.hiyori.cloudSync.state)).toBe('linked')

    // 換回合併前：A 回到自己原本那一份（B 加的不在了），設定的備份裡寫著是合併前留的
    await page.locator('#toasts .toast', { hasText: '兩台都改過' }).getByRole('button', { name: '換回合併前' }).click()
    await expect(page.locator('#toasts .toast', { hasText: '換回合併前這台的了' })).toBeVisible()
    expect(await titles(page)).toContain('在 A 離線時加的')
    expect(await titles(page)).not.toContain('在 B 加的')
    await ctxB.close()
  })
})

test('跨過午夜的日程：日程頁填 23:30 到 00:30，存成這天和隔天兩段，隔天的時間軸看得到；改開始時結束跟著挪', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  // 5 天後：沒有範例
  const [day, next] = await page.evaluate(() => {
    const s = window.hiyori.store
    const d = s.today
    const add = (n) => {
      const x = new Date(d)
      x.setDate(x.getDate() + n)
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    }
    s.selectDate(add(5))
    window.hiyori.ui.setTab('schedule')
    return [add(5), add(6)]
  })
  await page.locator('#eventTitle').fill('夜班交接')
  await page.locator('#eventStart').fill('21:00')
  await page.locator('#eventEnd').fill('22:00')
  // 開始挪到 23:30：結束跟著挪成 00:30（長度不變）
  await page.locator('#eventStart').focus()
  await page.locator('#eventStart').fill('23:30')
  await page.locator('#eventStart').dispatchEvent('change')
  await expect(page.locator('#eventEnd')).toHaveValue('00:30')
  await page.locator('#eventForm').evaluate((f) => f.requestSubmit())
  await expect.poll(() => page.evaluate(() => window.hiyori.store.state.events.filter((e) => e.title === '夜班交接').map((e) => `${e.date} ${e.start}–${e.end}`))).toEqual([`${day} 23:30–23:59`, `${next} 00:00–00:30`])
  await page.evaluate((d) => window.hiyori.store.selectDate(d), next)
  await expect(page.locator('.blk', { hasText: '夜班交接' })).toBeVisible()
  // 從隔天那段打開：面板上是整個日程（前一天 23:30 到隔天 00:30），改的也是整個日程
  await page.locator('.blk', { hasText: '夜班交接' }).locator('[data-edit]').press('Enter')
  const sheet = page.locator('#editSheet form')
  await expect(sheet.locator('[name="date"]')).toHaveValue(day)
  await expect(sheet.locator('[name="start"]')).toHaveValue('23:30')
  await expect(sheet.locator('[name="end"]')).toHaveValue('00:30')
  await expect(sheet.locator('.ec-over')).toContainText('到隔天 00:30')
  await sheet.locator('[name="end"]').fill('01:30')
  await sheet.locator('[name="end"]').dispatchEvent('change')
  await sheet.evaluate((f) => f.requestSubmit())
  await expect.poll(() => page.evaluate(() => window.hiyori.store.state.events.filter((e) => e.title === '夜班交接').map((e) => `${e.date} ${e.start}–${e.end}`).sort())).toEqual([`${day} 23:30–23:59`, `${next} 00:00–01:30`])
})

test('存不進去：上方一直留著警示列，可以馬上匯出；又存得進去時收起來', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    const real = Storage.prototype.setItem
    window.__realSet = real
    Storage.prototype.setItem = function (k, v) {
      if (k === 'hiyori-daily-v1') throw new DOMException('full', 'QuotaExceededError')
      return real.call(this, k, v)
    }
    window.hiyori.store.addTask({ title: '存不進去的任務' })
  })
  const bar = page.locator('#alerts .alert-bar')
  await expect(bar).toContainText('資料還沒存好')
  const download = page.waitForEvent('download')
  await bar.getByRole('button', { name: '匯出資料' }).click()
  expect((await download).suggestedFilename()).toMatch(/^hiyori-.*\.json$/)
  // 提示卡會自己收掉，警示列不會
  await page.waitForTimeout(4000)
  await expect(bar).toBeVisible()
  // 手機上叫出快速記錄：卡片往下讓，右上的 × 不會被警示列蓋住；Tab 轉得到警示列的「匯出資料」
  await page.setViewportSize({ width: 390, height: 844 })
  await page.keyboard.press('n')
  await expect(page.locator('#capInput')).toBeFocused()
  await expect.poll(async () => {
    const a = await bar.boundingBox()
    const x = await page.locator('#capClose').boundingBox()
    return !!a && !!x && x.y >= a.y + a.height
  }).toBe(true)
  let reached = false
  for (let i = 0; i < 20 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => !!document.activeElement?.closest('#alerts'))
  }
  expect(reached).toBe(true)
  await page.keyboard.press('Escape')
  await page.evaluate(() => (Storage.prototype.setItem = window.__realSet))
  await bar.getByRole('button', { name: '再試一次' }).click()
  await expect(bar).toHaveCount(0)
  await expect(page.locator('#toasts')).toContainText('又存得進去了')
})

test('找找看：別的頁按 / 或 Ctrl+K、點放大鏡都叫得出來；哪一天的任務都找得到，可以直接打勾、點了打開編輯面板；日程、專案也找', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  const ids = await page.evaluate(() => {
    const s = window.hiyori.store
    const add = (n) => {
      const x = new Date(s.today)
      x.setDate(x.getDate() + n)
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    }
    const old = s.addTask({ title: '報價單給陳小姐', date: add(-12) })
    const later = s.addTask({ title: '整理報價單範本', date: add(20) })
    s.addEvent({ title: '報價會議', date: add(3), start: '14:00', end: '15:00' })
    s.addProject({ name: '報價系統', milestones: ['需求'] })
    window.hiyori.ui.setTab('tasks')
    return { old: old.id, later: later.id, day: add(20) }
  })
  await page.keyboard.press('/')
  const input = page.locator('#findInput')
  await expect(input).toBeFocused()
  await input.fill('報價')
  const list = page.locator('#findList')
  await expect(list.locator('.fd-row')).toHaveCount(4)
  await expect(list.locator('.fd-h')).toHaveText(['任務', '日程', '專案'])
  // 逾期的那件排在前面，寫著逾期
  await expect(list.locator('.fd-row').first()).toContainText('報價單給陳小姐')
  await expect(list.locator('.fd-row').first()).toContainText('逾期')
  // 直接打勾：做完的那件換了位置，焦點還在同一件的勾勾上；報讀軟體念出完成了
  await list.locator('.fd-row').first().locator('[data-act="toggle"]').click()
  await expect.poll(() => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id).done, ids.old)).toBe(true)
  await expect(list.locator(`[data-key="task:${ids.old}"] [data-act="toggle"]`)).toBeFocused()
  await expect(page.locator('#findLive')).toContainText('完成了')
  // ↓ 選下一筆（選到的跟著剛勾的那件走）：念出是第幾筆、哪一筆
  await input.focus()
  await input.press('ArrowDown')
  await expect(page.locator('#findLive')).toHaveText(/^第 \d+ 筆，共 \d+ 筆：/)
  // ↓ 選第二件（還沒做的「整理報價單範本」排到前面了）、Enter 打開編輯面板，日期換到那天
  await input.fill('報價單')
  await expect(list.locator('.fd-row').first()).toContainText('整理報價單範本')
  await input.press('Enter')
  await expect(page.locator('#search')).toBeHidden()
  await expect(page.locator('#editSheet [name="title"]')).toHaveValue('整理報價單範本')
  expect(await page.evaluate(() => window.hiyori.store.selectedDate)).toBe(ids.day)
  await page.keyboard.press('Escape')
  // 日期列的放大鏡、Ctrl+K 也叫得出來；找不到時說一聲
  await page.locator('#findBtn').click()
  await expect(input).toBeFocused()
  await input.fill('沒有這種東西')
  await expect(page.locator('#findTip')).toContainText('找不到')
  // 結果很多、勾完的那件排到列得下的筆數以外：焦點回到輸入框，念出完成了
  const many = await page.evaluate(() => {
    const s = window.hiyori.store
    const ids = []
    for (let i = 0; i < 32; i++) ids.push(s.addTask({ title: `報價單草稿 ${i}` }).id)
    return ids
  })
  await input.fill('報價單草稿')
  await list.locator(`[data-key="task:${many[0]}"] [data-act="toggle"]`).click()
  await expect(input).toBeFocused()
  await expect(page.locator('#findLive')).toContainText('排到後面了')
  await page.keyboard.press('Control+k')
  await expect(page.locator('#search')).toBeHidden()
  // 生活記錄（別天的）：打開後捲到那一則、焦點也在它上面（不會回到打開找找看之前按的那一格）
  const lid = await page.evaluate(() => {
    const s = window.hiyori.store
    const x = new Date(s.today)
    x.setDate(x.getDate() - 2)
    const d = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    return s.addLife(d, { kind: 'note', text: '跨日的會議筆記' }).id
  })
  await page.keyboard.press('Control+k')
  await input.fill('跨日的會議筆記')
  await page.keyboard.press('Enter')
  await expect(page.locator('#search')).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.life-item')?.dataset.id)).toBe(lid)
})

test('逾期的任務：超過 4 件時先列最要緊的 3 件、可以展開；挑幾件一起移到明天，撤銷後回到各自原本那天', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  const dates = await page.evaluate(() => {
    const s = window.hiyori.store
    const add = (n) => {
      const x = new Date(s.today)
      x.setDate(x.getDate() + n)
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    }
    const out = {}
    for (let i = 1; i <= 6; i++) out[`逾期${i}`] = s.addTask({ title: `逾期${i}`, date: add(-i), priority: i === 5 ? 3 : 2 }).date
    window.hiyori.ui.setTab('tasks')
    return out
  })
  const box = page.locator('#overdueBox')
  await expect(box.locator('h4')).toContainText('· 6')
  await expect(box.locator('.list .item')).toHaveCount(3)
  // 優先度高的排前面
  await expect(box.locator('.list .item').first()).toContainText('逾期5')
  await box.getByRole('button', { name: /還有 3 件/ }).click()
  await expect(box.locator('.list .item')).toHaveCount(6)
  // 展開後焦點還在那顆按鈕上（換成「收起來」）
  await expect(box.locator('[data-act="odMore"]')).toBeFocused()

  await box.getByRole('button', { name: '挑幾件' }).click()
  await box.locator('label', { hasText: '逾期1' }).locator('input').check()
  await box.locator('label', { hasText: '逾期4' }).locator('input').check()
  await box.locator('label', { hasText: '逾期2' }).locator('input').check()
  // 勾好之後另一個分頁（這裡直接改）把逾期2 排到別天：不再逾期，按鈕上的件數跟著少一件
  await page.evaluate(() => {
    const s = window.hiyori.store
    s.updateTask(s.state.tasks.find((t) => t.title === '逾期2').id, { date: s.today })
  })
  await expect(box.getByRole('button', { name: /移到明天（2）/ })).toBeVisible()
  await box.getByRole('button', { name: /移到明天（2）/ }).click()
  const moved = () => page.evaluate(() => Object.fromEntries(window.hiyori.store.state.tasks.filter((t) => /^逾期[14]$/.test(t.title)).map((t) => [t.title, t.date])))
  await expect(box.locator('h4')).toContainText('· 3')
  const tomorrow = await page.evaluate(() => {
    const x = new Date(window.hiyori.store.today)
    x.setDate(x.getDate() + 1)
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  })
  expect(await moved()).toEqual({ 逾期1: tomorrow, 逾期4: tomorrow })
  await page.locator('#toasts .toast', { hasText: '2 件移到明天了' }).getByRole('button', { name: '撤銷' }).click()
  await expect.poll(moved).toEqual({ 逾期1: dates['逾期1'], 逾期4: dates['逾期4'] })
  expect(await page.evaluate(() => window.hiyori.store.state.tasks.find((t) => t.title === '逾期2').date)).toBe(await page.evaluate(() => window.hiyori.store.today))
})

test('返回鍵的邊界：前進鍵走到關掉的那一層，之後返回一次就離開；舊版留下的紀錄跳過；小島收起面板時專案不算一層', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto('about:blank')
  await page.goto(site.url)
  await bootReady(page)
  const hb = () => page.evaluate(() => history.state?.hb || 0)
  const settle = () => page.waitForTimeout(700)
  // 找找看：返回關掉，前進走到那一筆（已經關掉了）：改寫成不算一層，留在 App 裡
  await page.evaluate(() => window.hiyori.ui.openSearch())
  await expect.poll(hb).toBe(1)
  await page.evaluate(() => history.back())
  await expect(page.locator('#search')).toBeHidden()
  await page.evaluate(() => history.forward())
  await settle()
  await expect(page.locator('#search')).toBeHidden()
  expect(page.url()).toBe(site.url)
  // 返回一次就離開（不會停在多出來的那一筆）
  await page.goBack()
  await expect.poll(() => page.url()).toBe('about:blank')

  // 舊版留下的紀錄（{ hiyori: 時間 }）：更新後停在上面，開場就退回去；返回一次就離開
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    history.pushState({ hiyori: Date.now() }, '')
    history.pushState({ hiyori: Date.now() + 1 }, '')
  })
  await page.reload()
  await bootReady(page)
  await settle()
  await page.goBack()
  await expect.poll(() => page.url()).toBe('about:blank')

  // 小島模式：開著專案時收起面板，專案不算一層（紀錄跟著退）；再打開面板記回來
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => localStorage.setItem('hiyori-layout', '"island"'))
  await page.reload()
  await bootReady(page)
  const id = await page.evaluate(() => window.hiyori.store.addProject({ name: '收起面板', milestones: ['一'] }).id)
  await page.evaluate((pid) => window.hiyori.ui.openProject(pid), id)
  await expect.poll(hb).toBe(1)
  await page.evaluate(() => window.hiyori.ui.togglePanel(true))
  await expect.poll(hb).toBe(0)
  await page.evaluate(() => window.hiyori.ui.togglePanel(false))
  await expect.poll(hb).toBe(1)
})

test('返回鍵：先關最上面那一層（找找看、快速記錄打到一半的字留著），再從專案回到列表；自己按 × 關掉的不會多退一步', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  const back = () => page.evaluate(() => history.back())
  const url = page.url()
  // 找找看：返回鍵關掉
  await page.evaluate(() => window.hiyori.ui.openSearch())
  await expect(page.locator('#search')).toBeVisible()
  await back()
  await expect(page.locator('#search')).toBeHidden()
  expect(page.url()).toBe(url)
  // 快速記錄：打到一半按返回，關掉但字還在
  await page.evaluate(() => window.hiyori.ui.openCapture())
  await page.locator('#capInput').fill('打到一半的事')
  await back()
  await expect(page.locator('#capture')).toBeHidden()
  await page.evaluate(() => window.hiyori.ui.openCapture())
  await expect(page.locator('#capInput')).toHaveValue('打到一半的事')
  // 自己按 × 關掉：那一筆收回來，接下來的返回鍵不會白按一次
  await page.locator('#capClose').click()
  await expect(page.locator('#capture')).toBeHidden()
  const id = await page.evaluate(() => window.hiyori.store.addProject({ name: '返回測試', milestones: ['一'] }).id)
  await page.evaluate((pid) => window.hiyori.ui.openProject(pid), id)
  await expect(page.locator('#projectDetail')).toBeVisible()
  await back()
  await expect(page.locator('#projectDetail')).toBeHidden()
  await expect(page.locator('#projectList')).toContainText('返回測試')
  expect(page.url()).toBe(url)
  // 一口氣開關好幾層（打開專注頁、縮小、打開計時設定再關掉；退的那一下還在路上又開了一層）：紀錄跟著對好，不會退過頭離開 App
  await page.evaluate(() => {
    const f = window.hiyori.ui.focus
    f.toggle()
    f.toggleBig(false)
    f.toggleSet(true)
    f.toggleSet(false)
  })
  await expect.poll(() => page.evaluate(() => history.state?.hb || 0)).toBe(0)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => !!window.hiyori?.ui)).toBe(true)
  expect(page.url()).toBe(url)
  await page.evaluate(() => window.hiyori.ui.focus.stop?.())
  await expect.poll(() => page.evaluate(() => history.state?.hb || 0)).toBe(0)
  // 前進鍵：關掉的那一層打不回來，不會被拉回去，也不會多一筆要退
  await page.evaluate(() => window.hiyori.ui.openSearch())
  await expect(page.locator('#search')).toBeVisible()
  await back()
  await expect(page.locator('#search')).toBeHidden()
  await page.evaluate(() => history.forward())
  await expect.poll(() => page.evaluate(() => history.state?.hb ?? -1)).toBe(0)
  await page.waitForTimeout(300)
  expect(page.url()).toBe(url)
  // 重新整理之前開著幾層：重新整理後退回最底下那一筆
  await page.evaluate(() => window.hiyori.ui.openSearch())
  await page.evaluate(() => window.hiyori.ui.openCapture?.())
  expect(await page.evaluate(() => history.state?.hb)).toBeGreaterThan(0)
  await page.reload()
  await bootReady(page)
  await expect.poll(() => page.evaluate(() => history.state?.hb || 0)).toBe(0)
  await page.waitForTimeout(300)
  expect(page.url()).toBe(url)
  // 再開一層、按返回：關掉的是那一層，還在 App 裡
  await page.evaluate(() => window.hiyori.ui.openSearch())
  await expect(page.locator('#search')).toBeVisible()
  await back()
  await expect(page.locator('#search')).toBeHidden()
  expect(await page.evaluate(() => !!window.hiyori?.ui)).toBe(true)
  // 打開專案 → 切到今日總覽（專案那一筆收起來）→ 切回專案（還開著那個專案，記回一筆）→ 返回：回到列表，不會離開 App
  await page.evaluate(() => window.hiyori.ui.focus.stop?.())
  await page.evaluate((pid) => window.hiyori.ui.openProject(pid), id)
  await expect(page.locator('#projectDetail')).toBeVisible()
  await expect.poll(() => page.evaluate(() => history.state?.hb || 0)).toBe(1)
  await page.locator('.tabs [data-tab="today"]').click()
  await expect.poll(() => page.evaluate(() => history.state?.hb || 0)).toBe(0)
  await page.locator('.tabs [data-tab="projects"]').click()
  await expect(page.locator('#projectDetail')).toBeVisible()
  await expect.poll(() => page.evaluate(() => history.state?.hb || 0)).toBe(1)
  await back()
  await expect(page.locator('#projectDetail')).toBeHidden()
  expect(await page.evaluate(() => !!window.hiyori?.ui)).toBe(true)
  expect(page.url()).toBe(url)
})

test('沒接 Claude 的ふじ：除了設定通行碼，也有現在就能用的「排一週的主攻時段」「把今天的任務排進空檔」', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    window.hiyori.store.addTask({ title: '還沒排的事', dur: 30 })
    window.hiyori.ui.openAgent()
  })
  const local = page.locator('.ag-local')
  await expect(local).toContainText('不用 Claude 現在就能用')
  await local.getByRole('button', { name: '排一週的主攻時段' }).click()
  await expect(page.locator('#coachRoot input[name="say"]')).toBeVisible()
  await page.evaluate(() => window.hiyori.ui.openAgent())
  await page.locator('.ag-local').getByRole('button', { name: '把今天的任務排進空檔' }).click()
  await expect.poll(() => page.evaluate(() => window.hiyori.ui.tab)).toBe('schedule')
})

test('設定的匯入：鍵盤按得到「匯入資料」；選好檔案先列出檔案裡有什麼，按「換成這份」才換（取消、Esc 不動）；開關的名字是那一列的標題', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => window.hiyori.ui.setTab('settings'))
  // 開關報讀得出是哪一個（不是只有「開」）
  await expect(page.locator('#soundSetBtn')).toHaveAccessibleName('音效')
  await expect(page.locator('#powerBtn')).toHaveAccessibleName('省電模式')
  // 不是開關的按鈕（「看看」）名字不變
  await expect(page.locator('#newsBtn')).toHaveAccessibleName('看看')
  // 按鈕：Tab 停得到、Enter 打開選檔
  const btn = page.locator('#importBtn')
  await btn.focus()
  await expect(btn).toBeFocused()
  const file = await page.evaluate(() => {
    const s = JSON.parse(JSON.stringify(window.hiyori.store.state))
    s.tasks = [{ id: 'imp-1', title: '從備份來的任務', date: window.hiyori.store.today, priority: 2, tag: 'life', done: false }]
    return JSON.stringify(s)
  })
  const before = await page.evaluate(() => window.hiyori.store.state.tasks.length)
  const pick = async () => {
    const chooser = page.waitForEvent('filechooser')
    await btn.press('Enter')
    await (await chooser).setFiles({ name: 'hiyori-backup.json', mimeType: 'application/json', buffer: Buffer.from(file) })
  }
  await pick()
  const box = page.locator('#importCheck')
  await expect(box).toBeVisible()
  await expect(box).toContainText('hiyori-backup.json')
  await expect(box).toContainText('任務 1 件')
  await expect(box.getByRole('button', { name: '取消' })).toBeFocused()
  // 還沒換
  expect(await page.evaluate(() => window.hiyori.store.state.tasks.length)).toBe(before)
  await page.keyboard.press('Escape')
  await expect(box).toBeHidden()
  await expect(btn).toBeFocused()
  expect(await page.evaluate(() => window.hiyori.store.state.tasks.some((t) => t.id === 'imp-1'))).toBe(false)
  // 再選一次、換成這份
  await pick()
  await box.getByRole('button', { name: '換成這份' }).click()
  await expect(box).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.hiyori.store.state.tasks.map((t) => t.id))).toEqual(['imp-1'])
  // 不是存檔的檔案：直接說，不出確認
  const chooser = page.waitForEvent('filechooser')
  await btn.press('Enter')
  await (await chooser).setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') })
  await expect(page.locator('#toasts .toast', { hasText: '匯入失敗' })).toBeVisible()
  await expect(box).toBeHidden()
})

test('總覽的今日前三要務：點名稱打開那一件（看得到完整的標題、可以改），▶ 專注（鍵盤也按得到）；範例的日程也標著「範例」', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  const id = await page.evaluate(() => {
    const s = window.hiyori.store
    const t = s.addTask({ title: '把下週活動要準備的東西全部列出來，最後要通知場地方', priority: 3 })
    s.toggleStar(t.id)
    window.hiyori.ui.setTab('today')
    return t.id
  })
  const row = page.locator('.td-tops li', { hasText: '把下週活動' })
  const name = row.getByRole('button', { name: /^打開「把下週活動/ })
  await expect(name).toBeVisible()
  await name.click()
  const sheet = page.locator('#editSheet form')
  await expect(sheet.locator('[name="title"]')).toHaveValue('把下週活動要準備的東西全部列出來，最後要通知場地方')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  const play = row.getByRole('button', { name: /^專注在「把下週活動/ })
  await play.focus()
  await expect(play).toBeFocused()
  // 範例的日程（第一次打開時放的）：行程上標著「範例」
  const ex = await page.evaluate(() => window.hiyori.store.eventsOn(window.hiyori.store.today).some((e) => window.hiyori.store.isSample(e)))
  if (ex) await expect(page.locator('.td-sched .td-evc .ex-tag').first()).toBeVisible()
  expect(id).toBeTruthy()
})
