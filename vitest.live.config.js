import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['live/**/*.live.js'],
    setupFiles: ['tests/setup.js'],
    // 被流量上限擋下時會等一分鐘再試（最多兩次）
    testTimeout: 420000,
    silent: false,
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
  },
})
