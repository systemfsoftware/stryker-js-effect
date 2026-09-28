import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
    },
  ],
  reporters: ['json'],
  tsconfigFile: 'tsconfig.json',
  timeoutMS: 60000,
  plugins: [new URL('./provider.mjs', import.meta.url).href],
  mutator: { mutantSetPolicy: 'full', optInMutations: ['AtomicUpdateSplit', 'FinalizerEscape'] },
  mutate: ['packages/*/src/**/*.ts', '!packages/*/src/**/*.test.ts', '!packages/services/src/nontermination.ts'],
})
