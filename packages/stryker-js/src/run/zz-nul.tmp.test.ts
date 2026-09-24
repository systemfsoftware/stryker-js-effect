import * as Effect from 'effect/Effect'
import * as Logger from 'effect/Logger'
import { expect, it } from 'vitest'
import { forkCoreSchema, validateOptions } from './load-config.cell.js'

it('probe', async () => {
  const warnings: string[] = []
  const recording = Logger.layer([Logger.make((entry) => void warnings.push([entry.message].flat().map(String).join(' ')))])
  const typed = await Effect.runPromise(
    validateOptions({ custom: { nested: { '': {}, '\u0000': 1n } } }, forkCoreSchema).pipe(Effect.provide(recording)),
  )
  const nested = (typed as unknown as { custom: { nested: object } }).custom.nested
  expect(warnings).toEqual([])
})
