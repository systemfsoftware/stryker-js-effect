import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: 'vm',
  testFiles: ['src/first.vm.test.ts'],
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
    },
  ],
  tsconfigFile: 'tsconfig.extends.json',
  mutate: ['src/first.ts'],
})
