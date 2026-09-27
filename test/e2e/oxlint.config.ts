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

const IMPLEMENTATION_IMPORT_MESSAGE =
  'tests/ decode the packed CLI through contracts: import @systemfsoftware/stryker-e2e-core, @systemfsoftware/stryker-js-cli-contract or @systemfsoftware/stryker-js-plugin-interface, never a Stryker implementation.'

export default defineConfig({
  categories: { correctness: 'error' },
  plugins: ['vitest'],
  rules: {
    'typescript/no-non-null-assertion': 'error',
    'typescript/no-unnecessary-condition': 'error',
    'typescript/strict-boolean-expressions': 'error',
    'vitest/no-conditional-expect': 'error',
    'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'fc.assert'] }],
  },
  overrides: [
    {
      files: ['tests/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [{ group: implementationImportGroups, message: IMPLEMENTATION_IMPORT_MESSAGE }],
          },
        ],
        'no-console': 'error',
      },
    },
  ],
})
