import { defineConfig } from 'vite'

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
  plugins: [islandPreload()],
  build: {
    target: 'es2022',
    // CSS 要給瀏覽器版本：只寫 es2022 時壓縮器會把標準的 backdrop-filter 丟掉、只留 -webkit-，Chrome 就沒有毛玻璃
    cssTarget: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    // three.js 單獨一包：App 更新時它的檔名不變，瀏覽器和 Service Worker 的快取可以繼續用
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } } },
    chunkSizeWarningLimit: 900,
  },
})
