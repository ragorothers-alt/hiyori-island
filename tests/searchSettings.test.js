import { afterEach, expect, it, vi } from 'vitest'
import { settingsMethods } from '../src/ui/settingsPage.js'

afterEach(() => vi.unstubAllGlobals())

it('這台不能連資料夾時，搜尋還是有一列可以到，裡面說明原因', () => {
  const elements = new Map()
  vi.stubGlobal('document', { querySelector(id) {
    if (!elements.has(id)) elements.set(id, { dataset: {} })
    return elements.get(id)
  } })
  settingsMethods.renderSync.call({ sync: { state: 'unsupported' } })
  expect(elements.get('#syncRow')?.hidden).toBeFalsy()
  expect(elements.get('#syncInfo').innerHTML).toContain('這個瀏覽器')
  expect(elements.get('#syncBtns').innerHTML).toBe('')
})
