import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'

// Service Worker 的快取名稱帶著這次建置的代號，並附上這次建置的檔案清單（public/sw.js 會原樣複製進 dist，寫好之後再改）：
// 每次部署換一個新快取、舊的清掉，沒有 hash 的圖示和 manifest 也會跟著更新；新版還用得到的舊檔搬過去
const swVersion = () => {
  let files = []
  let dir = 'dist'
  return {
    name: 'hiyori-sw-version',
    apply: 'build',
    generateBundle(options, bundle) {
      files = Object.keys(bundle).sort()
      dir = options.dir || dir
    },
    closeBundle() {
      const file = join(dir, 'sw.js')
      const id = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 10)
      const src = readFileSync(file, 'utf8')
      const out = src.replace("const VERSION = 'hiyori-v1'", `const VERSION = 'hiyori-${id}'`).replace('const BUILD = []', `const BUILD = ${JSON.stringify(files)}`)
      if (out === src) throw new Error('sw.js 裡找不到 VERSION／BUILD，建置代號沒有填進去')
      writeFileSync(file, out)
    },
  }
}

// 小島（three.js 和場景，src/islandScene.js）是動態載入的：App 模式開機時不下載，第一次切回小島才下載。
// 小島模式開機一定會用到，所以在 index.html 先看這台裝置選的模式，小島模式就跟入口一起開始下載，不用等入口跑起來
const islandPreload = () => ({
  name: 'hiyori-island-preload',
  transformIndexHtml: {
    order: 'post',
    handler(html, { bundle }) {
      const chunks = Object.values(bundle || {}).filter((c) => c.type === 'chunk')
      const island = chunks.find((c) => c.facadeModuleId?.endsWith('/src/islandScene.js'))
      if (!island) return html
      const entries = new Set(chunks.filter((c) => c.isEntry).map((c) => c.fileName))
      const files = [island.fileName, ...island.imports].filter((f) => !entries.has(f))
      return html.replace(
        '</head>',
        `  <script>
    try {
      if (JSON.parse(localStorage.getItem('hiyori-layout')) !== 'app')
        for (const f of ${JSON.stringify(files)}) document.head.append(Object.assign(document.createElement('link'), { rel: 'modulepreload', crossOrigin: '', href: './' + f }))
    } catch {}
  </script>
</head>`,
      )
    },
  },
})

export default defineConfig({
  // 相對路徑：部署到子目錄（例如 GitHub Pages）也能正常運作
  base: './',
  server: { port: 5199, open: false },
  plugins: [islandPreload(), swVersion()],
  build: {
    target: 'es2022',
    // CSS 要給瀏覽器版本：只寫 es2022 時壓縮器會把標準的 backdrop-filter 丟掉、只留 -webkit-，Chrome 就沒有毛玻璃
    cssTarget: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    // three.js 單獨一包：App 更新時它的檔名不變，瀏覽器和 Service Worker 的快取可以繼續用
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } } },
    chunkSizeWarningLimit: 900,
  },
})
