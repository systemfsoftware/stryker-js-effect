import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: {
    plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
    options: {
      timeoutTrapFile: 'packages/services/src/nontermination.ts',
    },
  },
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
    },
  ],
  reporters: ['json'],
  tsconfigFile: 'tsconfig.json',
  mutate: ['packages/services/src/nontermination.ts'],
  timeoutMS: 500,
})
