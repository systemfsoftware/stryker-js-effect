/** @type {import('oxlint').OxlintConfig['plugins']} */
const plugins = ['typescript', 'unicorn', 'oxc', 'import', 'promise', 'vitest']

/** @type {import('oxlint').OxlintConfig['categories']} */
const categories = {
  correctness: 'error',
  suspicious: 'error',
  perf: 'error',
  nursery: 'warn',
}

/** @type {import('oxlint').OxlintConfig['rules']} */
const rules = {
  'no-ternary': 'off',
  'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
  'typescript/no-explicit-any': 'error',
  'typescript/no-non-null-assertion': 'error',
  'typescript/no-unsafe-argument': 'error',
  'typescript/no-unsafe-assignment': 'error',
  'typescript/no-unsafe-call': 'error',
  'typescript/no-unsafe-return': 'error',
  'typescript/no-unsafe-type-assertion': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': 'error',
  'no-else-return': 'error',
  'no-lonely-if': 'error',
  'no-implicit-coercion': 'error',
  'no-return-assign': 'error',
  'no-array-constructor': 'error',
  'unicorn/prefer-node-protocol': 'error',
  'unicorn/no-array-for-each': 'error',
  'import/no-cycle': 'error',
  'promise/param-names': 'error',
  'vitest/no-focused-tests': 'error',
  'vitest/no-conditional-expect': 'error',
  'no-restricted-imports': ['error', {
    patterns: [
      {
        regex: '^effect(?:/.*)?$',
        message: 'An ignorer package carries no Effect: its decision is plain data in, a value or a reason string out.',
      },
      {
        regex: '^@effect/.*$',
        message: 'An ignorer package carries no @effect/* import.',
      },
      {
        regex: '^@systemfsoftware/(?:all|effect-.*)$',
        message: 'The family Effect presets belong to the StrykerJS runtime, not to an ignorer package.',
      },
      {
        regex: '^@systemfsoftware/oxlint-plugin(?:-recommended)?$',
        message:
          'An ignorer package is graded by its own preset (@systemfsoftware/oxlint-ignorer-config); it does not import the family rule packs.',
      },
      {
        regex: '^@systemfsoftware/stryker-js-.*$',
        message:
          'An ignorer package depends on @systemfsoftware/stryker-ignorer-interface and nothing else from the family.',
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
      'typescript/consistent-type-assertions': 'off',
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
      'typescript/consistent-type-assertions': 'off',
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
  categories: { ...categories },
  rules: { ...rules },
  overrides: [...ignorerOverrides],
  ignorePatterns: [...ignorePatterns],
}

export { categories, ignorePatterns, ignorerConfig as default, plugins, rules }
