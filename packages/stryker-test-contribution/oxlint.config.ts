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

  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: { 'typescript/no-unsafe-type-assertion': 'off' },
    },
    {
      files: ['**/fixtures/**', '**/__fixtures__/**', '**/testResources/**'],
      rules: {
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'typescript/no-unsafe-return': 'off',
        'typescript/no-unsafe-type-assertion': 'off',
      },
    },
    // Plain vitest setup: no Effect runtime exists here.
    {
      files: ['vitest-setup.ts'],
      rules: { 'no-restricted-globals': 'off' },
    },
  ],
})
