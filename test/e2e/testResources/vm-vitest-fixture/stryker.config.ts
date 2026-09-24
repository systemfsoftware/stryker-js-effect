import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['src/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  thresholds: { high: 60, low: 40, break: 0 },
  reporters: ['json'],
})
