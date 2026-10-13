import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  DryRunReusePriorSchema,
  type DryRunRunReason,
  DryRunRunReasonSchema,
  type PriorUnderCurrentRoot,
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
  prior: DryRunReusePriorSchema,
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

const closureMatches = (prior: PriorUnderCurrentRoot, digest: string): boolean => prior.testClosureDigest === digest

const mismatchReasonOf = (prior: PriorUnderCurrentRoot, digest: string): DryRunRunReason =>
  Boolean.match(closureMatches(prior, digest), {
    onTrue: (): DryRunRunReason => 'runInputsChanged',
    onFalse: (): DryRunRunReason => 'closureChanged',
  })

const matchesPrior = (prior: PriorUnderCurrentRoot, command: DryRunReuseCommand, digest: string): boolean =>
  Boolean.and(closureMatches(prior, digest), prior.runInputsDigest === command.currentRunInputsDigest)

const againstPrior = (command: DryRunReuseCommand, prior: PriorUnderCurrentRoot): DryRunReuseDecision =>
  Option.match(Option.fromUndefinedOr(command.currentTestClosureDigest), {
    onNone: () => staleOf('closureUnavailable'),
    onSome: (digest) =>
      Boolean.match(matchesPrior(prior, command, digest), {
        onTrue: () => DryRunCoverageReused.make({ testClosureDigest: digest }),
        onFalse: () => staleOf(mismatchReasonOf(prior, digest)),
      }),
  })

const unlessForced = (command: DryRunReuseCommand, unforced: () => DryRunReuseDecision): DryRunReuseDecision =>
  Boolean.match(command.force, {
    onTrue: () => staleOf('forced'),
    onFalse: unforced,
  })

const decideReuse = (command: DryRunReuseCommand): DryRunReuseDecision =>
  Match.value(command.prior).pipe(
    Match.tag('PriorUnderOtherRoots', () => staleOf('rootChanged')),
    Match.tag('PriorRootUnrecorded', () => staleOf('rootUnrecorded')),
    Match.tag('NoPriorCoverage', () => unlessForced(command, () => staleOf('noPriorCoverage'))),
    Match.tag('PriorUnderCurrentRoot', (prior) => unlessForced(command, () => againstPrior(command, prior))),
    Match.exhaustive,
  )

export const dryRunReuse = Workflow.make({
  command: DryRunReuseCommand,
  decision: S.Union([DryRunCoverageReused, DryRunCoverageStale]),
  error: S.Never,
  decide: (command: DryRunReuseCommand): Result.Result<DryRunReuseDecision, never> =>
    Result.succeed(decideReuse(command)),
})
