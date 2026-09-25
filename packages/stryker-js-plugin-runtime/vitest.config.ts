import { inlineSchemaTests } from '@systemfsoftware/effect-schema-vite'
import type {} from '@systemfsoftware/vitest'
import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

const seedAvoidingNodeIssue63785JsonParseKeyCorruption = 1

export default defineConfig({
  ...sharedConfig,
  plugins: [inlineSchemaTests()],
  test: {
    ...sharedConfig.test,
    provide: {
      '@systemfsoftware/vitest:property-check': {
        ...sharedConfig.test?.provide?.['@systemfsoftware/vitest:property-check'],
        seed: seedAvoidingNodeIssue63785JsonParseKeyCorruption,
      },
    },
    include: ['src/**/*.test.ts'],
    includeSource: ['src/**/*.ts'],
  },
})
