import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type BenchSide } from '../bench-run.schema.js'
import { classifySetup, ClassifySetupCommand } from '../classify-setup.workflow.js'
import {
  SetupFailure,
  SetupInconclusive,
  SetupProceed,
  SetupRecovery,
  setupRecoveryOf,
  SetupRed,
  SetupVerdict,
  SideSetup,
} from '../setup-outcome.schema.js'

type FailureKind = 'exited' | 'overran' | 'out-of-time'

interface FailureFields {
  readonly step: string
  readonly firstAttempt: FailureKind
  readonly reason: string
  readonly outputTail: string
}

const failureMakers: { readonly [K in FailureKind]: (fields: FailureFields) => SetupFailure } = {
  exited: (fields) => SetupFailure.cases.exited.make(fields),
  overran: (fields) => SetupFailure.cases.overran.make(fields),
  'out-of-time': (fields) => SetupFailure.cases['out-of-time'].make(fields),
}

const onceFailed = (kind: FailureKind, step: string, reason: string): SetupFailure =>
  failureMakers[kind]({ step, firstAttempt: kind, reason, outputTail: '' })

const noneRecovery = (): SetupRecovery => SetupRecovery.cases.none.make({})
const retriedRecovery = (head: string, tail: ReadonlyArray<string>): SetupRecovery =>
  SetupRecovery.cases.retried.make({ steps: Arr.prepend(tail, head) })
const readySetup = (recovered: SetupRecovery): SideSetup => SideSetup.cases.ready.make({ recovered })
const failedSetup = (failure: SetupFailure): SideSetup => SideSetup.cases.failed.make({ failure })

const isExited = S.is(SetupFailure.cases.exited)
const isOutOfTime = S.is(SetupFailure.cases['out-of-time'])
const isRetried = S.is(SetupRecovery.cases.retried)

const stepArb = Arbitrary.schema(S.Literals(['build', 'install', 'pack']))
const kindArb = Arbitrary.schema(S.Literals(['exited', 'overran', 'out-of-time']))
const textArb = Arbitrary.schema(S.String)
const boolArb = Arbitrary.schema(S.Boolean)

const failureArb = Arbitrary.map(
  Arbitrary.all([stepArb, kindArb, kindArb, textArb, textArb]),
  ([step, kind, firstAttempt, reason, outputTail]) => failureMakers[kind]({ step, firstAttempt, reason, outputTail }),
)

const recoveryArb = Arbitrary.map(
  Arbitrary.all([stepArb, Arbitrary.array(stepArb, { maxLength: 2 }), boolArb]),
  ([head, tail, retried]) => retried ? retriedRecovery(head, tail) : noneRecovery(),
)

const sideSetupArb = Arbitrary.map(
  Arbitrary.all([boolArb, recoveryArb, failureArb]),
  ([ready, recovered, failure]) => ready ? readySetup(recovered) : failedSetup(failure),
)

const commandOf = (a: SideSetup, b: SideSetup): ClassifySetupCommand => ClassifySetupCommand.make({ A: a, B: b })

const failureOf = (side: SideSetup): SetupFailure | null => S.is(SideSetup.cases.failed)(side) ? side.failure : null

const recoveryOf = (side: SideSetup): SetupRecovery | null => S.is(SideSetup.cases.ready)(side) ? side.recovered : null

const retriedAt = (side: SideSetup, step: string): boolean => {
  const recovered = recoveryOf(side)
  return recovered !== null && isRetried(recovered) && recovered.steps.includes(step)
}

const outageShaped = (failure: SetupFailure): boolean =>
  (failure.firstAttempt === 'exited' || failure.firstAttempt === 'overran') && !isOutOfTime(failure)

const ruleExternal = (a: SideSetup, b: SideSetup): boolean => {
  const bFailure = failureOf(b)
  if (bFailure === null || !outageShaped(bFailure)) return false
  const aFailure = failureOf(a)
  if (aFailure !== null) {
    return outageShaped(aFailure) && aFailure.step === bFailure.step &&
      aFailure.firstAttempt === bFailure.firstAttempt
  }
  return bFailure.firstAttempt === 'exited' && retriedAt(a, bFailure.step)
}

