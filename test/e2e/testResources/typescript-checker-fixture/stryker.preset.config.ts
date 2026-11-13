import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['src/first.vm.test.ts'],
  checkers: [
    {
      plugin: '@systemfsoftware/stryker-js-typescript-checker',
    },
  ],
  tsconfigFile: 'tsconfig.extends.json',
  reporters: ['json'],
  mutate: ['src/first.ts'],
})
