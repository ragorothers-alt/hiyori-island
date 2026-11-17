import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['live/**/*.live.js'],
    setupFiles: ['tests/setup.js'],
    testTimeout: 240000,
    silent: false,
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
  },
})
