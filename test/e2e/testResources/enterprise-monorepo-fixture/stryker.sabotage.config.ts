import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: {
    plugin: import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner'),
  },
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
    },
  ],
  reporters: ['json'],
  thresholds: { break: 100 },
  tsconfigFile: 'tsconfig.json',
  mutate: ['packages/*/src/**/*.ts', '!packages/*/src/**/*.test.ts'],
})
