import { inlineSchemaTests } from '@systemfsoftware/effect-schema-vite'
import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

const ownNameResolvesToSourceNotDogfoodCopy = [
  { find: /^@systemfsoftware\/stryker-js$/, replacement: new URL('./src/mod.ts', import.meta.url).pathname },
  {
    find: /^@systemfsoftware\/stryker-js\/(config|events|promises)$/,
    replacement: `${new URL('./src/', import.meta.url).pathname}$1/mod.ts`,
  },
]

export default defineConfig({
  ...sharedConfig,
  resolve: {
    ...sharedConfig.resolve,
    alias: [
      ...ownNameResolvesToSourceNotDogfoodCopy,
      ...Object.entries(sharedConfig.resolve?.alias ?? {}).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
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
