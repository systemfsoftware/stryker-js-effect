import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    include: ['tests/**/*.test.ts'],
    exclude: [...(sharedConfig.test?.exclude ?? []), 'tests/fixtures/**'],
  },
})
