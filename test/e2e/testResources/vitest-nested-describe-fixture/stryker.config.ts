import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: {
    plugin: '@systemfsoftware/stryker-js-vitest-runner',
  },
  coverageAnalysis: 'perTest',
  mutate: ['src/**/*.ts'],
  reporters: ['json'],
})
