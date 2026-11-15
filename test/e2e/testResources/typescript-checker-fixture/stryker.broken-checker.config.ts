import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['src/service.vm.test.ts'],
  checkers: [
    {
      plugin: '@systemfsoftware/stryker-js-typescript-checker',
    },
  ],
  tsconfigFile: 'non-existent-tsconfig.json',
  mutate: ['src/core.ts'],
})
