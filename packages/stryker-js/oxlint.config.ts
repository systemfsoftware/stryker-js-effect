import all from '@systemfsoftware/all'
import { defineConfig } from 'oxlint'

const crossFieldThresholdsPredicate = {
  files: ['src/RunEvent.schema.ts'],
  rules: {
    '@systemfsoftware/oxlint-plugin-effect-dmmf/schema-filter-constructive-generation': 'off' as const,
  },
}

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
    {
      files: ['tests/config-file.integration.test.ts'],
      rules: { 'no-restricted-globals': 'off' },
    },
    {
      files: ['src/bin/main.ts', 'src/platform/node.ts'],
      rules: { 'no-restricted-globals': 'off' },
    },
    {
      files: ['tsdown.config.ts', 'tsdown.bin.config.ts'],
      rules: { 'no-restricted-globals': 'off', 'no-restricted-imports': 'off' },
    },
    crossFieldThresholdsPredicate,
  ],
})
