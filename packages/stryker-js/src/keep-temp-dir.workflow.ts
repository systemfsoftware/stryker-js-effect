import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const KeepTempDirTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/KeepTempDir')
type KeepTempDirTypeId = typeof KeepTempDirTypeId

const CleanTempDirOption = S.Literals(['always', false, true])

export class TempDirKept extends S.TaggedClass<TempDirKept, { readonly brand: unique symbol }>()('TempDirKept', {}) {
  readonly [KeepTempDirTypeId] = KeepTempDirTypeId
}

export class TempDirRemoved
  extends S.TaggedClass<TempDirRemoved, { readonly brand: unique symbol }>()('TempDirRemoved', {})
{
  readonly [KeepTempDirTypeId] = KeepTempDirTypeId
}

export type KeepTempDirOutcome = TempDirKept | TempDirRemoved

export class KeepTempDirCommand
  extends S.TaggedClass<KeepTempDirCommand, { readonly brand: unique symbol }>()('KeepTempDirCommand', {
    cleanTempDir: CleanTempDirOption,
    failed: S.Boolean,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const keptIff = (kept: boolean): KeepTempDirOutcome =>
  Match.value(kept).pipe(
    Match.when(true, () => TempDirKept.make({})),
    Match.when(false, () => TempDirRemoved.make({})),
    Match.exhaustive,
  )
const decide = (command: KeepTempDirCommand): Result.Result<KeepTempDirOutcome, never> =>
  Match.value(command.cleanTempDir).pipe(
    Match.when(false, () => TempDirKept.make({})),
    Match.when(true, () => keptIff(command.failed)),
    Match.when('always', () => TempDirRemoved.make({})),
    Match.exhaustive,
    Result.succeed,
  )
export const keepTempDir = Workflow.make({
  command: KeepTempDirCommand,
  decision: S.Union([TempDirKept, TempDirRemoved]),
  error: S.Never,
  decide,
})
