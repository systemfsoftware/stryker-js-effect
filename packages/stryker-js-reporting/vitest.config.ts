import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'
import { inSourceSchemaLaws } from '@systemfsoftware/vitest-config/schema-laws'

export default defineConfig({
  ...sharedConfig,
  plugins: [inSourceSchemaLaws()],
  test: {
    ...sharedConfig.test,
    include: ['tests/**/*.test.ts', 'src/**/__tests__/*.test.ts', 'src/**/*.test.ts'],
    includeSource: ['src/**/*.ts'],
    testTimeout: 60_000,
  },
})
