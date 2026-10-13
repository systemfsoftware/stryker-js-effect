import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type CoverageRoot, CoverageRootSchema } from './dry-run-coverage.schema.js'

const DryRunCandidatesDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/DryRunCandidatesDecision',
)
type DryRunCandidatesDecisionTypeId = typeof DryRunCandidatesDecisionTypeId

export class CandidatesKept extends S.TaggedClass<CandidatesKept>()('CandidatesKept', {
  indices: S.Array(S.Int),
  droppedOtherRoot: S.Int,
  droppedUnrecorded: S.Int,
}) {
  readonly [DryRunCandidatesDecisionTypeId] = DryRunCandidatesDecisionTypeId
}

export class CandidatesUnderOtherRoots extends S.TaggedClass<CandidatesUnderOtherRoots>()(
  'CandidatesUnderOtherRoots',
  { roots: S.Array(S.String) },
) {
  readonly [DryRunCandidatesDecisionTypeId] = DryRunCandidatesDecisionTypeId
}

export class CandidatesUnrecorded extends S.TaggedClass<CandidatesUnrecorded>()('CandidatesUnrecorded', {}) {
  readonly [DryRunCandidatesDecisionTypeId] = DryRunCandidatesDecisionTypeId
}

export class NoCandidates extends S.TaggedClass<NoCandidates>()('NoCandidates', {}) {
  readonly [DryRunCandidatesDecisionTypeId] = DryRunCandidatesDecisionTypeId
}

export type DryRunCandidatesDecision = CandidatesKept | CandidatesUnderOtherRoots | CandidatesUnrecorded | NoCandidates

export class DryRunCandidatesCommand extends S.TaggedClass<DryRunCandidatesCommand>()('DryRunCandidatesCommand', {
  currentRoot: S.String,
  candidates: S.Array(CoverageRootSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    currentRoot: 'stryker.dry_run_candidates.current_root',
  } as const
}

interface RecordedCandidate {
  readonly index: number
  readonly path: string
}

const recordedCandidatesOf = (roots: readonly CoverageRoot[]): readonly RecordedCandidate[] =>
  roots.flatMap((root, index) =>
    Match.value(root).pipe(
      Match.tag('RecordedRoot', ({ path }) => [{ index, path }]),
      Match.tag('UnrecordedRoot', (): readonly RecordedCandidate[] => []),
      Match.exhaustive,
    )
  )

const noneKept = (roots: readonly CoverageRoot[], recordedPaths: readonly string[]): DryRunCandidatesDecision =>
  Arr.match(recordedPaths, {
    onEmpty: () =>
      Arr.match(roots, {
        onEmpty: (): DryRunCandidatesDecision => NoCandidates.make({}),
        onNonEmpty: () => CandidatesUnrecorded.make({}),
      }),
    onNonEmpty: (paths) => CandidatesUnderOtherRoots.make({ roots: Arr.sort(Arr.dedupe(paths), Order.String) }),
  })

const decideCandidates = (command: DryRunCandidatesCommand): DryRunCandidatesDecision => {
  const roots = command.candidates
  const recorded = recordedCandidatesOf(roots)
  const paths = recorded.map(({ path }) => path)
  const indices = recorded.filter(({ path }) => path === command.currentRoot).map(({ index }) => index)
  return Arr.match(indices, {
    onEmpty: () => noneKept(roots, paths),
    onNonEmpty: (kept): DryRunCandidatesDecision =>
      CandidatesKept.make({
        indices: kept,
        droppedOtherRoot: paths.length - kept.length,
        droppedUnrecorded: roots.length - paths.length,
      }),
  })
}

export const dryRunCandidates = Workflow.make({
  command: DryRunCandidatesCommand,
  decision: S.Union([CandidatesKept, CandidatesUnderOtherRoots, CandidatesUnrecorded, NoCandidates]),
  error: S.Never,
  decide: (command: DryRunCandidatesCommand): Result.Result<DryRunCandidatesDecision, never> =>
    Result.succeed(decideCandidates(command)),
})
