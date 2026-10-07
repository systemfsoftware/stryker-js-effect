export const strykerPlugins = [
  { kind: 'Checker', name: 'cost', workerEntry: new URL('./worker.mjs', import.meta.url).href },
]
