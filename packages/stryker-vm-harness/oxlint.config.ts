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
    {
      files: ['src/core/**/*', 'src/**/*'],
      rules: {
        complexity: 'off',
        'no-ternary': 'off',
        'typescript/consistent-type-assertions': 'off',
        'typescript/no-unsafe-return': 'off',
        '@systemfsoftware/oxlint-plugin-effect-dmmf/make-file-location': 'off',
        '@systemfsoftware/oxlint-plugin-effect-dmmf/schema-declaration-location': 'off',
        '@systemfsoftware/oxlint-plugin-effect-dmmf/make-body-purity': 'off',
        '@systemfsoftware/oxlint-plugin-effect-dmmf/no-test-file-in-src': 'off',
        '@systemfsoftware/oxlint-plugin-effect-dmmf/src-property-test-cell': 'off',
        '@systemfsoftware/oxlint-plugin-effect-dmmf/damp-test-naming': 'off',
        '@systemfsoftware/oxlint-plugin-effect-dmmf/no-nested-quantification': 'off',
        '@systemfsoftware/oxlint-plugin-effect-dmmf/pbt-naming': 'off',
        'typescript/no-non-null-assertion': 'off',
      },
    },
  ],
})
