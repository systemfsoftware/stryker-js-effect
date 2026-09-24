import { inlineSchemaTests } from '@systemfsoftware/effect-schema-vite'
import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
  ...sharedConfig,
  plugins: [inlineSchemaTests()],
  test: {
    ...sharedConfig.test,
    include: [
      'tests/**/*.integration.test.ts',
      'tests/**/*.differential.test.ts',
      'src/**/__tests__/*.test.ts',
      'src/**/*.test.ts',
    ],
    includeSource: ['src/**/*.ts'],
    passWithNoTests: false,
    testTimeout: 60_000,
  },
})
