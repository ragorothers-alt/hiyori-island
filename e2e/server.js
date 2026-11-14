// 測試用的靜態伺服器：把 App 放在 /hiyori-island/ 底下（跟 GitHub Pages 一樣是子目錄），
// 測試途中可以換版本（部署新版）、讓某些檔案回 404（部署到一半、CDN 出錯）、或整台連不上（離線）
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { OUT } from './builds.js'

export const BASE = '/hiyori-island/'
// Chromium 不讓連的埠（1024 以上的那些）：Windows 有時從很低的範圍配埠（例如配到 3659），打開就是 ERR_UNSAFE_PORT
const UNSAFE_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080])

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
}

export async function startServer(tag = 'a') {
  const state = { tag, down: false, missing: new Set() }
  const server = createServer(async (req, res) => {
    // 「離線」：連線直接斷掉，瀏覽器看到的是網路錯誤，不是錯誤頁
    if (state.down) return req.socket.destroy()
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (!path.startsWith(BASE)) {
      res.writeHead(404).end()
      return
    }
    let rel = path.slice(BASE.length) || 'index.html'
    if (rel.endsWith('/')) rel += 'index.html'
    rel = normalize(rel).replaceAll('\\', '/')
    if (rel.startsWith('..') || state.missing.has(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
      return
    }
    try {
      const body = await readFile(join(OUT[state.tag], rel))
      // GitHub Pages 一樣會讓瀏覽器快取一陣子；這裡關掉，測試看的是 Service Worker 的行為
      res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
    }
  })
  // 讓系統配一個空的埠；配到瀏覽器不讓連的就關掉再配一次
  for (;;) {
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    if (!UNSAFE_PORTS.has(server.address().port)) break
    await new Promise((r) => server.close(r))
  }
  const url = `http://127.0.0.1:${server.address().port}${BASE}`
  return {
    url,
    // 部署另一個版本
    deploy(t, { missing = [] } = {}) {
      state.tag = t
      state.missing = new Set(missing)
    },
    setDown(v) {
      state.down = v
    },
    close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(r))),
  }
}
