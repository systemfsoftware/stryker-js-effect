export const strykerPlugins = [
  { kind: 'Checker', name: 'rejecting', workerEntry: new URL('./worker.mjs', import.meta.url).href },
]
