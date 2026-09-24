import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import type { HarnessApi } from '../core/registry.js'
import { STATE_KEY } from '../core/sources.js'

export interface EffectVitestSurface<A = unknown> {
  readonly it: A
}

export interface VmRunnerGlobalState {
  readonly api: HarnessApi
  readonly expect: object | undefined
  readonly vi: object | undefined
  readonly effectVitest: EffectVitestSurface | undefined
}

export const readGlobalState = (): VmRunnerGlobalState | undefined =>
  (globalThis as Record<symbol, VmRunnerGlobalState | undefined>)[STATE_KEY]

export const writeGlobalState = (state: VmRunnerGlobalState | undefined): void => {
  ;(globalThis as Record<symbol, VmRunnerGlobalState | undefined>)[STATE_KEY] = state
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
