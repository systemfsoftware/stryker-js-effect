import { StrykerConfig } from '@systemfsoftware/stryker-js/config'

export default StrykerConfig.define({
  testRunner: {
    plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
  },
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
    },
  ],
  reporters: ['json'],
  tsconfigFile: 'tsconfig.json',
  timeoutMS: 60000,
  mutate: ['packages/*/src/**/*.ts', '!packages/*/src/**/*.test.ts', '!packages/services/src/nontermination.ts'],
})
