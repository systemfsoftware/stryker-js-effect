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
    // Declared Node edge: title/version/cwd (main.ts) and platform/execPath (node.ts) have no platform services.
    {
      files: ['src/main.ts', 'src/platform/node.ts'],
      rules: { 'no-restricted-globals': 'off' },
    },
    // Build config: runs in Node before any platform layer exists; reads the fs to inline the wasm bundle.
    {
      files: ['tsdown.config.ts'],
      rules: { 'no-restricted-globals': 'off', 'no-restricted-imports': 'off' },
    },
  ],
})
