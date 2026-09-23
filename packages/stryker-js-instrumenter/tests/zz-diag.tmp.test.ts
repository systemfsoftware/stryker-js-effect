import { inspect } from 'node:util'
import { Effect } from 'effect'
import { instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { it } from 'vitest'

it('prints one instrument run', async () => {
  const source = 'export const add = (a: number, b: number) => a + b\n'
  for (const mutate of [false, true] as const) {
    const exit = await Effect.runPromiseExit(
      instrument([{ name: 'diag.ts', content: source, mutate }], { ignorers: [], excludedMutations: [] }),
    )
    console.log(
      mutate ? '=== mutate:true' : '=== mutate:false',
      exit._tag === 'Success'
        ? JSON.stringify(exit.value.files.map((file) => ({ name: file.name, content: file.content })))
        : inspect(exit.cause, { depth: 10 }),
    )
  }
})
