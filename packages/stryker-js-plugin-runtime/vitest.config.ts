import type {} from '@systemfsoftware/vitest'
import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'
import { inSourceSchemaLaws } from '@systemfsoftware/vitest-config/schema-laws'

export default defineConfig({
  ...sharedConfig,
  plugins: [inSourceSchemaLaws()],
  test: {
    ...sharedConfig.test,
    include: ['src/**/*.test.ts'],
    includeSource: ['src/**/*.ts'],
  },
})
