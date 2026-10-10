import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { UndescribableMutant } from '../Checker/Checker.schema.js'
import {
  MutantsSkippedWarned,
  NoMutantSkipped,
  warnSkippedMutants,
  WarnSkippedMutantsCommand,
} from '../Checker/warn-skipped-mutants.workflow.js'

const commandArb = Arbitrary.all([
  Arbitrary.schema(S.String),
  Arbitrary.array(Arbitrary.schema(UndescribableMutant), { maxLength: 12 }),
]).pipe(
  Arbitrary.map(([checkerName, skipped]) => WarnSkippedMutantsCommand.make({ checkerName, skipped })),
)

const expectedWarningOf = (command: WarnSkippedMutantsCommand): string => {
  const count = command.skipped.length
  const shown = command.skipped.slice(0, 5).map((mutant) => mutant.id)
  const hidden = count > 5 ? `, +${count - 5} more` : ''
  const reasons = [...new Set(command.skipped.map((mutant) => mutant.reason))]
  return `Checker "${command.checkerName}" skipped ${count} mutant(s) it cannot be told about: ${reasons.join('; ')} (${
    shown.join(', ')
  }${hidden})`
}

describe('warnSkippedMutants', () => {
  it.prop(
    '∀s_Quiet_≡NothingSkipped',
    { of: [commandArb], subject: warnSkippedMutants },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) => S.is(NoMutantSkipped)(decision) === (command.skipped.length === 0),
      }),
  )

  it.prop(
    '∀s_Warning_≡CountFirstFiveIdsAndDistinctReasons',
    { of: [commandArb], subject: warnSkippedMutants },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          !S.is(MutantsSkippedWarned)(decision) ||
          (decision.skipped === command.skipped.length && decision.warning === expectedWarningOf(command)),
      }),
  )

  it.prop(
    '∀n_SkippedCountRefusal_≡AtLeastOne',
    { of: [S.Int, S.String], subject: S.decodeUnknownResult(MutantsSkippedWarned) },
    (subject, [drawn, warning]) =>
      Arr.every(
        Arr.append([-1, 0, 1, Number.MAX_SAFE_INTEGER], drawn),
        (skipped) =>
          Result.isSuccess(subject({ _tag: 'MutantsSkippedWarned', skipped, warning })) ===
            (Number.isSafeInteger(skipped) && skipped >= 1),
      ),
  )
})
