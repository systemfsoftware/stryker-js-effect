import { Cell, Handle } from '@systemfsoftware/effect-cell-types'
import type * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'

import type { RunStageServices } from '../run/StageServices.service.js'

export const TypeId: unique symbol = Symbol.for('~systemfsoftware/stryker-js/Mcp/RerunStage')
export type TypeId = typeof TypeId

const RerunStageHandle = Handle.make<Record<never, never>, Context.Context<RunStageServices>>()(TypeId)

export type RerunStageHandle = Handle.Of<typeof RerunStageHandle>

export const isRerunStageHandle = RerunStageHandle.is

export const makeRerunStageHandle = (stage: Context.Context<RunStageServices>): RerunStageHandle =>
  RerunStageHandle.make({}, stage)

export const run: {
  <I, A, E, R>(
    cell: Cell.Cell<I, A, E, R>,
    input: I,
  ): (handle: RerunStageHandle) => Effect.Effect<A, E, Exclude<R, RunStageServices>>
  <I, A, E, R>(
    handle: RerunStageHandle,
    cell: Cell.Cell<I, A, E, R>,
    input: I,
  ): Effect.Effect<A, E, Exclude<R, RunStageServices>>
} = dual(
  3,
  <I, A, E, R>(
    handle: RerunStageHandle,
    cell: Cell.Cell<I, A, E, R>,
    input: I,
  ): Effect.Effect<A, E, Exclude<R, RunStageServices>> =>
    Cell.provideContext(cell, RerunStageHandle.slot(handle)).run(input),
)
