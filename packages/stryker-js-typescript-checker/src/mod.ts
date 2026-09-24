export const strykerPlugins: readonly {
  readonly kind: 'Checker'
  readonly name: string
  readonly workerEntry: string
}[] = [
  { kind: 'Checker', name: 'typescript', workerEntry: new URL('./main.mjs', import.meta.url).href },
]
