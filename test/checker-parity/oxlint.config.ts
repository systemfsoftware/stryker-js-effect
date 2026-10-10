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
  'src/Parity.schema.ts',
  'src/shard.ts',
  'src/compare-sides.workflow.ts',
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
  ],
})
