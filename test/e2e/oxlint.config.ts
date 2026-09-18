import { defineConfig } from 'oxlint'

export default defineConfig({
  categories: { correctness: 'error' },
  rules: {
    'typescript/no-non-null-assertion': 'error',
    'typescript/no-unnecessary-condition': 'error',
    'typescript/strict-boolean-expressions': 'error',
  },
})
