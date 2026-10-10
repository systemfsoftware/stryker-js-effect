import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Incremental } from '@systemfsoftware/stryker-js-contracts'
import * as S from 'effect/Schema'

const DiffScopeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/DiffScopeDecision')
type DiffScopeTypeId = typeof DiffScopeTypeId

export class DiffScopeCommand extends S.TaggedClass<DiffScopeCommand>()('DiffScopeCommand', {
  hunks: S.Array(Incremental.DiffHunk),
  untrackedFiles: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class DiffScoped extends S.TaggedClass<DiffScoped>()('DiffScoped', {
  ranges: S.Array(S.String),
}) {
  readonly [DiffScopeTypeId] = DiffScopeTypeId
}

export class FullScope extends S.TaggedClass<FullScope>()('FullScope', {
  reason: S.String,
}) {
  readonly [DiffScopeTypeId] = DiffScopeTypeId
}

export const DiffScopeDecision = S.Union([DiffScoped, FullScope])
export type DiffScopeDecision = typeof DiffScopeDecision.Type
