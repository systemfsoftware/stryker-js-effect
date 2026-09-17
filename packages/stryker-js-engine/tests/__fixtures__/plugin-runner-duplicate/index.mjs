const descriptor = {
  kind: 'TestRunner',
  name: 'vitest',
  workerEntry: 'file:///project/node_modules/@acme/stryker-runner/dist/main.mjs',
}

export const strykerPlugins = [descriptor, descriptor]
