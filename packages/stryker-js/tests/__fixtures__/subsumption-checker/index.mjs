export const strykerPlugins = [
  { kind: 'Checker', name: 'subsumption', workerEntry: new URL('./worker.mjs', import.meta.url).href },
]
