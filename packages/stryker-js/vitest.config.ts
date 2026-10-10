import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'
import { inSourceSchemaLaws } from '@systemfsoftware/vitest-config/schema-laws'

const ownNameResolvesToSourceNotDogfoodCopy = [
  { find: /^@systemfsoftware\/stryker-js$/, replacement: new URL('./src/mod.ts', import.meta.url).pathname },
  {
    find: /^@systemfsoftware\/stryker-js\/(config|promises)$/,
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
  plugins: [inSourceSchemaLaws()],
  test: {
    ...sharedConfig.test,
    env: { ...sharedConfig.test?.env, ALLOW_LOCAL_MUTATION: '1' },
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
