import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    typecheck: { enabled: true, tsconfig: './tsconfig.test.json', build: true },
    coverage: {
      ...sharedConfig.test?.coverage,
      enabled: true,
      include: ['src/**/*.ts'],
      thresholds: { 100: true, perFile: true },
    },
  },
})
