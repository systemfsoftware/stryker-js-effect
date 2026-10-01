import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'
import { inSourceSchemaLaws } from '@systemfsoftware/vitest-config/schema-laws'

const GENERATED_REPORT_LAW_TIMEOUT_MS = 180_000

export default defineConfig({
  ...sharedConfig,
  plugins: [inSourceSchemaLaws()],
  test: {
    ...sharedConfig.test,
    include: ['src/**/__tests__/*.test.ts', 'src/**/*.test.ts', 'tests/**/*.test.ts'],
    includeSource: ['src/**/*.ts'],
    testTimeout: GENERATED_REPORT_LAW_TIMEOUT_MS,
  },
})
