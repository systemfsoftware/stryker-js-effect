import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'

export default defineConfig({
  ...sharedConfig,
  resolve: {
    conditions: ['@systemfsoftware/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@systemfsoftware/source'],
    },
  },
  test: {
    ...sharedConfig.test,
    include: ['src/**/*.test.ts'],
    exclude: [
      ...(sharedConfig.test?.exclude ?? []),
      '**/.stryker-tmp/**',
      '**/testResources/**',
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
