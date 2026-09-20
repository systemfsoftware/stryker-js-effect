import { defineConfig } from 'vitest/config'

const SETUP_TIMEOUT_MS = 600_000
const TEST_TIMEOUT_MS = 120_000

const otelSdkPath = new URL('./otel.ts', import.meta.url).pathname

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false,
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: SETUP_TIMEOUT_MS,
    teardownTimeout: 30_000,
    coverage: { enabled: false },
    experimental: {
      openTelemetry: {
        enabled: process.env['OTEL_ENABLED'] === 'true',
        sdkPath: otelSdkPath,
      },
    },
  },
})
