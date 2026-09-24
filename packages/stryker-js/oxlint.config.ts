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
      files: ['src/VmRunner.ts'],
      rules: {
        complexity: 'off',
        'no-ternary': 'off',
        'typescript/consistent-type-assertions': 'off',
        'no-restricted-globals': 'off',
        'no-restricted-imports': 'off',
      },
    },
    {
      files: ['tests/**/*', 'src/**/__tests__/**/*'],
      rules: {
        complexity: 'off',
        'no-ternary': 'off',
        'typescript/consistent-type-assertions': 'off',
      },
    },
  ],
})
