export const strykerPlugins = [
  {
    kind: 'TestRunner',
    name: 'vitest',
    workerEntry: 'file:///project/node_modules/@acme/stryker-runner/dist/main.mjs',
  },
]
