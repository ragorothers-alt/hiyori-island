import { describe, expect, it } from 'vitest'
import { markHTML, queryTerms, searchProjects, snippet } from '../src/projectSearch.js'

const proj = (name, more = {}) => ({ id: name, name, goal: '', milestones: [], notes: [], logs: [], ...more })
const ms = (title, more = {}) => ({ id: title, title, done: false, note: '', steps: [], ...more })
const names = (r) => r.map((x) => x.p.name)

describe('專案的快捷搜尋', () => {
  const list = [
    proj('搬家', { milestones: [ms('打包紙箱', { steps: [{ id: 's', title: '買膠帶', done: false }] })] }),
    proj('日文檢定 N2', { milestones: [ms('單字'), ms('模擬考', { note: '每週六早上一回' })], goal: '十二月考過' }),
    proj('期末報告', { notes: [{ id: 'n', title: '參考資料', body: '圖書館的期刊\n還有老師給的 PDF' }], logs: [{ id: 'l', text: '寫完第一章的初稿' }] }),
    proj('作品集 App', { milestones: [ms('首頁版型')] }),
  ]

  it('沒打字（或只有空白）回傳 null；關鍵字照空白拆開、重複的算一個', () => {
    expect(searchProjects(list, '')).toBeNull()
    expect(searchProjects(list, '   ')).toBeNull()
    expect(queryTerms('  模擬  模擬 考 ')).toEqual(['模擬', '考'])
  })

  it('名稱、里程碑、細項、里程碑備註、目標、筆記、進度都找得到，並說是在哪裡找到的', () => {
    const one = (q) => {
      const r = searchProjects(list, q)
      expect(r).toHaveLength(1)
      return r[0]
    }
    expect(one('搬家')).toMatchObject({ p: { name: '搬家' }, hit: null })
    expect(one('紙箱').hit).toEqual({ kind: '里程碑', text: '打包紙箱' })
    expect(one('膠帶').hit).toEqual({ kind: '細項', text: '買膠帶' })
    expect(one('週六').hit.kind).toBe('里程碑備註')
    expect(one('十二月').hit).toEqual({ kind: '目標', text: '十二月考過' })
    expect(one('期刊').hit).toEqual({ kind: '筆記', text: '圖書館的期刊 還有老師給的 PDF' })
    expect(one('初稿').hit).toEqual({ kind: '進度', text: '寫完第一章的初稿' })
  })

  it('不分大小寫和全形半形；幾個字都要在同一個專案裡找得到（可以分在不同地方）', () => {
    expect(names(searchProjects(list, 'app'))).toEqual(['作品集 App'])
    expect(names(searchProjects(list, 'ＡＰＰ'))).toEqual(['作品集 App'])
    expect(names(searchProjects(list, 'n2'))).toEqual(['日文檢定 N2'])
    expect(names(searchProjects(list, 'pdf'))).toEqual(['期末報告'])
    const r = searchProjects(list, '日文 模擬')
    expect(names(r)).toEqual(['日文檢定 N2'])
    // 名稱沒有的那個字在哪裡找到
    expect(r[0].hit).toEqual({ kind: '里程碑', text: '模擬考' })
    expect(searchProjects(list, '日文 紙箱')).toEqual([])
  })

  it('名稱裡找到的排在前面，名稱整個對上的最前面；同分照原本的順序', () => {
    const l = [proj('寫程式', { milestones: [ms('讀書會')] }), proj('讀書計畫'), proj('讀書'), proj('英文', { notes: [{ id: 'n', title: '', body: '讀書筆記' }] })]
    expect(names(searchProjects(l, '讀書'))).toEqual(['讀書', '讀書計畫', '寫程式', '英文'])
    const same = [proj('A 專案'), proj('B 專案'), proj('C 專案')]
    expect(names(searchProjects(same, '專案'))).toEqual(['A 專案', 'B 專案', 'C 專案'])
  })

  it('很長的筆記從找到的地方前後截一段，頭尾加「…」', () => {
    const body = '前言'.repeat(30) + '這裡有關鍵字可以找' + '結尾'.repeat(30)
    const s = snippet(body, ['關鍵字'])
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    expect(s).toContain('關鍵字')
    expect(Array.from(s.replace(/…/g, ''))).toHaveLength(40)
    expect(snippet('短短的', ['短'])).toBe('短短的')
    // 一開頭就找到：前面不加
    expect(snippet('關鍵字' + '字'.repeat(60), ['關鍵字']).startsWith('關鍵字')).toBe(true)
  })

  it('標記：先跳脫 HTML 再包 <mark>，全形和表情符號也對得上原文', () => {
    expect(markHTML('<b>讀書</b> & 讀書會', ['讀書'])).toBe('&lt;b&gt;<mark>讀書</mark>&lt;/b&gt; &amp; <mark>讀書</mark>會')
    expect(markHTML('作品集 ＡＰＰ', ['app'])).toBe('作品集 <mark>ＡＰＰ</mark>')
    expect(markHTML('🏠搬家🏠', ['搬家'])).toBe('🏠<mark>搬家</mark>🏠')
    // 重疊的併成一段
    expect(markHTML('模擬考試', ['模擬考', '考試'])).toBe('<mark>模擬考試</mark>')
    expect(markHTML('沒有', [])).toBe('沒有')
  })
})
