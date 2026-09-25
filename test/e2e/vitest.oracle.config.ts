import { defineConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['scripts/**/*.test.ts'],
    fileParallelism: false,
    passWithNoTests: false,
    testTimeout: 120_000,
  },
})
