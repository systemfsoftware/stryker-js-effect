import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const KeepTempDirTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/KeepTempDir')
type KeepTempDirTypeId = typeof KeepTempDirTypeId

export class KeepTempDirAlways extends S.TaggedClass<KeepTempDirAlways>()('KeepTempDirAlways', {}) {
  readonly [KeepTempDirTypeId] = KeepTempDirTypeId
}

export class KeepTempDirOnFailure extends S.TaggedClass<KeepTempDirOnFailure>()('KeepTempDirOnFailure', {
  failed: S.Boolean,
}) {
  readonly [KeepTempDirTypeId] = KeepTempDirTypeId
}

export const KeepTempDirOption = S.Union([KeepTempDirAlways, KeepTempDirOnFailure])
export type KeepTempDirOption = typeof KeepTempDirOption.Type

export class TempDirKept extends S.TaggedClass<TempDirKept>()('TempDirKept', {}) {
  readonly [KeepTempDirTypeId] = KeepTempDirTypeId
}

export class TempDirRemoved extends S.TaggedClass<TempDirRemoved>()('TempDirRemoved', {}) {
  readonly [KeepTempDirTypeId] = KeepTempDirTypeId
}

export type KeepTempDirOutcome = TempDirKept | TempDirRemoved

export class KeepTempDirCommand extends S.TaggedClass<KeepTempDirCommand>()('KeepTempDirCommand', {
  cleanTempDir: KeepTempDirOption,
  failed: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decide = (command: KeepTempDirCommand): Result.Result<KeepTempDirOutcome, never> =>
  Match.value(command.cleanTempDir).pipe(
    Match.tag('KeepTempDirAlways', () => Result.succeed(TempDirRemoved.make({}))),
    Match.tag('KeepTempDirOnFailure', (option) =>
      Match.value(option.failed).pipe(
        Match.when(true, () => Result.succeed(TempDirKept.make({}))),
        Match.when(false, () => Result.succeed(TempDirRemoved.make({}))),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

export const keepTempDir = Workflow.make({
  command: KeepTempDirCommand,
  decision: S.Union([TempDirKept, TempDirRemoved]),
  error: S.Never,
  decide,
})
