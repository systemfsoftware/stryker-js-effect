const standardSchema = {
  '~standard': {
    version: 1,
    vendor: 'fixture',
    /** @param {unknown} value */
    validate: (value) => ({ value }),
  },
}

export const strykerIgnorers = [
  { name: 'duplicated-rule', schema: standardSchema, shouldIgnore: () => 'first' },
  { name: 'duplicated-rule', schema: standardSchema, shouldIgnore: () => 'last' },
]
