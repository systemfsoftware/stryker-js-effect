import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type PriorUnderCurrentRoot, PriorUnderCurrentRootSchema } from '../dry-run-coverage.schema.js'
import {
  DryRunCoverageReused,
  DryRunCoverageStale,
  dryRunReuse,
  DryRunReuseCommand,
  type DryRunReuseDecision,
} from '../dry-run-reuse.workflow.js'

type ReuseResult = Result.Result<DryRunReuseDecision, never>
type Prior = DryRunReuseCommand['prior']

interface ReuseFields {
  readonly prior: Prior
  readonly currentTestClosureDigest?: string | undefined
  readonly currentRunInputsDigest: string
  readonly force: boolean
}

const build = (fields: ReuseFields): DryRunReuseCommand =>
  DryRunReuseCommand.make({
    prior: fields.prior,
    ...(fields.currentTestClosureDigest === undefined
      ? {}
      : { currentTestClosureDigest: fields.currentTestClosureDigest }),
    currentRunInputsDigest: fields.currentRunInputsDigest,
    force: fields.force,
  })

const staleReasonOf = (result: ReuseResult): string | undefined =>
  Result.isSuccess(result) && S.is(DryRunCoverageStale)(result.success) ? result.success.reason : undefined

const distinguishing = (value: string): string => `${value}-distinguishing`

const currentRootPriorOf = (command: DryRunReuseCommand): PriorUnderCurrentRoot =>
  S.is(PriorUnderCurrentRootSchema)(command.prior)
    ? command.prior
    : {
      _tag: 'PriorUnderCurrentRoot',
      testClosureDigest: command.currentTestClosureDigest ?? 'prior-closure',
      runInputsDigest: command.currentRunInputsDigest,
    }

const withPrior = (command: DryRunReuseCommand, prior: Prior): DryRunReuseCommand =>
  build({
    prior,
    currentTestClosureDigest: command.currentTestClosureDigest,
    currentRunInputsDigest: command.currentRunInputsDigest,
    force: command.force,
  })

const matched = (command: DryRunReuseCommand): DryRunReuseCommand => {
  const prior = currentRootPriorOf(command)
  return build({
    prior,
    currentTestClosureDigest: prior.testClosureDigest,
    currentRunInputsDigest: prior.runInputsDigest,
    force: command.force,
  })
}

const forcedUnderCurrentRoot = (command: DryRunReuseCommand): DryRunReuseCommand =>
  build({
    prior: currentRootPriorOf(command),
    currentTestClosureDigest: command.currentTestClosureDigest,
    currentRunInputsDigest: command.currentRunInputsDigest,
    force: true,
  })

const withoutPrior = (command: DryRunReuseCommand, force: boolean): DryRunReuseCommand =>
  build({
    prior: { _tag: 'NoPriorCoverage' },
    currentRunInputsDigest: command.currentRunInputsDigest,
    force,
  })

const withClosureDrift = (command: DryRunReuseCommand): DryRunReuseCommand => {
  const prior = currentRootPriorOf(command)
  return build({
    prior,
    currentTestClosureDigest: distinguishing(prior.testClosureDigest),
    currentRunInputsDigest: prior.runInputsDigest,
    force: false,
  })
}

const withRunInputsDrift = (command: DryRunReuseCommand): DryRunReuseCommand => {
  const prior = currentRootPriorOf(command)
  return build({
    prior,
    currentTestClosureDigest: prior.testClosureDigest,
    currentRunInputsDigest: distinguishing(prior.runInputsDigest),
    force: false,
  })
}

const withPriorWithoutClosure = (command: DryRunReuseCommand): DryRunReuseCommand =>
  build({
    prior: currentRootPriorOf(command),
    currentRunInputsDigest: command.currentRunInputsDigest,
    force: false,
  })

describe('dryRunReuse', () => {
  it.prop(
    '∀c_DryRunReuseCommand_≡ReusesThePriorCoverageExactlyWhenUnforcedAndDigestsMatch',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) => {
      const target = matched(command)
      const result = subject(target)
      return Result.isSuccess(result) &&
        (target.force
          ? S.is(DryRunCoverageStale)(result.success) && result.success.reason === 'forced'
          : S.is(DryRunCoverageReused)(result.success) &&
            result.success.testClosureDigest === target.currentTestClosureDigest)
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
    '∀c_DryRunReuseCommand_≡AForcedRunUnderTheCurrentRootNeverReusesCoverage',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) => staleReasonOf(subject(forcedUnderCurrentRoot(command))) === 'forced',
  )

  it.prop(
    '∀c_DryRunReuseCommand_≡AnAbsentPriorRunsTheDryRunNamingForcedOverNoPriorCoverage',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) =>
      staleReasonOf(subject(withoutPrior(command, false))) === 'noPriorCoverage' &&
      staleReasonOf(subject(withoutPrior(command, true))) === 'forced',
  )

  it.prop(
    '∀c_DryRunReuseCommand_≡AnAbsentClosureDigestRunsTheDryRunNamingClosureUnavailable',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) => staleReasonOf(subject(withPriorWithoutClosure(command))) === 'closureUnavailable',
  )

  it.prop(
    '∀c_DryRunReuseCommand_≡APriorUnderOtherRootsRunsTheDryRunNamingRootChangedWhateverForceAndDigests',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) =>
      staleReasonOf(subject(withPrior(command, { _tag: 'PriorUnderOtherRoots' }))) === 'rootChanged' &&
      staleReasonOf(subject(withPrior(matched(command), { _tag: 'PriorUnderOtherRoots' }))) === 'rootChanged',
  )

  it.prop(
    '∀c_DryRunReuseCommand_≡APriorWithNoRecordedRootRunsTheDryRunNamingRootUnrecordedWhateverForceAndDigests',
    { of: [DryRunReuseCommand], subject: dryRunReuse },
    (subject, [command]) =>
      staleReasonOf(subject(withPrior(command, { _tag: 'PriorRootUnrecorded' }))) === 'rootUnrecorded' &&
      staleReasonOf(subject(withPrior(matched(command), { _tag: 'PriorRootUnrecorded' }))) === 'rootUnrecorded',
  )
})
