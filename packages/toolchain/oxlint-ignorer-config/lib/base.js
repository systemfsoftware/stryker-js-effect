import house from '@systemfsoftware/oxlint-plugin'
import {
  options,
  overrides,
  plugins as recommendedPlugins,
  rules as recommendedRules,
} from '@systemfsoftware/oxlint-plugin-recommended'

const jsPlugins = [
  import.meta.resolve('@systemfsoftware/oxlint-plugin'),
]

/** @type {import('oxlint').OxlintConfig['plugins']} */
const plugins = [
  ...recommendedPlugins,
  'jsdoc',
  'node',
  'oxc',
  'promise',
]

/** @type {import('oxlint').OxlintConfig['rules']} */
const rules = {
  ...recommendedRules,
  ...house.configs.recommended.rules,
  'no-ternary': 'off',
  'typescript/consistent-type-assertions': 'off',
  'no-restricted-imports': ['error', {
    patterns: [
      {
        regex: '^effect(?:/.*)?$',
        message:
          "Importing Effect is forbidden in an ignorer package — the interface package's Standard Schema toolkit replaces it.",
      },
      {
        regex: '^@effect/.*$',
        message: 'Importing @effect/* is forbidden in an ignorer package.',
      },
      {
        regex: '^@systemfsoftware/(?:all|effect-.*)$',
        message: 'Importing the family Effect presets is forbidden in an ignorer package.',
      },
      {
        regex: '^@systemfsoftware/stryker-js-.*$',
        message:
          'Importing the StrykerJS runtime family is forbidden in an ignorer package — depend only on @systemfsoftware/stryker-ignorer-interface.',
      },
    ],
  }],
}

/** @type {readonly string[]} */
const ignorePatterns = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/.stryker-tmp/**',
  '**/*.d.ts',
  '**/*.tsbuildinfo',
]

/** @type {import('oxlint').OxlintConfig['overrides']} */
const ignorerOverrides = [
  ...overrides,
  {
    files: ['**/src/**'],
    rules: {
      complexity: ['error', {
        max: 2,
        variant: 'modified',
      }],
    },
  },
  {
    files: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/tests/**',
    ],
    rules: {
      complexity: 'off',
      'typescript/no-unsafe-type-assertion': 'off',
    },
  },
  {
    files: [
      '**/__fixtures__/**',
      '**/fixtures/**',
      '**/testResources/**',
    ],
    rules: {
      'typescript/no-unsafe-argument': 'off',
      'typescript/no-unsafe-assignment': 'off',
      'typescript/no-unsafe-call': 'off',
      'typescript/no-unsafe-return': 'off',
      'typescript/no-unsafe-type-assertion': 'off',
    },
  },
]
/** @type {import('oxlint').OxlintConfig} */
const ignorerConfig = {
  plugins: [...plugins],
  jsPlugins: [...jsPlugins],
  options: { ...options },
  categories: { correctness: 'error' },
  rules: { ...rules },
  overrides: [...ignorerOverrides],
  ignorePatterns: [...ignorePatterns],
}

export { ignorePatterns, ignorerConfig as default, plugins, rules }
