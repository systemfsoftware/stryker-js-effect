import { expect, it } from 'vitest'
import { Effect } from 'effect'
import { instrument } from '@systemfsoftware/stryker-js-instrumenter'

it('probes instrument failures', async () => {
  const source = 'export const add = (a: number, b: number) => a + b\n'
  for (const mutate of [false, true] as const) {
    const exit = await Effect.runPromiseExit(
      instrument([{ name: 'probe.ts', content: source, mutate }], { ignorers: [], excludedMutations: [] }),
    )
    console.log(`mutate=${mutate}:`, JSON.stringify(exit, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v), 2).slice(0, 4000))
  }
  expect(true).toBe(true)
})
