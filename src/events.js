// store 發出的事件，名稱集中在這裡。發的一方（store.js 的 emit 和 fx）和聽的一方（store.on）都只用這裡有的名字；
// tests/events.test.js 會掃過原始碼對一遍：拼錯、或改了一邊忘了另一邊，測試就會失敗
// （不然只是慶祝動畫或音效靜靜地不見，不會有任何錯誤）。值是給人看的說明
export const EVENTS = {
  // ── 存檔、同步、日期 ──
  change: '資料變了：介面和小島重畫',
  dirty: '使用者改了資料：同步要推上去',
  reload: '整份資料換掉了（匯入、同步拉回、另一個分頁存的）',
  dateChanged: '看的日期換了（或跨日）',
  saveFailed: '存不進去（多半是瀏覽器空間滿了）',
  saveRecovered: '又存得進去了',

  // ── 任務與本命 ──
  taskAdded: '新增任務',
  taskDone: '任務完成',
  taskUndone: '任務取消完成',
  taskDeleted: '任務刪掉',
  taskSplit: '任務拆成三小步',
  taskScheduled: '任務排進時段',
  starPicked: '選了本命',
  starFull: '本命已經選滿',
  starDone: '本命完成',
  starAll: '本命全清',
  allDone: '今天的任務全部完成',
  tired: '今天完成很多件了（之後經驗減半）',
  revive: '逾期垂下的花補完成又開了',
  flower: '開了一朵花（圖鑑）',
  routineAdded: '設成例行任務／日程',

  // ── 日程、作息、排程 ──
  eventAdded: '新增日程',
  eventDone: '日程完成',
  rhythmChanged: '作息設定改了',
  planApplied: '套用最佳化時程',
  coachApplied: '套用ふじ排的計畫',
  coachUndone: '撤銷ふじ排的計畫',
  dateAdded: '新增重要日子',
  sleepLogged: '記下睡眠',

  // ── 專注 ──
  pomodoro: '完成一輪專注',

  // ── 習慣與生活記錄 ──
  habitAdded: '新增習慣',
  habitCheck: '習慣打卡（加或減）',
  habitDone: '習慣今天達標',
  habitAll: '今天的養成習慣全部完成',
  habitSlip: '戒除的習慣破功了',
  urgeResisted: '忍住了一次想做的衝動',
  quitMilestone: '戒除滿一個里程碑',
  lifeLogged: '記下一筆生活記錄',
  reviewSaved: '寫完今天的回顧',

  // ── 專案 ──
  projectAdded: '新增專案',
  projectLogged: '寫了專案的進度',
  projectDone: '專案落成',
  projectOnTime: '專案在期限前落成',
  milestoneDone: '里程碑完成',
  milestoneUndone: '里程碑取消完成',
  noteSaved: '專案筆記存好（打字時的自動儲存）',

  // ── 經驗值、等級、成就、任務獎勵 ──
  xp: '拿到經驗值（和金平糖）',
  levelUp: '升級',
  achievement: '解鎖成就',
  questProgress: '每日任務有進度',
  questReady: '每日任務達成、可以領',
  questClaimed: '領了每日任務的獎勵',
  weeklyReady: '每週挑戰達成、可以領',
  weeklyClaimed: '領了每週挑戰的獎勵',

  // ── もち和ふじ ──
  bondUp: '好感度升級',
  gift: 'ふじ每天第一次送金平糖',
  outfit: '換了衣裝',

  // ── 商店、擺飾、お守り ──
  itemPlaced: '擺好一件裝飾',
  itemMoved: '移動裝飾',
  itemStored: '收起裝飾（退一半）',
  shopPoor: '金平糖不夠',
  charmBought: '買了お守り',
  charmUsed: 'お守り保住了連續天數',

  // ── ひより町與專案町 ──
  townGrow: '小鎮的店長大一階',
  townMoveIn: '居民搬進小鎮',
  townWelcome: '小鎮升級換了稱號',
  projectTownGrew: '專案町升級（地變多，島可能變大）',
}

export const isEvent = (type) => Object.hasOwn(EVENTS, type)
