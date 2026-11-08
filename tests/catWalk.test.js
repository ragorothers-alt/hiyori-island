import { describe, expect, it } from 'vitest'
import {
  COATS, COAT_IDS, coatOfDay, createCat, stepCat, poseOf, pokeCat, hoverCat, leaveCat, comeBack, placeCat, setBounds, sleepiness, depth,
  bodyPath, legPath, tailPoints, smoothPath, stripesPath, POSES,
} from '../src/catWalk.js'

const BOUNDS = { w: 900, h: 700, top: 560, bottom: 680, k: 1 }
const focus = (min, more = {}) => ({ mode: 'focus', paused: false, focusMs: min * 60000, ...more })
// 跑 sec 秒（每格 1/30 秒）；ctx 可以是函式（每一格的時間 → 狀態）
function run(cat, sec, ctx, each) {
  const dt = 1 / 30
  for (let i = 0; i < sec * 30; i++) {
    stepCat(cat, dt, typeof ctx === 'function' ? ctx(cat.time) : ctx)
    each?.(cat)
  }
}
const fresh = (seed = 7, ctx = focus(0)) => {
  const cat = createCat({ seed, coat: 'mike', bounds: BOUNDS })
  placeCat(cat, ctx)
  return cat
}
const noNaN = (s) => !/NaN|Infinity|undefined/.test(s)

