import { defineConfig } from 'vite'

export default defineConfig({
  // 相對路徑：部署到子目錄（例如 GitHub Pages）也能正常運作
  base: './',
  server: { port: 5199, open: false },
  build: {
    target: 'es2022',
    // CSS 要給瀏覽器版本：只寫 es2022 時壓縮器會把標準的 backdrop-filter 丟掉、只留 -webkit-，Chrome 就沒有毛玻璃
    cssTarget: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    // three.js 單獨一包：App 更新時它的檔名不變，瀏覽器和 Service Worker 的快取可以繼續用
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } } },
    chunkSizeWarningLimit: 900,
  },
})
