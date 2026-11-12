export const strykerPlugins = [
  { kind: 'Reporter', name: 'refusing', workerEntry: new URL('./worker.mjs', import.meta.url).href },
]