const soleOutOfTimeSide = (a: SideSetup, b: SideSetup): BenchSide | null => {
  const aFailure = failureOf(a)
  const bFailure = failureOf(b)
  if (aFailure !== null && bFailure === null && isOutOfTime(aFailure)) return 'A'
  if (bFailure !== null && aFailure === null && isOutOfTime(bFailure)) return 'B'
  return null
}

const namedFailureOf = (verdict: SetupVerdict, a: SideSetup, b: SideSetup): SetupFailure | null => {
  if (S.is(SetupRed)(verdict)) return verdict.side === 'A' ? failureOf(a) : failureOf(b)
  if (S.is(SetupInconclusive)(verdict)) {
    return verdict.code === 'setup-external' ? failureOf(b) : failureOf(a)
  }
  return null
}

const isRed = S.is(SetupRed)
const isProceed = S.is(SetupProceed)
const isInconclusive = S.is(SetupInconclusive)

const isExternal = (verdict: SetupVerdict): boolean => isInconclusive(verdict) && verdict.code === 'setup-external'

describe('classifySetup', () => {
  it.prop(
    '∀ab_BothReady_≡Proceed',
    { of: [sideSetupArb, sideSetupArb], subject: classifySetup },
    (subject, [a, b]) => {
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      const bothReady = S.is(SideSetup.cases.ready)(a) && S.is(SideSetup.cases.ready)(b)
      return isProceed(verdict) === bothReady
    },
  )

  it.prop(
    '∀ab_SetupExternal_≡RuleThree',
    { of: [sideSetupArb, sideSetupArb], subject: classifySetup },
    (subject, [a, b]) => {
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isExternal(verdict) === ruleExternal(a, b)
    },
  )

  it.prop(
    '∀ab_OutOfTimeBesideReady_≡RedSetupTimedOutNamingTheFailedSide',
    { of: [sideSetupArb, sideSetupArb], subject: classifySetup },
    (subject, [a, b]) => {
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      const named = soleOutOfTimeSide(a, b)
      if (named === null) return true
      const namedFailure = named === 'A' ? failureOf(a) : failureOf(b)
      return isRed(verdict) && verdict.side === named && verdict.code === 'setup-timed-out' &&
        namedFailure !== null && verdict.step === namedFailure.step
    },
  )

  it.prop(
    '∀ab_ReadyBWithFailedA_≡BaseSetupFailedNamingA',
    { of: [sideSetupArb, sideSetupArb], subject: classifySetup },
    (subject, [a, b]) => {
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      const aFailure = failureOf(a)
      const baseCase = S.is(SideSetup.cases.ready)(b) && aFailure !== null && !isOutOfTime(aFailure)
      if (!baseCase) return true
      return isInconclusive(verdict) && verdict.code === 'base-setup-failed' && verdict.step === aFailure.step
    },
  )

  it.prop(
    '∀ab_Red_≡NamesAFailedSideAndBFirstWhenBFailed',
    { of: [sideSetupArb, sideSetupArb], subject: classifySetup },
    (subject, [a, b]) => {
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      if (!isRed(verdict)) return true
      const namedFailure = verdict.side === 'A' ? failureOf(a) : failureOf(b)
      if (namedFailure === null) return false
      return failureOf(b) === null || verdict.side === 'B'
    },
  )

  it.prop(
    '∀ab_RedCode_≡SideSetupFailedExactlyWhenTheNamedFailureExited',
    { of: [sideSetupArb, sideSetupArb], subject: classifySetup },
    (subject, [a, b]) => {
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      if (!isRed(verdict)) return true
      const namedFailure = verdict.side === 'A' ? failureOf(a) : failureOf(b)
      if (namedFailure === null) return false
      return (verdict.code === 'side-setup-failed') === isExited(namedFailure)
    },
  )

  it.prop(
    '∀ab_VerdictStep_≡NamedFailureStep',
    { of: [sideSetupArb, sideSetupArb], subject: classifySetup },
    (subject, [a, b]) => {
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      if (!isRed(verdict) && !isInconclusive(verdict)) return true
      const namedFailure = namedFailureOf(verdict, a, b)
      return namedFailure !== null && verdict.step === namedFailure.step
    },
  )
})

