import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: {
    plugin: '@systemfsoftware/stryker-js-vitest-runner',
    options: {
      timeoutTrapFile: 'packages/services/src/nontermination.ts',
    },
  },
  checkers: [
    {
      plugin: '@systemfsoftware/stryker-js-typescript-checker',
    },
  ],
  reporters: ['json'],
  tsconfigFile: 'tsconfig.json',
  mutator: { mutantSetPolicy: 'full' },
  mutate: ['packages/services/src/nontermination.ts'],
  timeoutMS: 500,
})
