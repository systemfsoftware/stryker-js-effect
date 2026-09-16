export const strykerPlugins = [{ kind: 'Reporter', name: 'native-fixture-reporter' }]

export const strykerIgnorers = [
  { name: 'plain-fixture-rule', shouldIgnore: () => 'plain reason' },
]
