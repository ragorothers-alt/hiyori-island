// App 模式的主要流程：ふじ排的計畫套用、撤銷；專案搜尋；平板上專案的任務欄；練習曲的速度；番茄鐘計時重新整理後接著算；專注頁的貓咪
import { bootReady, chatSaid, expect, swReady, test, toastSeen, useAppMode } from './fixtures.js'

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

test('專案搜尋：按 / 跳到搜尋框，里程碑也找得到；Esc 清掉字，Enter 打開第一個', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await page.evaluate(() => {
    const s = window.hiyori.store
    const list = [['期末報告', ['找資料', '寫初稿']], ['搬家', ['打包紙箱']], ['日文檢定', ['單字', '模擬考 N2']], ['健身計畫', ['深蹲']], ['作品集網站', ['首頁版型']]]
    for (const [name, milestones] of list) s.addProject({ name, milestones })
  })
  const q = page.locator('#projectQuery')
  // 從總覽頁按 / ：切到專案、游標在搜尋框
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

  // Ctrl+K 也叫得出來；Enter 打開第一個結果的詳情
  await q.evaluate((el) => el.blur())
  await page.keyboard.press('Control+k')
  await expect(q).toBeFocused()
  await q.fill('搬家')
  await q.press('Enter')
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

    // 設定裡「現在看」再看一次，Esc 關掉；關掉開關後，隔天也不出來
    await page.evaluate(() => window.hiyori.ui.setTab('records'))
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
    await page.evaluate(() => window.hiyori.ui.setTab('records'))
    await page.locator('#briefBtn').click()
    await expect(page.locator('#briefBtn')).toHaveText('關')
    await page.evaluate(() => localStorage.removeItem('hiyori-brief-day'))
    await page.reload()
    await bootReady(page)
    await page.waitForTimeout(2500)
    expect(await page.evaluate(() => window.hiyori.ui.brief.open)).toBe(false)
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
    // 同一天再看一次：這一段還在
    await page.evaluate(() => window.hiyori.ui.setTab('records'))
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
  const count = () => page.evaluate(() => ({ tasks: window.hiyori.store.state.tasks.length, events: window.hiyori.store.state.events.length, life: (window.hiyori.store.state.life[window.hiyori.store.today]?.items || []).length }))
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

test('檢視進度：總覽有這週每天做完幾件，點「看週報」到教練的週報；紀錄頁最上面一排直接跳到設定；分頁各自記住捲到哪', async ({ page, context, site }) => {
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

  // 紀錄頁：設定在好幾個畫面底下，最上面那一排點了就到
  await page.locator('#tab-records').click()
  const nav = page.locator('#recNav')
  await expect(nav.locator('button').first()).toHaveText('設定')
  await expect(nav.locator('button', { hasText: '最近七天' })).toBeVisible()
  const title = page.locator('[data-page="records"] h3.sec-title', { hasText: '設定' })
  await expect(title).not.toBeInViewport()
  await nav.locator('button.set').click()
  await expect(title).toBeInViewport()
})

test('番茄鐘：到點了還沒做完可以延長（從到點那時接著正計時，多做的分鐘記進去）；輪數做完了可以再加一輪、休息完再來一輪', async ({ page, context, site }) => {
  // 步驟多、中間重新整理一次：同時跑很多個測試、機器很忙時一個動作要一秒
  test.setTimeout(120000)
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
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
  await expect(page.locator('.toast-acts .toast-act')).toHaveText(['還沒做完，延長', '再加一輪'])

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
  await expect(page.locator('.toast-acts')).toHaveCount(0)
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
  await expect(page.locator('.toast-acts')).toHaveCount(0)

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
  await expect(page.locator('.toast-acts')).toHaveCount(0)
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
  const subsOf = (id) => page.evaluate((id) => window.hiyori.store.state.tasks.find((t) => t.id === id).subs.map((x) => `${x.done ? '✓' : '・'}${x.title}`), id)
  const id = await page.evaluate(() => {
    const s = window.hiyori.store
    s.setSetting('focusRounds', 1)
    s.setSetting('focusUp', false)
    const t = s.addTask({ title: '寫期末報告', date: s.today })
    s.addSub(t.id, '找三篇參考資料')
    s.addSub(t.id, '寫大綱')
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
  const holds = () => page.evaluate(() => window.hiyori.store.peekDay(window.hiyori.store.today).holds || 0)
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
  // Esc：只收起來（不算忍住），專注頁還開著
  await btn.click()
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
  await expect.poll(welcomes).toBe(1)
  await expect(page.locator('#toasts .toast', { hasText: '歡迎回來' })).toContainText('現在該做：寫期末報告')
  // 睡覺時間（預設 23:00 就寢）：不說
  await away('18:31:00', '23:40:00')
  await page.waitForTimeout(1500)
  expect(await welcomes()).toBe(1)
})

test('專注時的背景聲：計時設定、專注頁右上的耳機都可以選；只在專注中放，暫停、休息、結束時停；音效關著不放；Esc 先收選單', async ({ page, context, site }) => {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  const T = (hms) => new Date(`${ymd}T${hms}+08:00`)
  await useAppMode(context)
  await page.clock.setFixedTime(T('10:00:00'))
  await page.goto(site.url)
  await bootReady(page)
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
test.describe('手機的觸控', () => {
  test.use({ hasTouch: true, viewport: { width: 393, height: 852 } })
  test('任務列左右滑：往右滑完成、往左滑明天再做（可以復原）、逾期的往左滑移到今天；滑一點點會彈回去', async ({ page, context, site }) => {
    await useAppMode(context)
    await page.goto(site.url)
    await bootReady(page)
    await page.evaluate(() => {
      const s = window.hiyori.store
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
    await row('五').locator('[data-act="star"]').tap()
    await expect.poll(buzz).toEqual([8, 8, 8, [24, 50, 24]])

    // 設定裡關掉：打勾不再震；這台裝置記住了，重新整理也一樣
    await page.evaluate(() => window.hiyori.ui.setTab('records'))
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
    await page.evaluate(() => window.hiyori.ui.setTab('records'))
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
    await expect(page.locator('#toasts .toast')).toHaveCount(0, { timeout: 15000 })
    await page.evaluate(() => {
      window.__ptr = []
      for (const t of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(t, (e) => window.__ptr.push(e.type), true)
      window.hiyori.ui.toast({ icon: '試', title: '有按鈕的提示', ms: 4000, actions: [{ label: '好', run: () => (window.__ran = true) }] })
    })
    const card = page.locator('#toasts .toast', { hasText: '有按鈕的提示' })
    const btn = card.locator('.toast-act')
    const b = await btn.boundingBox()
    const x = b.x + b.width / 2
    const y = b.y + b.height / 2
    // 開場畫面讓開、手指真的按得到按鈕
    await expect.poll(() => page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.toast-act'), [x, y])).toBe(true)
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
    await page.evaluate(() => window.hiyori.ui.setTab('records'))
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
    window.hiyori.ui.setTab('records')
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

  // 10:05 又離開：再交一次；回來（下一則還久）關掉系統通知：伺服器上排著的取消、快取裡的字拿掉
  await page.clock.setFixedTime(new Date(T + 5 * 60000))
  await leave(true)
  await expect.poll(() => mottoCalls().length).toBe(3)
  expect(mottoCalls()[2].body.after[0]).toBe(10 * 60000)
  await leave(false)
  await page.waitForTimeout(1500)
  expect(mottoCalls()).toHaveLength(3)
  await page.evaluate(() => window.hiyori.ui.setTab('schedule'))
  await page.locator('#notifyBtn').click()
  await expect.poll(() => mottoCalls().length).toBe(4)
  expect(mottoCalls()[3].body.after).toBeNull()
  await expect.poll(() => file('__motto-plan')).toEqual([])
  await page.evaluate(() => window.hiyori.ui.setTab('records'))
  await expect(page.locator('#mottoRoot .mt-reach')).toContainText('現在只在看著這一頁時提醒')
  // 按了先停的那一刻：念到哪推到現在（已經到點、推播還在路上的那幾則晚到時，Service Worker 當成念過了、不出聲）
  expect(await file('__motto-done')).toEqual({ at: T })
  await page.evaluate(() => window.hiyori.store.setSetting('mottoPause', Date.now() + 3600000))
  await expect.poll(() => file('__motto-done')).toEqual({ at: T + 5 * 60000 })
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