describe('專注頁的貓咪：要做什麼', () => {
  it('同一個種子走出同一條路', () => {
    const a = fresh(42)
    const b = fresh(42)
    run(a, 120, focus(1))
    run(b, 120, focus(1))
    expect([a.x, a.y, a.act.kind]).toEqual([b.x, b.y, b.act.kind])
  })

  it('剛開始專注：先從畫面外走進來；之後不管走多久都待在地板上（偶爾散步出畫面再回來）', () => {
    const cat = fresh(3)
    expect(cat.away).toBe(true)
    run(cat, 1.5, focus(0))
    expect(cat.away).toBe(false)
    expect(cat.act.kind).toBe('enter')
    let min = Infinity
    let max = -Infinity
    run(cat, 600, (t) => focus(t / 60), (c) => {
      if (c.away) return
      expect(c.y).toBeGreaterThanOrEqual(BOUNDS.top - 1e-6)
      expect(c.y).toBeLessThanOrEqual(BOUNDS.bottom + 1e-6)
      if (!['enter', 'exit', 'turn'].includes(c.act.kind)) {
        min = Math.min(min, c.x)
        max = Math.max(max, c.x)
      }
    })
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThanOrEqual(BOUNDS.w)
  })

  it('專注越久越想睡：前幾分鐘多半醒著，十幾分鐘後大多在睡覺或趴著', () => {
    let early = 0
    let late = 0
    let n = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const cat = fresh(seed)
      run(cat, 25 * 60, (t) => focus(t / 60), (c) => {
        const calm = c.act.kind === 'sleep' || c.act.kind === 'loaf'
        if (c.time < 120) early += calm ? 1 : 0
        else if (c.time > 15 * 60) late += calm ? 1 : 0
      })
      n++
    }
    // 前兩分鐘：大多醒著（走進來、走走、坐坐）
    expect(early / (n * 120 * 30)).toBeLessThan(0.3)
    // 十五分鐘以後：大部分時間在睡
    expect(late / (n * 10 * 60 * 30)).toBeGreaterThan(0.6)
  })

  it('打開專注頁時已經專注很久了：貓直接在地板上睡著，不從旁邊走進來', () => {
    const cat = fresh(5, focus(20))
    expect(cat.away).toBe(false)
    expect(cat.act.kind).toBe('sleep')
    expect(cat.y).toBeGreaterThanOrEqual(BOUNDS.top)
  })

  it('暫停：睡著的會醒來，然後坐著看你；繼續後就不再一直看著你', () => {
    const cat = fresh(5, focus(20))
    run(cat, 2, focus(20))
    run(cat, 3, focus(20, { paused: true }))
    expect(cat.act.kind).toBe('look')
    expect(cat.faceT).toBe(0)
    run(cat, 30, focus(20, { paused: true }))
    expect(cat.act.kind).toBe('look')
    run(cat, 1, focus(20))
    expect(cat.act.kind).not.toBe('look')
  })

  it('開始休息：伸個懶腰（睡著的先醒來），休息時不睡、比較好動', () => {
    const cat = fresh(9, focus(20))
    run(cat, 3, focus(20))
    const seen = new Set()
    run(cat, 4, { mode: 'break' }, (c) => seen.add(c.act.kind))
    expect(seen.has('stretch')).toBe(true)
    const kinds = new Set()
    run(cat, 300, { mode: 'break' }, (c) => kinds.add(c.act.kind))
    expect(kinds.has('sleep')).toBe(false)
    expect(kinds.has('walk') || kinds.has('trot')).toBe(true)
  })

  it('點牠：醒著會喵一聲、看著你；三秒內點三下會呼嚕；睡著的有時只動耳朵，有時醒來', () => {
    const cat = fresh(11)
    run(cat, 20, focus(0.5))
    while (cat.away || ['turn', 'leap', 'enter', 'exit'].includes(cat.act.kind)) run(cat, 0.5, focus(0.5))
    cat.events.length = 0
    expect(pokeCat(cat)).toBe('meow')
    expect(cat.act.kind).toBe('look')
    expect(cat.mood).toBe('happy')
    expect(cat.events[0]).toMatchObject({ type: 'say' })
    pokeCat(cat)
    expect(pokeCat(cat)).toBe('purr')
    expect(cat.events.some((e) => e.type === 'heart')).toBe(true)

    const sleepy = fresh(12, focus(20))
    const got = new Set()
    for (let i = 0; i < 12; i++) {
      run(sleepy, 4, focus(20))
      if (sleepy.act.kind === 'sleep') got.add(pokeCat(sleepy))
      run(sleepy, 4, focus(20))
      while (sleepy.act.kind !== 'sleep') run(sleepy, 1, focus(20))
    }
    expect(got.has('twitch')).toBe(true)
    expect(got.has('wake')).toBe(true)
  })

  it('滑鼠移到牠身上：停下來看你，移開後過一下又自己去玩', () => {
    const cat = fresh(13)
    // 等牠走進來、在地板上走動或坐著
    while (!['walk', 'stand', 'sit'].includes(cat.act.kind)) run(cat, 0.2, focus(0))
    hoverCat(cat, true)
    run(cat, 0.2, focus(0))
    expect(cat.act.kind).toBe('look')
    const x = cat.x
    run(cat, 5, focus(0))
    expect(cat.act.kind).toBe('look')
    expect(cat.x).toBe(x)
    hoverCat(cat, false)
    run(cat, 1.2, focus(0))
    expect(cat.act.kind).not.toBe('look')
  })

  it('關掉貓咪：小跑步離開畫面後就不再回來；再打開又會走回來', () => {
    const cat = fresh(17, focus(20))
    leaveCat(cat)
    run(cat, 40, focus(20))
    expect(cat.away).toBe(true)
    run(cat, 60, focus(20))
    expect(cat.away).toBe(true)
    comeBack(cat)
    run(cat, 1, focus(20))
    expect(cat.away).toBe(false)
  })

  it('才剛請牠離開（還在轉身）又請牠回來：不會照原本排好的走出畫面', () => {
    const cat = fresh(23)
    while (cat.away || cat.act.kind !== 'stand' && cat.act.kind !== 'sit') run(cat, 0.2, focus(0.5))
    // 讓牠面向畫面中間，離開時一定要先轉身
    cat.dir = cat.x < BOUNDS.w / 2 ? 1 : -1
    leaveCat(cat)
    expect(cat.act.kind).toBe('turn')
    comeBack(cat)
    expect(cat.queue.some(([k]) => k === 'exit')).toBe(false)
    // 轉完身就照平常的心情走動，不會往外走
    run(cat, 1, focus(0.5))
    expect(cat.act.kind).not.toBe('exit')
    expect(cat.away).toBe(false)
  })

  it('要撲過去時視窗變窄：落點跟著收回新的地板', () => {
    const cat = fresh(29, { mode: 'break' })
    for (let i = 0; i < 4000 && cat.act.kind !== 'crouch'; i++) stepCat(cat, 1 / 30, { mode: 'break' })
    expect(cat.act.kind).toBe('crouch')
    setBounds(cat, { w: 300, h: 700, top: 560, bottom: 680, k: 0.8 })
    const leap = cat.queue.find(([k]) => k === 'leap')
    expect(leap[1].tx).toBeLessThanOrEqual(300)
    run(cat, 3, { mode: 'break' })
    expect(cat.x).toBeLessThanOrEqual(300)
  })

  it('減少動態效果：不走動，原地睡著；點了抬頭看你，過一下又睡回去', () => {
    const cat = createCat({ seed: 1, coat: 'kuro', bounds: BOUNDS, still: true })
    placeCat(cat, focus(0))
    expect(cat.away).toBe(false)
    expect(cat.act.kind).toBe('sleep')
    const x = cat.x
    run(cat, 120, focus(1))
    expect(cat.x).toBe(x)
    expect(cat.act.kind).toBe('sleep')
    expect(cat.events.filter((e) => e.type === 'z')).toHaveLength(0)
    pokeCat(cat)
    expect(cat.act.kind).toBe('look')
    run(cat, 3, focus(1))
    expect(cat.act.kind).toBe('sleep')
    run(cat, 1, focus(1, { paused: true }))
    expect(cat.act.kind).toBe('look')
    // 請牠離開：不跑步，直接收起來；回來時一樣在原地
    leaveCat(cat)
    expect(cat.away).toBe(true)
    comeBack(cat)
    run(cat, 1, focus(1))
    expect(cat.away).toBe(false)
    expect(cat.x).toBe(x)
    expect(cat.act.kind).toBe('sleep')
  })

  it('地板變小（轉向、卡片變高）：貓和牠要去的地方都收回新的地板上', () => {
    const cat = fresh(21)
    run(cat, 20, focus(0.5))
    while (cat.away) run(cat, 0.5, focus(0.5))
    setBounds(cat, { w: 400, h: 800, top: 700, bottom: 760, k: 0.8 })
    expect(cat.y).toBeGreaterThanOrEqual(700)
    expect(cat.y).toBeLessThanOrEqual(760)
    run(cat, 120, focus(1), (c) => {
      if (!c.away) expect(c.y).toBeLessThanOrEqual(760 + 1e-6)
    })
  })

  it('睏的程度：專注兩分鐘後開始變睏，最多 0.9；休息和暫停時不睏', () => {
    expect(sleepiness(focus(1))).toBe(0)
    expect(sleepiness(focus(9))).toBeCloseTo(0.5)
    expect(sleepiness(focus(60))).toBe(0.9)
    expect(sleepiness(focus(60, { paused: true }))).toBe(0)
    expect(sleepiness({ mode: 'break', focusMs: 3600000 })).toBe(0)
  })
})

