export const strykerPlugins: readonly {
  readonly kind: 'TestRunner'
  readonly name: string
  readonly workerEntry: string
}[] = [
  { kind: 'TestRunner', name: 'vitest', workerEntry: new URL('./main.mjs', import.meta.url).href },
]
