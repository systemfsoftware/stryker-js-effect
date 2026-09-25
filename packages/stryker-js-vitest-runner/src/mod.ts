export const strykerPlugins: readonly {
  readonly kind: 'TestRunner'
  readonly name: string
  readonly workerEntry: string
}[] = [
  { kind: 'TestRunner', name: 'vitest', workerEntry: new URL('../dist/main.mjs', import.meta.url).href },
]
