import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    env: { ...sharedConfig.test?.env, AWS_ACCESS_KEY_ID: 'emulate', AWS_SECRET_ACCESS_KEY: 'emulate' },
    include: ['tests/**/*.integration.test.ts'],
    passWithNoTests: false,
  },
})
