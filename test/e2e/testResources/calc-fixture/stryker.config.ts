import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: 'vm',
  testFiles: ['src/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
