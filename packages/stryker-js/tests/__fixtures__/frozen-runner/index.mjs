export const strykerPlugins = [
  { kind: 'TestRunner', name: 'frozen', workerEntry: new URL('./worker.mjs', import.meta.url).href },
]
