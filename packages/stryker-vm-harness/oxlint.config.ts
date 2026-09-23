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
      files: ['src/core/**/*', 'src/**/*'],
      rules: {
        complexity: 'off',
        'no-ternary': 'off',
        'typescript/consistent-type-assertions': 'off',
        'typescript/no-unsafe-return': 'off',
        'typescript/no-non-null-assertion': 'off',
        'no-restricted-globals': 'off',
        'no-restricted-imports': 'off',
      },
    },
    {
      files: ['src/shell/**/*.test.ts'],
      rules: {
        'vitest/no-conditional-in-test': 'off',
        'typescript/no-unnecessary-condition': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'effecttsgo/async-function': 'off',
        'effecttsgo/global-error-in-effect-failure': 'off',
        'effecttsgo/node-builtin-import': 'off',
      },
    },
  ],
})
