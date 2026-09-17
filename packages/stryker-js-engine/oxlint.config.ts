import all from '@systemfsoftware/all'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [all],
  rules: {
    'typescript/no-unnecessary-condition': 'error',
    'typescript/strict-boolean-expressions': 'error',
    'typescript/no-non-null-assertion': 'error',
    'no-restricted-globals': ['error', { name: 'process', message: 'use @effect/platform instead' }],
  },
  ignorePatterns: [...(all.ignorePatterns ?? []), 'tests/__fixtures__/reuse-project/**'],
  overrides: [
    // Cwd-behavior test: the feature under test IS cwd-relative config resolution.
    {
      files: ['tests/config-file.integration.test.ts'],
      rules: { 'no-restricted-globals': 'off' },
    },
  ],
})
