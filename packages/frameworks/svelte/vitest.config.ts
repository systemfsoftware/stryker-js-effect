import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      ...sharedConfig.test?.coverage,
      enabled: true,
      include: ['src/**/*.ts'],
      thresholds: { 100: true, perFile: true },
    },
  },
})
