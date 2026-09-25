import recommended from '@systemfsoftware/oxlint-config-recommended'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [recommended],
  rules: {
    'typescript/no-unnecessary-condition': 'error',
    'typescript/strict-boolean-expressions': 'error',
    'typescript/no-non-null-assertion': 'error',
    'no-restricted-globals': ['error', { name: 'process', message: 'use @effect/platform instead' }],
  },
  overrides: [
    {
      files: ['src/snapshots/snapshot-api.ts'],
      rules: {
        '@systemfsoftware/oxlint-plugin-test-discipline/vitest-from-systemfsoftware-vitest': 'off',
      },
    },
  ],
})
