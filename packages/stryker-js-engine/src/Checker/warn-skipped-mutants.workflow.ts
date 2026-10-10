import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { UndescribableMutant } from './Checker.schema.js'

const SKIPPED_IDS_IN_WARNING = 5

const SkipWarningTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/SkipWarning')
type SkipWarningTypeId = typeof SkipWarningTypeId

export class WarnSkippedMutantsCommand extends S.TaggedClass<WarnSkippedMutantsCommand>()('WarnSkippedMutantsCommand', {
  checkerName: S.String,
  skipped: S.Array(UndescribableMutant),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    checkerName: 'stryker.checker.name',
  } as const
}

export class NoMutantSkipped extends S.TaggedClass<NoMutantSkipped>()('NoMutantSkipped', {}) {
  readonly [SkipWarningTypeId] = SkipWarningTypeId
}

const SkippedCount = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(1)))

export class MutantsSkippedWarned extends S.TaggedClass<MutantsSkippedWarned>()('MutantsSkippedWarned', {
  skipped: SkippedCount,
  warning: S.String,
}) {
  readonly [SkipWarningTypeId] = SkipWarningTypeId
}

export const SkipWarning = S.Union([NoMutantSkipped, MutantsSkippedWarned])
export type SkipWarning = typeof SkipWarning.Type

const moreSuffixOf = (count: number): string =>
  Option.getOrElse(
    Option.map(
      Option.liftPredicate(count, (total) => total > SKIPPED_IDS_IN_WARNING),
      (total) => `, +${total - SKIPPED_IDS_IN_WARNING} more`,
    ),
    () => '',
  )

const skippedIdsOf = (skipped: readonly UndescribableMutant[]): string =>
  `${Arr.take(skipped, SKIPPED_IDS_IN_WARNING).map((mutant) => mutant.id).join(', ')}${moreSuffixOf(skipped.length)}`

const refusalReasonsOf = (skipped: readonly UndescribableMutant[]): string =>
  Arr.dedupe(skipped.map((mutant) => mutant.reason)).join('; ')

const warningOf = (command: WarnSkippedMutantsCommand): MutantsSkippedWarned =>
  MutantsSkippedWarned.make({
    skipped: command.skipped.length,
    warning: `Checker "${command.checkerName}" skipped ${command.skipped.length} mutant(s) it cannot be told about: ${
      refusalReasonsOf(command.skipped)
    } (${skippedIdsOf(command.skipped)})`,
  })

const decide = (command: WarnSkippedMutantsCommand): Result.Result<SkipWarning, never> =>
  Match.value(Arr.isReadonlyArrayNonEmpty(command.skipped)).pipe(
    Match.when(false, (): Result.Result<SkipWarning, never> => Result.succeed(NoMutantSkipped.make({}))),
    Match.when(true, (): Result.Result<SkipWarning, never> => Result.succeed(warningOf(command))),
    Match.exhaustive,
  )

export const warnSkippedMutants = Workflow.make({
  command: WarnSkippedMutantsCommand,
  decision: SkipWarning,
  error: S.Never,
  decide,
})
