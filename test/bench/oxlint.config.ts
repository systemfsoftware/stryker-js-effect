import recommended from '@systemfsoftware/oxlint-config-recommended'
import { defineConfig } from 'oxlint'

const implementationPackages = [
  '@systemfsoftware/stryker-js',
  '@systemfsoftware/stryker-js-instrumenter',
  '@systemfsoftware/stryker-js-vitest-runner',
  '@systemfsoftware/stryker-js-typescript-checker',
  '@systemfsoftware/stryker-js-html-reporter',
  '@systemfsoftware/stryker-js-plugin-runtime',
  '@systemfsoftware/stryker-js-engine',
  '@systemfsoftware/stryker-js-language',
]

const implementationImportGroups = implementationPackages.flatMap((name) => [name, `${name}/*`])

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
      files: ['src/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: implementationImportGroups,
                message:
                  'src/ reads the sides through their build outputs and contracts: import @systemfsoftware/stryker-e2e-core, @systemfsoftware/stryker-js-cli-contract or @systemfsoftware/stryker-js-plugin-interface, never a Stryker implementation.',
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
