import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
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
    include: ['tests/**/*.integration.test.ts', 'src/**/__tests__/*.test.ts'],
    includeSource: ['src/**/*.ts'],
    passWithNoTests: false,
    testTimeout: 60_000,
  },
})
