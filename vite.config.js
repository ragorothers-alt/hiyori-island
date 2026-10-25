import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5199, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
