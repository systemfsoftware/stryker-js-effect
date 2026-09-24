import { inlineSchemaTests } from '@systemfsoftware/effect-schema-vite'
import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

const seedAvoidingNodeIssue63785JsonParseKeyCorruption = 4

export default defineConfig({
  ...sharedConfig,
  plugins: [inlineSchemaTests()],
  test: {
    ...sharedConfig.test,
    provide: { propertySeed: seedAvoidingNodeIssue63785JsonParseKeyCorruption },
    include: ['src/**/*.test.ts'],
    includeSource: ['src/**/*.ts'],
  },
})
