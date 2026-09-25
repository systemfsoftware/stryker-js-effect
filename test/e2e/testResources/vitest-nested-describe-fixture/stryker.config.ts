import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: {
    plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
  },
  coverageAnalysis: 'perTest',
  mutate: ['src/**/*.ts'],
  reporters: ['json'],
})
