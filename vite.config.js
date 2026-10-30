import { defineConfig } from 'vite'

export default defineConfig({
  // 相對路徑：部署到子目錄（例如 GitHub Pages）也能正常運作
  base: './',
  server: { port: 5199, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1300 },
})
