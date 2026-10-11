import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type CoverageRoot, DryRunCandidateRootsSchema } from './dry-run-coverage.schema.js'

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
  candidates: S.Array(DryRunCandidateRootsSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    currentRoot: 'stryker.dry_run_candidates.current_root',
  } as const
}

type Candidate = DryRunCandidatesCommand['candidates'][number]

const effectiveRootOf = (candidate: Candidate): CoverageRoot =>
  Match.value(candidate.recordRoot).pipe(
    Match.tag('RecordedRoot', (root): CoverageRoot => root),
    Match.tag('UnrecordedRoot', () => candidate.headerRoot),
    Match.exhaustive,
  )

const recordedPathsOf = (roots: readonly CoverageRoot[]): readonly string[] =>
  roots.flatMap((root) =>
    Match.value(root).pipe(
      Match.tag('RecordedRoot', ({ path }) => [path]),
      Match.tag('UnrecordedRoot', (): readonly string[] => []),
      Match.exhaustive,
    )
  )

const noneKept = (roots: readonly CoverageRoot[]): DryRunCandidatesDecision =>
  Arr.match(recordedPathsOf(roots), {
    onEmpty: () =>
      Arr.match(roots, {
        onEmpty: (): DryRunCandidatesDecision => NoCandidates.make({}),
        onNonEmpty: () => CandidatesUnrecorded.make({}),
      }),
    onNonEmpty: (paths) => CandidatesUnderOtherRoots.make({ roots: Arr.sort(Arr.dedupe(paths), Order.String) }),
  })

const decideCandidates = (command: DryRunCandidatesCommand): DryRunCandidatesDecision => {
  const roots = command.candidates.map(effectiveRootOf)
  const paths = recordedPathsOf(roots)
  const indices = roots.flatMap((root, index) =>
    Match.value(root).pipe(
      Match.tag('RecordedRoot', ({ path }) =>
        Boolean.match(path === command.currentRoot, {
          onTrue: () => [index],
          onFalse: (): readonly number[] => [],
        })),
      Match.tag('UnrecordedRoot', (): readonly number[] => []),
      Match.exhaustive,
    )
  )
  return Arr.match(indices, {
    onEmpty: () => noneKept(roots),
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
