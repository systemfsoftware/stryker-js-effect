import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    include: ['src/**/*.property.test.ts', 'tests/**/*.integration.test.ts'],
    setupFiles: ['vitest-setup.ts'],
  },
})
