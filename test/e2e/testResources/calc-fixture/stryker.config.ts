import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vitest',
  plugins: [import.meta.resolve('@systemfsoftware/stryker-js-vitest-runner')],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
})
