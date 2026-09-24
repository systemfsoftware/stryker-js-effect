import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import { STATE_KEY } from './harness-sources.schema.js'
import type { VmRunnerGlobalState } from './sandbox.schema.js'

type AnyDecoded<A = unknown> = A

const isGlobalState = (value: AnyDecoded): value is VmRunnerGlobalState => Predicate.isObject(value)

export const readGlobalState = (): VmRunnerGlobalState | undefined => {
  const stored: AnyDecoded = Reflect.get(globalThis, STATE_KEY)
  return Option.getOrUndefined(Option.liftPredicate(isGlobalState)(stored))
}

export const writeGlobalState = (state: VmRunnerGlobalState | undefined): void => {
  Reflect.set(globalThis, STATE_KEY, state)
}

export const readGlobalStateCell: Cell.Cell<void, VmRunnerGlobalState | undefined> = Cell.fromEffect(
  Effect.sync(readGlobalState),
)

export const writeGlobalStateCell: Cell.Cell<VmRunnerGlobalState | undefined, void> = Cell.mapInput(
  Cell.id<VmRunnerGlobalState | undefined>(),
  (state) => {
    writeGlobalState(state)
    return undefined
  },
)
