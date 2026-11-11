// App 模式的主要流程：ふじ排的計畫套用、撤銷；專案搜尋；平板上專案的任務欄；練習曲的速度；番茄鐘計時重新整理後接著算；專注頁的貓咪
import { bootReady, expect, swReady, test, useAppMode } from './fixtures.js'

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
  const morning = (page) => page.clock.setFixedTime(new Date(new Date().setHours(10, 0, 0, 0)))

  test('每天第一次打開：貓咪走進來說今天有什麼；點一項跳過去；重新整理不再出來；設定裡可以再看、可以關掉', async ({ page, context, site }) => {
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