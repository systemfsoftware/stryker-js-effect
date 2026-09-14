import all from '@systemfsoftware/all'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [all],

  rules: {
    'typescript/no-unnecessary-condition': 'error',
    'typescript/strict-boolean-expressions': 'error',
    'no-ternary': 'off',
    'typescript/consistent-type-assertions': 'off',
    'typescript/no-non-null-assertion': 'error',
  },

  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: { 'typescript/no-unsafe-type-assertion': 'off' },
    },
  ],
})
