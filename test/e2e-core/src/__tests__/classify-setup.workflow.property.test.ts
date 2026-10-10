import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type BenchSide } from '../bench-run.schema.js'
import { classifySetup, ClassifySetupCommand } from '../classify-setup.workflow.js'
import {
  SetupFailure,
  SetupInconclusive,
  SetupProceed,
  SetupRecovery,
  SetupRed,
  SetupVerdict,
  SideSetup,
} from '../setup-outcome.schema.js'

const Step = S.Literals(['build', 'install', 'pack'])
const Kind = S.Literals(['exited', 'overran', 'out-of-time'])

type FailureKind = typeof Kind.Type

const failureMakers: {
  readonly [K in FailureKind]: (
    fields: { readonly step: string; readonly reason: string; readonly outputTail: string },
  ) => SetupFailure
} = {
  exited: (fields) => SetupFailure.cases.exited.make(fields),
  overran: (fields) => SetupFailure.cases.overran.make(fields),
  'out-of-time': (fields) => SetupFailure.cases['out-of-time'].make(fields),
}

const noneRecovery = (): SetupRecovery => SetupRecovery.cases.none.make({})
const retriedRecovery = (head: string, tail: ReadonlyArray<string>): SetupRecovery =>
  SetupRecovery.cases.retried.make({ steps: Arr.prepend(tail, head) })
const readySetup = (recovered: SetupRecovery): SideSetup => SideSetup.cases.ready.make({ recovered })
const failedSetup = (failure: SetupFailure): SideSetup => SideSetup.cases.failed.make({ failure })

const stepArb = Arbitrary.schema(Step)
const kindArb = Arbitrary.schema(Kind)
const textArb = Arbitrary.schema(S.String)
const boolArb = Arbitrary.schema(S.Boolean)

const failureArb = Arbitrary.map(
  Arbitrary.all([stepArb, kindArb, textArb, textArb]),
  ([step, kind, reason, outputTail]) => failureMakers[kind]({ step, reason, outputTail }),
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
  return recovered !== null && recovered._tag === 'retried' && recovered.steps.includes(step)
}

const ruleExternal = (a: SideSetup, b: SideSetup): boolean => {
  const bFailure = failureOf(b)
  if (bFailure === null) return false
  const bKind = bFailure._tag
  if (bKind !== 'exited' && bKind !== 'overran') return false
  const aFailure = failureOf(a)
  if (aFailure !== null) return aFailure.step === bFailure.step && aFailure._tag === bKind
  return bKind === 'exited' && retriedAt(a, bFailure.step)
}

const soleOutOfTimeSide = (a: SideSetup, b: SideSetup): BenchSide | null => {
  const aFailure = failureOf(a)
  const bFailure = failureOf(b)
  if (aFailure !== null && bFailure === null && aFailure._tag === 'out-of-time') return 'A'
  if (bFailure !== null && aFailure === null && bFailure._tag === 'out-of-time') return 'B'
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
      const baseCase = S.is(SideSetup.cases.ready)(b) && aFailure !== null && aFailure._tag !== 'out-of-time'
      if (!baseCase) return true
      return isInconclusive(verdict) && verdict.code === 'base-setup-failed' && aFailure !== null &&
        verdict.step === aFailure.step
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
      return (verdict.code === 'side-setup-failed') === (namedFailure._tag === 'exited')
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
    'AE1_∀s_BInstallExitedAtS_≡RedSideSetupFailedNamingB',
    { of: [S.NonEmptyString, S.String], subject: classifySetup },
    (subject, [step, reason]) => {
      const a = readySetup(noneRecovery())
      const b = failedSetup(failureMakers.exited({ step, reason, outputTail: '' }))
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isRed(verdict) && verdict.side === 'B' && verdict.code === 'side-setup-failed' &&
        verdict.step === step && verdict.reason.includes(reason)
    },
  )

  it.prop(
    'AE2_∀s_BothInstallsOverranAtS_≡InconclusiveSetupExternal',
    { of: [S.NonEmptyString, S.String, S.String], subject: classifySetup },
    (subject, [step, reasonA, reasonB]) => {
      const a = failedSetup(failureMakers.overran({ step, reason: reasonA, outputTail: '' }))
      const b = failedSetup(failureMakers.overran({ step, reason: reasonB, outputTail: '' }))
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isInconclusive(verdict) && verdict.code === 'setup-external' && verdict.step === step &&
        verdict.reason.includes(reasonA) && verdict.reason.includes(reasonB)
    },
  )

  it.prop(
    'AE3_∀s_AInstallOverranBInstallExitedAtS_≡RedWithSideSetupFailedNamingB',
    { of: [S.NonEmptyString], subject: classifySetup },
    (subject, [step]) => {
      const a = failedSetup(failureMakers.overran({ step, reason: 'A overran', outputTail: '' }))
      const b = failedSetup(failureMakers.exited({ step, reason: 'B exited', outputTail: '' }))
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isRed(verdict) && verdict.side === 'B' && verdict.code === 'side-setup-failed' && verdict.step === step
    },
  )

  it.prop(
    'AE5_∀s_AClosureBuildExitedAtS_≡InconclusiveBaseSetupFailedNamingA',
    { of: [S.NonEmptyString, S.String], subject: classifySetup },
    (subject, [step, reason]) => {
      const a = failedSetup(failureMakers.exited({ step, reason, outputTail: '' }))
      const b = readySetup(noneRecovery())
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isInconclusive(verdict) && verdict.code === 'base-setup-failed' && verdict.step === step &&
        verdict.reason.includes(reason)
    },
  )

  it.prop(
    'AE6_∀s_ARecoveredOnRetryAtSBExitedAtS_≡InconclusiveSetupExternal',
    { of: [S.NonEmptyString], subject: classifySetup },
    (subject, [step]) => {
      const a = readySetup(retriedRecovery(step, []))
      const b = failedSetup(failureMakers.exited({ step, reason: 'B exited', outputTail: '' }))
      const verdict = Result.getOrThrow(subject(commandOf(a, b)))
      return isInconclusive(verdict) && verdict.code === 'setup-external' && verdict.step === step
    },
  )
})
