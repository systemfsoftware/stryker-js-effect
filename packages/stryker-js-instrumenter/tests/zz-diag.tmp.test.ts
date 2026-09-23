import { inspect } from 'node:util'
import { Effect } from 'effect'
import { instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { expect, it } from 'vitest'

it('diagnoses the instrument cause', async () => {
  const exit = await Effect.runPromiseExit(
    instrument([{ name: 'diag.ts', content: 'export const add = (a: number, b: number) => a + b\n', mutate: false }], {
      ignorers: [],
      excludedMutations: [],
    }),
  )
  if (exit._tag === 'Failure') console.log('CAUSE:', inspect(exit.cause, { depth: 10 }))
  expect(exit._tag, 'instrument should succeed').toBe('Success')
})
