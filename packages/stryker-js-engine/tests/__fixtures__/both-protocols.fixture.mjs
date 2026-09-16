export const strykerPlugins = [
  {
    kind: 'Reporter',
    name: 'native-fixture-reporter',
    workerEntry: 'file:///project/node_modules/@acme/stryker-reporter/dist/main.mjs',
  },
]

export const strykerIgnorers = [
  { name: 'plain-fixture-rule', shouldIgnore: () => 'plain reason' },
]
