import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  checkers: [
    {
      plugin: '@systemfsoftware/stryker-js-typescript-checker',
    },
  ],
  reporters: ['json'],
  tsconfigFile: 'tsconfig.json',
  timeoutMS: 60000,
  mutate: ['packages/services/src/inventory.ts'],
  mutator: {
    excludedMutations: ['ConditionalExpression', 'EqualityOperator'],
  },
})
