import { inlineSchemaTests } from '@systemfsoftware/effect-schema-vite'
import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

const GENERATED_REPORT_LAW_TIMEOUT_MS = 180_000

export default defineConfig({
  ...sharedConfig,
  plugins: [inlineSchemaTests()],
  test: {
    ...sharedConfig.test,
    include: ['src/**/__tests__/*.test.ts', 'src/**/*.test.ts', 'tests/**/*.test.ts'],
    includeSource: ['src/**/*.ts'],
    testTimeout: GENERATED_REPORT_LAW_TIMEOUT_MS,
  },
})
