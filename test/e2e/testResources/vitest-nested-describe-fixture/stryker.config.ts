import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: {
    plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
  },
  coverageAnalysis: 'perTest',
  mutate: ['src/**/*.ts'],
  reporters: ['json'],
})
