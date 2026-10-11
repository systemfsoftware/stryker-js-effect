import recommended from '@systemfsoftware/oxlint-config-recommended'
import { defineConfig } from 'oxlint'

const implementationPackages = [
  '@systemfsoftware/stryker-js',
  '@systemfsoftware/stryker-js-instrumenter',
  '@systemfsoftware/stryker-js-typescript-checker',
  '@systemfsoftware/stryker-js-plugin-runtime',
  '@systemfsoftware/stryker-js-engine',
]

const implementationImportGroups = implementationPackages.flatMap((name) => [name, `${name}/*`])

const pureCore = [
  'src/*.workflow.ts',
  'src/*.schema.ts',
  'src/shard.ts',
  'src/span-counts.ts',
  'src/corpus.ts',
  'src/blocks.ts',
  'src/file-costs.ts',
]

export default defineConfig({
  extends: [recommended],

  rules: {
    'effecttsgo/unstable-api-usage': 'off',
    'typescript/no-unnecessary-condition': 'error',
    'typescript/strict-boolean-expressions': 'error',
    'typescript/no-non-null-assertion': 'error',
    'no-restricted-globals': ['error', { name: 'process', message: 'use @effect/platform instead' }],
  },

  overrides: [
    {
      files: pureCore,
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: implementationImportGroups,
                message:
                  'the pure core imports contract packages only; the imperative shell under src/ may import a Stryker implementation.',
              },
            ],
          },
        ],
      },
    },
  ],

  ignorePatterns: [
    ...(recommended.ignorePatterns ?? []),
    '__fixtures__/**',
  ],
})
