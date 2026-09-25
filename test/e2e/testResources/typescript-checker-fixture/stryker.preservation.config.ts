import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['src/order.vm.test.ts'],
  checkers: [
    {
      plugin: import.meta.resolve('@systemfsoftware/stryker-js-typescript-checker'),
    },
  ],
  tsconfigFile: 'tsconfig.preservation.json',
  mutate: ['src/order.ts'],
})
