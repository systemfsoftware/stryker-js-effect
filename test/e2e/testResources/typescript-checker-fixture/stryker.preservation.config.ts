import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['src/order.vm.test.ts'],
  checkers: [
    {
      plugin: '@systemfsoftware/stryker-js-typescript-checker',
    },
  ],
  tsconfigFile: 'tsconfig.preservation.json',
  reporters: ['json'],
  mutate: ['src/order.ts'],
})
