import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    conditions: ['custom'],
  },
  ssr: {
    resolve: {
      conditions: ['custom'],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('1.2.3'),
    'import.meta.env.VITE_FEATURE': JSON.stringify('enabled'),
  },
  test: {
    include: ['spec/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'spec/skip/**'],
    setupFiles: ['./src/setup.ts'],
    globals: true,
    testTimeout: 10_000,
    includeSource: ['src/**/*.ts'],
  },
})