describe('classifySetup acceptance examples', () => {
  it.prop(
    '∀s_AeOneBInstallExitedAtS_≡RedSideSetupFailedNamingB',
    { of: [S.NonEmptyString, S.String], subject: classifySetup },
    (subject, [step, reason]) => {
      const a = readySetup(noneRecovery())
      const b = failedSetup(onceFailed('exited', step, reason))
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isRed(verdict) && verdict.side === 'B' && verdict.code === 'side-setup-failed' &&
        verdict.step === step && verdict.reason.includes(reason)
    },
  )

  it.prop(
    '∀s_AeTwoBothInstallsOverranAtS_≡InconclusiveSetupExternal',
    { of: [S.NonEmptyString, S.String, S.String], subject: classifySetup },
    (subject, [step, reasonA, reasonB]) => {
      const a = failedSetup(onceFailed('overran', step, reasonA))
      const b = failedSetup(onceFailed('overran', step, reasonB))
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isInconclusive(verdict) && verdict.code === 'setup-external' && verdict.step === step &&
        verdict.reason.includes(reasonA) && verdict.reason.includes(reasonB)
    },
  )

  it.prop(
    '∀s_AeThreeAInstallOverranBInstallExitedAtS_≡RedWithSideSetupFailedNamingB',
    { of: [S.NonEmptyString], subject: classifySetup },
    (subject, [step]) => {
      const a = failedSetup(onceFailed('overran', step, 'A overran'))
      const b = failedSetup(onceFailed('exited', step, 'B exited'))
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isRed(verdict) && verdict.side === 'B' && verdict.code === 'side-setup-failed' && verdict.step === step
    },
  )

  it.prop(
    '∀s_AeFiveAClosureBuildExitedAtS_≡InconclusiveBaseSetupFailedNamingA',
    { of: [S.NonEmptyString, S.String], subject: classifySetup },
    (subject, [step, reason]) => {
      const a = failedSetup(onceFailed('exited', step, reason))
      const b = readySetup(noneRecovery())
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isInconclusive(verdict) && verdict.code === 'base-setup-failed' && verdict.step === step &&
        verdict.reason.includes(reason)
    },
  )

  it.prop(
    '∀s_AeSixARecoveredOnRetryAtSBExitedAtS_≡InconclusiveSetupExternal',
    { of: [S.NonEmptyString], subject: classifySetup },
    (subject, [step]) => {
      const a = readySetup(retriedRecovery(step, []))
      const b = failedSetup(onceFailed('exited', step, 'B exited'))
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isInconclusive(verdict) && verdict.code === 'setup-external' && verdict.step === step
    },
  )
})

describe('classifySetup with several retried steps', () => {
  it.prop(
    '∀es_RetriedStepsOfAEndingWhereBExited_≡InconclusiveSetupExternal',
    { of: [S.NonEmptyString.pipe(S.Option, S.Array), S.NonEmptyString], subject: classifySetup },
    (subject, [earlier, step]) => {
      const a = readySetup(setupRecoveryOf([...earlier, Option.some(step)]))
      const b = failedSetup(onceFailed('exited', step, 'B exited'))
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isInconclusive(verdict) && verdict.code === 'setup-external' && verdict.step === step
    },
  )

  it.prop(
    '∀s_FirstAttemptsBothExitedWhileTheRetryOfAHung_≡InconclusiveSetupExternal',
    { of: [S.NonEmptyString], subject: classifySetup },
    (subject, [step]) => {
      const a = failedSetup(failureMakers.overran({ step, firstAttempt: 'exited', reason: 'A hung', outputTail: '' }))
      const b = failedSetup(onceFailed('exited', step, 'B exited twice'))
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isInconclusive(verdict) && verdict.code === 'setup-external' && verdict.step === step &&
        verdict.reason.includes('exited, then overran on its retry')
    },
  )
})
