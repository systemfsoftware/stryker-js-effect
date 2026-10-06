import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'
import { fileURLToPath } from 'node:url'

const workspaceStrykerJsHost = fileURLToPath(new URL('../stryker-js/src/mod.ts', import.meta.url))

const sharedAliases = Object.entries(sharedConfig.resolve?.alias ?? {}).map(([find, replacement]) => ({
  find,
  replacement,
}))

export default defineConfig({
  ...sharedConfig,
  resolve: {
    ...sharedConfig.resolve,
    alias: [
      ...sharedAliases,
      { find: /^@systemfsoftware\/stryker-js$/, replacement: workspaceStrykerJsHost },
    ],
  },
  test: {
    ...sharedConfig.test,
    include: ['src/**/*.test.ts', 'tests/**/*.integration.test.ts'],
    exclude: [
      ...(sharedConfig.test?.exclude ?? []),
      '**/.stryker-tmp/**',
      '**/testResources/**',
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
