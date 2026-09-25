import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
    },
  ],
  reporters: ['json'],
  thresholds: { break: 100 },
  tsconfigFile: 'tsconfig.json',
  mutate: ['packages/*/src/**/*.ts', '!packages/*/src/**/*.test.ts', '!packages/services/src/nontermination.ts'],
})
