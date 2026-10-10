export const strykerPlugins = [
  { kind: 'Checker', name: 'guarded-block', workerEntry: new URL('./worker.mjs', import.meta.url).href },
]
