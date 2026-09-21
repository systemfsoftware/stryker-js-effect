import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/**/*.test.ts'],
    fileParallelism: false,
    passWithNoTests: false,
    testTimeout: 120_000,
  },
})
