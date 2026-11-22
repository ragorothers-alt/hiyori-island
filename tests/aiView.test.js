import { expect, it } from 'vitest'
import { AiView } from '../src/ui/ai.js'

it('還沒接上 Claude 時，看得懂通行碼要去哪拿、可以怎麼跟ふじ說；自己架設的做法先收起來', () => {
  localStorage.clear()
  const parts = {
    '.ai-info': {}, '.sync-dot': { dataset: {} }, '.ai-panel': {}, '.ai-btns': {},
  }
  const row = { querySelector: (key) => parts[key], addEventListener() {} }
  const view = new AiView(row, {})

  for (const edit of [false, true]) {
    if (edit) view._edit(true)
    const info = parts['.ai-info'].innerHTML
    expect(info).toContain('通行碼是讓ふじ接上 Claude')
    expect(info).toContain('幫你架好這個 App 的人')
    expect(info).toContain('幫我排明天')
    expect(info).toContain('撤銷')
    expect(info).not.toMatch(/Worker|API_PASS|AI_PASS|wrangler|Console/i)
  }

  const panel = parts['.ai-panel'].innerHTML
  expect(panel).toMatch(/<details class="ai-how"><summary>進階/)
  expect(panel).toMatch(/<details[^>]*>[\s\S]*npx wrangler@4 secret put AI_PASS[\s\S]*<\/details>/)
  expect(panel).toContain('aria-label="Claude 通行碼"')
})
