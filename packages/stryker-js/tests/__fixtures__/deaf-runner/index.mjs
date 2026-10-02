export const strykerPlugins = [
  { kind: 'TestRunner', name: 'deaf', workerEntry: new URL('./worker.mjs', import.meta.url).href },
]
