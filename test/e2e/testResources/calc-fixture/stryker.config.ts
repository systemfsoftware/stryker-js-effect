import { defineConfig } from '@systemfsoftware/stryker-js/config'

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['src/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  reporters: ['json'],
  ignorers: [
    '@systemfsoftware/stryker-ignorer-effect-schema-declarations',
    '@systemfsoftware/stryker-ignorer-in-source-vitest-block',
  ],
})
