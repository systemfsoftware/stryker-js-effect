import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: 'vm',
  testFiles: ['src/service.vm.test.ts'],
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
    },
  ],
  tsconfigFile: 'non-existent-tsconfig.json',
  mutate: ['src/core.ts'],
})
