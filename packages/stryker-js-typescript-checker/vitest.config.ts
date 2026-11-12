import { defineConfig, sharedConfig } from '@systemfsoftware/vitest-config'
import { inSourceSchemaLaws } from '@systemfsoftware/vitest-config/schema-laws'

export default defineConfig({
  ...sharedConfig,
  plugins: [inSourceSchemaLaws()],
  test: {
    ...sharedConfig.test,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.stryker-tmp/**', '**/testResources/**'],
    // shortcut: 30s was sized for an idle runner. edit-site.schema.ts takes 13.4s locally and 70.5s on a loaded CI runner (run 43165649614, same file passed in run 43165637499). Upgrade by splitting the widening property when its CI p95 is under 30s.
    testTimeout: 120000,
    hookTimeout: 30000,
  },
})
