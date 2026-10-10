export const strykerPlugins = [
  {
    kind: 'Checker',
    name: 'subsumption-compile-error',
    workerEntry: new URL('./compile-error-worker.mjs', import.meta.url).href,
  },
]
