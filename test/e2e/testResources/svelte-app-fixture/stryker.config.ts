import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vitest',
  plugins: ['@systemfsoftware/stryker-js-vitest-runner', '@systemfsoftware/stryker-js-svelte'],
  testFiles: ['src/**/*.test.ts'],
  mutate: ['src/**/*.svelte', 'src/**/*.ts', '!src/**/*.test.ts'],
  thresholds: { high: 60, low: 40, break: 0 },
  reporters: ['json'],
})
