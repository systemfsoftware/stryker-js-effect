import { isAgent, isCI } from './env.js'

export { defineConfig } from 'vitest/config'

export { isCI }

const sharedTestTimeout = isCI ? 30_000 : isAgent ? 15_000 : 8_000

/**
 * @type {import('vitest/config').ViteUserConfig}
 */
export const sharedConfig = {
  test: {
    globals: true,
    environment: 'node',
    includeSource: ['src/**/*.{js,ts}'],
    exclude: ['**/.stryker-tmp/**', '**/node_modules/**', '**/.repo/**'],
    passWithNoTests: true,
    setupFiles: ['@systemfsoftware/vitest-config/setup'],
    server: {
      deps: {
        // The setup file mocks this module to inject the property budget, which
        // needs it in the Vite pipeline rather than loaded natively as an external.
        inline: ['@effect/vitest'],
      },
    },
    testTimeout: sharedTestTimeout,
    silent: isAgent ? 'passed-only' : false,
    ...(isAgent ? { bail: 1 } : {}),
    coverage: {
      enabled: isCI || process.env['COVERAGE'] === 'true',
      provider: 'v8',
      reporter: ['json', 'html', 'lcov'],
    },
  },
  // Workspace-only: tsdown declares it via devExports and every
  // consumer-facing surface strips it, so only in-repo runs see sources.
  resolve: {
    conditions: ['@systemfsoftware/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@systemfsoftware/source'],
    },
  },
}
