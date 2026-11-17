// 匯入行事曆（/v1/ics）：瀏覽器不能直接讀別的網站的 .ics（跨網域），經過這裡抓回原文，前端自己解析（src/ics.js）。
// 只抓 https（webcal:// 當成 https://）的公開網址，回來的一定要是行事曆檔（開頭有 BEGIN:VCALENDAR），最多 2 MB、15 秒。
// 網址常常是私人網址（Google 日曆的「私密網址」等於鑰匙）：不記錄、不存，也不用 Cloudflare 的快取（不同人不會拿到同一份）
import { HttpError } from './http.js'

export const ICS_MAX = 2_000_000
export const ICS_TIMEOUT = 15_000

// 看起來是內部網路、本機、IP 位址的不抓（Worker 本來就連不到內部網路，多擋一層）
function okHost(host) {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (!h || !h.includes('.')) return false
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return false
  if (/^[\d.]+$/.test(h) || h.startsWith('[') || h.includes(':')) return false
  return true
}

export function icsUrl(raw) {
  let url
  try {
    url = new URL(String(raw ?? '').trim().replace(/^webcals?:\/\//i, 'https://'))
  } catch {
    throw new HttpError(400, 'bad url')
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !okHost(url.hostname)) throw new HttpError(400, 'bad url')
  if (url.href.length > 2000) throw new HttpError(400, 'bad url')
  return url
}

// 讀回應，最多 max 個位元組：超過就停下來
async function readCapped(res, max) {
  if (Number(res.headers.get('Content-Length')) > max) throw new HttpError(413, 'ics too large')
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      throw new HttpError(413, 'ics too large')
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

export async function fetchICS(body, fetcher = fetch) {
  const url = icsUrl(body?.url)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ICS_TIMEOUT)
  try {
    let res
    try {
      res = await fetcher(url.href, {
        headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1', 'User-Agent': 'hiyori-calendar/1.0' },
        redirect: 'follow',
        signal: ctrl.signal,
        cf: { cacheTtl: 0, cacheEverything: false },
      })
    } catch {
      throw new HttpError(502, 'ics unreachable')
    }
    // 轉址到 http、IP 的不收
    try {
      if (res.url) icsUrl(res.url)
    } catch {
      throw new HttpError(400, 'bad url')
    }
    if (!res.ok) throw new HttpError(502, 'ics failed', { status: res.status })
    let text
    try {
      text = await readCapped(res, ICS_MAX)
    } catch (e) {
      if (e instanceof HttpError) throw e
      throw new HttpError(502, 'ics unreachable')
    }
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4000))) throw new HttpError(422, 'not ics')
    return { ok: true, text }
  } finally {
    clearTimeout(timer)
  }
}
