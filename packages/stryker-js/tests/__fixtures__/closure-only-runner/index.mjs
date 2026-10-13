export const strykerPlugins = [
  { kind: 'TestRunner', name: 'closure-only', workerEntry: new URL('./worker.mjs', import.meta.url).href },
]
