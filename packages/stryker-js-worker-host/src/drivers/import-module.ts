import { Run } from '@systemfsoftware/stryker-js-contracts'
import * as Effect from 'effect/Effect'

export function importModule<A = unknown>(moduleName: string): Effect.Effect<A, Run.StrykerError> {
  return Effect.tryPromise({
    try: (): Promise<A> => import(moduleName),
    catch: (cause) => Run.StrykerError.make({ message: `Failed to import module "${moduleName}"`, cause }),
  })
}
