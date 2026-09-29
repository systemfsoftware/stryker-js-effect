import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type DryRunReusePrior,
  DryRunReusePriorSchema,
  type DryRunRunReason,
  DryRunRunReasonSchema,
} from './dry-run-coverage.schema.js'

const DryRunReuseDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/DryRunReuseDecision')
type DryRunReuseDecisionTypeId = typeof DryRunReuseDecisionTypeId

export class DryRunCoverageReused extends S.TaggedClass<DryRunCoverageReused>()('DryRunCoverageReused', {
  testClosureDigest: S.String,
}) {
  readonly [DryRunReuseDecisionTypeId] = DryRunReuseDecisionTypeId
}

export class DryRunCoverageStale extends S.TaggedClass<DryRunCoverageStale>()('DryRunCoverageStale', {
  reason: DryRunRunReasonSchema,
}) {
  readonly [DryRunReuseDecisionTypeId] = DryRunReuseDecisionTypeId
}

export type DryRunReuseDecision = DryRunCoverageReused | DryRunCoverageStale

export class DryRunReuseCommand extends S.TaggedClass<DryRunReuseCommand>()('DryRunReuseCommand', {
  prior: S.optional(DryRunReusePriorSchema),
  currentTestClosureDigest: S.optional(S.String),
  currentRunInputsDigest: S.String,
  force: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    force: 'stryker.dry_run_reuse.force',
    currentRunInputsDigest: 'stryker.dry_run_reuse.run_inputs_digest',
  } as const
}

const staleOf = (reason: DryRunRunReason): DryRunCoverageStale => DryRunCoverageStale.make({ reason })

const closureMatches = (prior: DryRunReusePrior, digest: string): boolean => prior.testClosureDigest === digest

const mismatchReasonOf = (prior: DryRunReusePrior, digest: string): DryRunRunReason =>
  Boolean.match(closureMatches(prior, digest), {
    onTrue: (): DryRunRunReason => 'runInputsChanged',
    onFalse: (): DryRunRunReason => 'closureChanged',
  })

const matchesPrior = (prior: DryRunReusePrior, command: DryRunReuseCommand, digest: string): boolean =>
  Boolean.and(closureMatches(prior, digest), prior.runInputsDigest === command.currentRunInputsDigest)

const againstPrior = (command: DryRunReuseCommand, prior: DryRunReusePrior): DryRunReuseDecision =>
  Option.match(Option.fromUndefinedOr(command.currentTestClosureDigest), {
    onNone: () => staleOf('closureUnavailable'),
    onSome: (digest) =>
      Boolean.match(matchesPrior(prior, command, digest), {
        onTrue: () => DryRunCoverageReused.make({ testClosureDigest: digest }),
        onFalse: () => staleOf(mismatchReasonOf(prior, digest)),
      }),
  })

const decideReuse = (command: DryRunReuseCommand): DryRunReuseDecision =>
  Boolean.match(command.force, {
    onTrue: () => staleOf('forced'),
    onFalse: () =>
      Option.match(Option.fromUndefinedOr(command.prior), {
        onNone: () => staleOf('noPriorCoverage'),
        onSome: (prior) => againstPrior(command, prior),
      }),
  })

export const dryRunReuse = Workflow.make({
  command: DryRunReuseCommand,
  decision: S.Union([DryRunCoverageReused, DryRunCoverageStale]),
  error: S.Never,
  decide: (command: DryRunReuseCommand): Result.Result<DryRunReuseDecision, never> =>
    Result.succeed(decideReuse(command)),
})
