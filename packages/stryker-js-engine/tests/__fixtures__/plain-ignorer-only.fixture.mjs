const standardSchema = {
  '~standard': {
    version: 1,
    vendor: 'fixture',
    /** @param {unknown} value */
    validate: (value) => ({ value }),
  },
}

export const strykerIgnorers = [
  { name: 'plain-fixture-rule', schema: standardSchema, shouldIgnore: () => 'fixture reason' },
  { name: 'plain-fixture-never', schema: standardSchema, shouldIgnore: () => undefined },
]
