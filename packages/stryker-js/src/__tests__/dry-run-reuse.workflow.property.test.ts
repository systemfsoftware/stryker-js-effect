import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  DryRunCoverageReused,
  DryRunCoverageStale,
  dryRunReuse,
  DryRunReuseCommand,
  type DryRunReuseDecision,
} from '../dry-run-reuse.workflow.js'

type ReuseResult = Result.Result<DryRunReuseDecision, never>

interface ReuseFields {
  readonly prior?: DryRunReuseCommand['prior']
  readonly currentTestClosureDigest?: string | undefined
  readonly currentRunInputsDigest: string
  readonly force: boolean
}

const build = (fields: ReuseFields): DryRunReuseCommand =>
  DryRunReuseCommand.make({
    ...(fields.prior === undefined ? {} : { prior: fields.prior }),
    ...(fields.currentTestClosureDigest === undefined
      ? {}
      : { currentTestClosureDigest: fields.currentTestClosureDigest }),
    currentRunInputsDigest: fields.currentRunInputsDigest,
    force: fields.force,
  })

const staleReasonOf = (result: ReuseResult): string | undefined =>
  Result.isSuccess(result) && S.is(DryRunCoverageStale)(result.success) ? result.success.reason : undefined

const distinguishing = (value: string): string => `${value}-distinguishing`

const priorOf = (command: DryRunReuseCommand): DryRunReuseCommand['prior'] =>
  command.prior ?? {
    testClosureDigest: command.currentTestClosureDigest ?? 'prior-closure',
    runInputsDigest: command.currentRunInputsDigest,
  }

const matched = (command: DryRunReuseCommand): DryRunReuseCommand => {
  const prior = priorOf(command)
  return build({
    prior,
    currentTestClosureDigest: prior?.testClosureDigest ?? '',
    currentRunInputsDigest: prior?.runInputsDigest ?? command.currentRunInputsDigest,
    force: command.force,
  })
}

const forced = (command: DryRunReuseCommand): DryRunReuseCommand =>
  build({
    ...(command.prior === undefined ? {} : { prior: command.prior }),
    ...(command.currentTestClosureDigest === undefined
      ? {}
      : { currentTestClosureDigest: command.currentTestClosureDigest }),
    currentRunInputsDigest: command.currentRunInputsDigest,
    force: true,
  })

const withoutPrior = (command: DryRunReuseCommand): DryRunReuseCommand =>
  build({
    currentRunInputsDigest: command.currentRunInputsDigest,
    force: false,
  })

const withClosureDrift = (command: DryRunReuseCommand): DryRunReuseCommand => {
  const prior = priorOf(command)
  return build({
    prior,
    currentTestClosureDigest: distinguishing(prior?.testClosureDigest ?? ''),
    currentRunInputsDigest: prior?.runInputsDigest ?? command.currentRunInputsDigest,
    force: false,
  })
}

const withRunInputsDrift = (command: DryRunReuseCommand): DryRunReuseCommand => {
  const prior = priorOf(command)
  return build({
    prior,
    currentTestClosureDigest: prior?.testClosureDigest ?? '',
    currentRunInputsDigest: distinguishing(prior?.runInputsDigest ?? command.currentRunInputsDigest),
    force: false,
  })
}

const withPriorWithoutClosure = (command: DryRunReuseCommand): DryRunReuseCommand =>
  build({
    prior: priorOf(command),
    currentRunInputsDigest: command.currentRunInputsDigest,
    force: false,
  })

describe('dryRunReuse', () => {
  it.prop(
    '∀c_DryRunReuseCommand_≡ReusesThePriorCoverageExactlyWhenUnforcedAndDigestsMatch',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) => {
      const target = matched(command)
      const digest = target.prior?.testClosureDigest ?? ''
      const result = subject(target)
      return Result.isSuccess(result) &&
        (target.force
          ? S.is(DryRunCoverageStale)(result.success) && result.success.reason === 'forced'
          : S.is(DryRunCoverageReused)(result.success) && result.success.testClosureDigest === digest)
    },
  )

  it.prop(
    '∀c_DryRunReuseCommand_≡AClosureChangeRunsTheDryRunNamingClosureChanged',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) => staleReasonOf(subject(withClosureDrift(command))) === 'closureChanged',
  )

  it.prop(
    '∀c_DryRunReuseCommand_≡ARunInputsChangeRunsTheDryRunNamingRunInputsChanged',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) => staleReasonOf(subject(withRunInputsDrift(command))) === 'runInputsChanged',
  )

  it.prop(
    '∀c_DryRunReuseCommand_≡AForcedRunNeverReusesCoverage',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) => staleReasonOf(subject(forced(command))) === 'forced',
  )

  it.prop(
    '∀c_DryRunReuseCommand_≡AnAbsentPriorRunsTheDryRunNamingNoPriorCoverage',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) => staleReasonOf(subject(withoutPrior(command))) === 'noPriorCoverage',
  )

  it.prop(
    '∀c_DryRunReuseCommand_≡AnAbsentClosureDigestRunsTheDryRunNamingClosureUnavailable',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) => staleReasonOf(subject(withPriorWithoutClosure(command))) === 'closureUnavailable',
  )
})
