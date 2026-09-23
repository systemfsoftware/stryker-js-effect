import { Effect } from 'effect'
import { instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { expect, it } from 'vitest'

const replacer = (_key: string, value: unknown): unknown => (typeof value === 'bigint' ? String(value) : value)

it('diagnoses instrument', async () => {
  const source = 'export const add = (a: number, b: number) => a + b\n'
  for (const mutate of [false, true] as const) {
    const exit = await Effect.runPromiseExit(
      instrument([{ name: 'diag.ts', content: source, mutate }], { ignorers: [], excludedMutations: [] }),
    )
    console.log(mutate ? '=== mutate:true' : '=== mutate:false', JSON.stringify(exit, replacer))
    expect(exit._tag, `instrument(mutate=${mutate}) should succeed`).toBe('Success')
  }
})
