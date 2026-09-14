export const strykerIgnorers = [
  {
    name: 'no-schema-rule',
    schema: { '~standard': { version: 2, vendor: 'fixture', validate: 'not a function' } },
    shouldIgnore: () => undefined,
  },
]
