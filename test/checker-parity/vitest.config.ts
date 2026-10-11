import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'
import { inSourceSchemaLaws } from '@systemfsoftware/vitest-config/schema-laws'

const LAW_TIMEOUT_MS = 180_000

export default defineConfig({
  ...sharedConfig,
  plugins: [inSourceSchemaLaws()],
  test: {
    ...sharedConfig.test,
    include: ['src/**/__tests__/*.test.ts', 'src/**/*.test.ts'],
    includeSource: ['src/**/*.ts'],
    testTimeout: LAW_TIMEOUT_MS,
  },
})
