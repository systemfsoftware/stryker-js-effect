import { defineConfig } from 'oxlint'

export default defineConfig({
  categories: { correctness: 'error' },
  rules: {
    'typescript/no-non-null-assertion': 'error',
    'typescript/no-unnecessary-condition': 'error',
    'typescript/strict-boolean-expressions': 'error',
    'no-restricted-globals': ['error', { name: 'process', message: 'use @effect/platform instead' }],
  },
  overrides: [
    // Test harness configuring env for spawned processes/OTEL SDK/containers.
    {
      files: ['otel.ts', 'vitest.config.ts', 'tests/**', 'testResources/**'],
      rules: { 'no-restricted-globals': 'off' },
    },
  ],
})
