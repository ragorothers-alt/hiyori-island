import { buildCatMochi } from './catMochi.js'
import { buildCatFuji } from './catFuji.js'
import { loadRig, buildRigged } from './rigged.js'
import mochiFit from './mochiRig.js'
import fujiFit from './fujiRig.js'

// 兩位主角：以 Tripo 生成的精緻模型為主；載入失敗、逾時或網址帶 ?classic 就用程序化模型
const CATS = {
  mochi: { base: buildCatMochi, fit: mochiFit, url: new URL('../../assets/cats/mochi.glb', import.meta.url).href },
  fuji: { base: buildCatFuji, fit: fujiFit, url: new URL('../../assets/cats/fuji.glb', import.meta.url).href },
}
const rigs = {}

export async function preloadCats(ms = 12000) {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('classic')) return
  await Promise.all(
    Object.entries(CATS).map(async ([id, cat]) => {
      try {
        const late = new Promise((_, no) => setTimeout(() => no(new Error('逾時')), ms))
        rigs[id] = await Promise.race([loadRig(cat.url), late])
      } catch (e) {
        console.warn(`[hiyori] ${id} 模型載入失敗，改用程序化模型`, e)
      }
    }),
  )
}

export function buildCat(id) {
  const cat = CATS[id]
  if (!rigs[id]) return cat.base()
  try {
    return buildRigged(rigs[id], cat.base(), cat.fit)
  } catch (e) {
    console.warn(`[hiyori] ${id} 模型組裝失敗，改用程序化模型`, e)
    return cat.base()
  }
}
