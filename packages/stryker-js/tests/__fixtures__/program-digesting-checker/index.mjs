export const strykerPlugins = [
  { kind: 'Checker', name: 'program-digesting', workerEntry: new URL('./worker.mjs', import.meta.url).href },
]
