import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
  ...sharedConfig,
  resolve: {
    conditions: ['@systemfsoftware/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@systemfsoftware/source'],
    },
  },
  test: {
    ...sharedConfig.test,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
