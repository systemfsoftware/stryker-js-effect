import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Exit from 'effect/Exit'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { classifyRunOutcome, RunFailed, type RunOutcomeDecision } from '../classify-run-outcome.workflow.js'
import { runOutcomeCommandOf } from '../conclude-run.js'

const CWD = '/project'
const ARGS = ['run', '--dryRunOnly']

const outcomeOf = (cause: Cause.Cause<object>): RunOutcomeDecision =>
  Result.getOrElse(
    classifyRunOutcome(runOutcomeCommandOf({ exit: Exit.failCause(cause), argv: ARGS, cwd: CWD, traceId: null })),
    (impossible) => impossible,
  )

const failedOf = (outcome: RunOutcomeDecision): RunFailed | undefined => S.is(RunFailed)(outcome) ? outcome : undefined

const errorChainOf = (messages: Arr.NonEmptyReadonlyArray<string>, innermost: object): object =>
  Arr.reduce(
    [...messages].reverse(),
    innermost,
    (inner, message) => Object.assign(new Error(message), { cause: inner }),
  )

const plainErrorChainOf = (messages: Arr.NonEmptyReadonlyArray<string>): Error => {
  const [innermost, ...outer] = [...messages].reverse()
  return Arr.reduce(
    outer,
    new Error(innermost),
    (inner, message) => Object.assign(new Error(message), { cause: inner }),
  )
}

const PRECEDENCE_LOW_TO_HIGH: ReadonlyArray<number> = [130, 1, 2, 5, 3, 4]

const rankOf = (code: FailureRecord.FailureCode): number =>
  PRECEDENCE_LOW_TO_HIGH.indexOf(FailureRecord.FailureCatalog[code].exitCode ?? 4)

const shortChain = () => S.NonEmptyArray(S.String).check(S.isMaxLength(8))

describe('classifyRunOutcome', () => {
  it.prop(
    '∀evidence_RunOutcome_≡RecordOfTheDeclaredEvidenceWithItsCatalogExitCode',
    { of: [FailureRecord.FailureEvidence, shortChain()], subject: outcomeOf },
    (subject, [evidence, wrappers]) => {
      const failed = failedOf(subject(Cause.fail(errorChainOf(wrappers, { evidence }))))
      const facts = FailureRecord.FailureCatalog[evidence._tag]
      return failed !== undefined && Predicate.isTagged(failed.record, evidence._tag) &&
        failed.record.stage === evidence.stage && failed.code === (facts.exitCode ?? 4) &&
        failed.record.nextAction.primary === facts.nextAction.primary &&
        failed.record.nextAction.otherwise === facts.nextAction.otherwise &&
        failed.record.cause.length === wrappers.length + 1
    },
  )

  it.prop(
    '∀messages_RunOutcome_≡UnclassifiedFailureIsACatalogGapCarryingEveryMessage',
    { of: [shortChain()], subject: outcomeOf },
    (subject, [messages]) => {
      const failed = failedOf(subject(Cause.fail(plainErrorChainOf(messages))))
      return failed !== undefined && failed.code === 4 && Predicate.isTagged(failed.record, 'CatalogGap') &&
        failed.record.cause.map((link) => link.message).join('\u0000') === messages.join('\u0000')
    },
  )

  it.prop(
    '∀first,second_RunOutcome_≡TheMoreSevereFailureDecidesTheRun',
    { of: [FailureRecord.FailureEvidence, FailureRecord.FailureEvidence], subject: outcomeOf },
    (subject, [first, second]) => {
      const failed = failedOf(subject(Cause.combine(Cause.fail({ evidence: first }), Cause.fail({ evidence: second }))))
      const expected = rankOf(second._tag) > rankOf(first._tag) ? second : first
      return failed !== undefined && Predicate.isTagged(failed.record, expected._tag)
    },
  )

  it.prop(
    '∀fiber_RunOutcome_≡AnInterruptOnlyRunExits130WithARunInterruptedRecord',
    { of: [S.Int.check(S.isGreaterThanOrEqualTo(0))], subject: outcomeOf },
    (subject, [fiberId]) => {
      const failed = failedOf(subject(Cause.interrupt(fiberId)))
      return failed?.code === 130 && Predicate.isTagged(failed.record, 'RunInterrupted')
    },
  )
})
