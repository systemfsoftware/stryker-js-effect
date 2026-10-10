import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type BenchSide } from './bench-run.schema.js'
import {
  type SetupFailure,
  type SetupFailureKind,
  SetupInconclusive,
  type SetupInconclusiveCode,
  SetupProceed,
  type SetupRecovery,
  SetupRed,
  type SetupRedCode,
  SetupVerdict,
  SideSetup,
} from './setup-outcome.schema.js'

export class ClassifySetupCommand extends S.TaggedClass<ClassifySetupCommand>()('ClassifySetupCommand', {
  A: SideSetup,
  B: SideSetup,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

type OtherFailure = readonly [BenchSide, SetupFailure]

const kindOf = (failure: SetupFailure): SetupFailureKind => failure._tag

const RED_CODE: { readonly [K in SetupFailureKind]: SetupRedCode } = {
  exited: 'side-setup-failed',
  overran: 'setup-timed-out',
  'out-of-time': 'setup-timed-out',
}

const failureOf = (side: SideSetup): Option.Option<SetupFailure> =>
  Match.valueTags(side, {
    ready: () => Option.none<SetupFailure>(),
    failed: (failed) => Option.some(failed.failure),
  })

const recoveryOf = (side: SideSetup): Option.Option<SetupRecovery> =>
  Match.valueTags(side, {
    ready: (ready) => Option.some(ready.recovered),
    failed: () => Option.none<SetupRecovery>(),
  })

const retriedAt = (side: SideSetup, step: string): boolean =>
  Option.exists(recoveryOf(side), (recovery) =>
    Match.valueTags(recovery, {
      none: () => false,
      retried: (retried) => Arr.contains(retried.steps, step),
    }))

const attemptsOf = (failure: SetupFailure): string =>
  Boolean.match(failure.firstAttempt === kindOf(failure), {
    onTrue: () => kindOf(failure),
    onFalse: () => `${failure.firstAttempt}, then ${kindOf(failure)} on its retry`,
  })

const describeFailure = (side: BenchSide, failure: SetupFailure): string =>
  Arr.join(
    Arr.filter(
      [`side ${side} failed at step ${failure.step} (${attemptsOf(failure)}): ${failure.reason}`, failure.outputTail],
      (part) => part.length > 0,
    ),
    '; ',
  )

const redReason = (side: BenchSide, failure: SetupFailure, also: Option.Option<OtherFailure>): string =>
  Option.match(also, {
    onNone: () => describeFailure(side, failure),
    onSome: ([otherSide, otherFailure]) =>
      `${describeFailure(side, failure)}; ${describeFailure(otherSide, otherFailure)}`,
  })

const NO_OTHER: Option.Option<OtherFailure> = Option.none()

const proceedVerdict = (): SetupVerdict => SetupProceed.make({})

const inconclusiveVerdict = (
  code: SetupInconclusiveCode,
  step: string,
  reason: string,
): SetupVerdict => SetupInconclusive.make({ code, step, reason })

const redVerdict = (
  side: BenchSide,
  failure: SetupFailure,
  also: Option.Option<OtherFailure>,
): SetupVerdict =>
  SetupRed.make({
    side,
    code: RED_CODE[kindOf(failure)],
    step: failure.step,
    reason: redReason(side, failure, also),
  })

const baseVerdict = (failure: SetupFailure): SetupVerdict =>
  inconclusiveVerdict('base-setup-failed', failure.step, describeFailure('A', failure))

const externalVerdict = (failure: SetupFailure, also: Option.Option<OtherFailure>): SetupVerdict =>
  inconclusiveVerdict(
    'setup-external',
    failure.step,
    Option.match(also, {
      onNone: () => `${describeFailure('B', failure)}; side A recovered on its retry at step ${failure.step}`,
      onSome: ([otherSide, otherFailure]) =>
        `${describeFailure('B', failure)}; ${describeFailure(otherSide, otherFailure)}`,
    }),
  )

const externalKind = (kind: SetupFailureKind): boolean => Boolean.or(kind === 'exited', kind === 'overran')

const outageShaped = (failure: SetupFailure): boolean =>
  Boolean.and(externalKind(failure.firstAttempt), kindOf(failure) !== 'out-of-time')

const externalAt = (aFailure: SetupFailure, bFailure: SetupFailure): boolean =>
  Boolean.and(
    Boolean.and(outageShaped(aFailure), outageShaped(bFailure)),
    Boolean.and(aFailure.step === bFailure.step, aFailure.firstAttempt === bFailure.firstAttempt),
  )

const externalRecovered = (a: SideSetup, bFailure: SetupFailure): boolean =>
  Boolean.and(
    Boolean.and(bFailure.firstAttempt === 'exited', kindOf(bFailure) !== 'out-of-time'),
    retriedAt(a, bFailure.step),
  )

const classify = (a: SideSetup, b: SideSetup): SetupVerdict =>
  Option.match(failureOf(b), {
    onNone: () =>
      Option.match(failureOf(a), {
        onNone: proceedVerdict,
        onSome: (aFailure) =>
          Boolean.match(kindOf(aFailure) === 'out-of-time', {
            onTrue: () => redVerdict('A', aFailure, NO_OTHER),
            onFalse: () => baseVerdict(aFailure),
          }),
      }),
    onSome: (bFailure) =>
      Option.match(failureOf(a), {
        onNone: () =>
          Boolean.match(externalRecovered(a, bFailure), {
            onTrue: () => externalVerdict(bFailure, NO_OTHER),
            onFalse: () => redVerdict('B', bFailure, NO_OTHER),
          }),
        onSome: (aFailure) =>
          Boolean.match(externalAt(aFailure, bFailure), {
            onTrue: () => externalVerdict(bFailure, Option.some<OtherFailure>(['A', aFailure])),
            onFalse: () => redVerdict('B', bFailure, Option.some<OtherFailure>(['A', aFailure])),
          }),
      }),
  })

const decide = (command: ClassifySetupCommand): Result.Result<SetupVerdict, never> =>
  Result.succeed(classify(command.A, command.B))

export const classifySetup = Workflow.make({
  command: ClassifySetupCommand,
  decision: SetupVerdict,
  error: S.Never,
  decide,
})
