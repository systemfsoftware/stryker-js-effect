import { defineConfig } from 'oxlint'

export default defineConfig({
  categories: { correctness: 'error' },
  plugins: ['vitest'],
  rules: {
    'typescript/no-non-null-assertion': 'error',
    'typescript/no-unnecessary-condition': 'error',
    'typescript/strict-boolean-expressions': 'error',
    'vitest/no-conditional-expect': 'error',
  },
})