describe('專注頁的貓咪：畫出來的形狀', () => {
  it('每天一隻，同一天一樣；毛色都有齊全的顏色', () => {
    expect(coatOfDay('2026-11-08')).toBe(coatOfDay('2026-11-08'))
    const week = new Set(Array.from({ length: 14 }, (_, i) => coatOfDay(`2026-11-${String(i + 1).padStart(2, '0')}`)))
    expect(week.size).toBeGreaterThanOrEqual(4)
    for (const id of COAT_IDS) {
      for (const k of ['name', 'fur', 'shade', 'ol', 'oln', 'lid', 'line', 'eye', 'nose', 'inner', 'whisk']) expect(COATS[id][k], `${id}.${k}`).toBeTruthy()
      expect(COAT_IDS).toContain(coatOfDay(`2026-01-${id.length + 10}`))
    }
  })

  it('每個姿勢、走路的每一步都畫得出來（路徑沒有 NaN）', () => {
    const cat = fresh(31)
    let frames = 0
    run(cat, 600, (t) => (t < 400 ? focus(t / 60) : { mode: 'break' }), (c) => {
      if (c.away || frames++ % 7) return
      const P = poseOf(c)
      expect(noNaN(bodyPath(P.hip, P.chest))).toBe(true)
      for (const L of P.legs) expect(noNaN(legPath(L.j, L.p, 24, L.fore))).toBe(true)
      expect(noNaN(smoothPath(P.tail))).toBe(true)
      expect(noNaN(stripesPath(P.hip, P.chest))).toBe(true)
      expect(Number.isFinite(P.s) && P.s > 0).toBe(true)
      expect(Math.abs(P.flip)).toBeGreaterThan(0.1)
    })
  })

  it('走路時踩在地上的腳掌不會滑：身體往前走多少，那隻腳掌就往後退多少', () => {
    const cat = fresh(41)
    // 走進畫面的路上，步伐已經完全換成走路
    run(cat, 3, focus(0))
    expect(cat.act.kind).toBe('enter')
    expect(cat.gaitW).toBeGreaterThan(0.999)
    const before = poseOf(cat)
    const [x0, y0] = [cat.x, cat.y]
    stepCat(cat, 1 / 60, focus(0))
    const after = poseOf(cat)
    const moved = Math.hypot(cat.x - x0, cat.y - y0) / (cat.k * depth(cat))
    // 找一隻兩格都踩在地上的腳
    const i = before.legs.findIndex((L, n) => L.p[1] === 0 && after.legs[n].p[1] === 0)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(after.legs[i].p[0] - before.legs[i].p[0]).toBeCloseTo(-moved, 2)
  })

  it('身體：兩顆圓包起來；一顆包住另一顆時就是那一顆圓', () => {
    const d = bodyPath([-20, -27, 15], [14, -29, 16.5])
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect((d.match(/A/g) || []).length).toBe(2)
    expect(bodyPath([0, 0, 20], [2, 1, 5])).toBe('M-20 0A20 20 0 1 0 20 0A20 20 0 1 0 -20 0Z')
  })

  it('尾巴不會穿到地板下面；腳縮短時膝蓋往外彎', () => {
    for (const p of Object.values(POSES)) {
      const pts = tailPoints([p.hip[0] + p.tb[0] * p.hip[2], p.hip[1] + p.tb[1] * p.hip[2]], p.tail[0], p.tail[1], 20, 1.3)
      for (const [, y] of pts.slice(1)) expect(y).toBeLessThan(0)
    }
    // 直直往下、比原本短：前腳往前（+x）彎，後腳往後（−x）彎
    const ctrlX = (d) => +d.split('Q')[1].split(' ')[0]
    expect(ctrlX(legPath([0, -20], [0, 0], 24, true))).toBeGreaterThan(0)
    expect(ctrlX(legPath([0, -20], [0, 0], 24, false))).toBeLessThan(0)
    expect(ctrlX(legPath([0, -30], [0, 0], 24, true))).toBe(0)
  })
})
