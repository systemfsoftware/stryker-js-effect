import { Workflow } from '@systemfsoftware/effect-cell-types'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  BenchCorpusName,
  BenchRun,
  BenchRunInvalid,
  BenchRunMeasured,
  BenchSide,
  WorkloadDigest,
} from './bench-run.schema.js'
import {
  BenchPhase,
  BenchPhaseRow,
  BenchProjectSummary,
  BenchSummary,
  type MeasuredSideCell,
  PhaseVerdict,
  SideCell,
  SideCounts,
  statisticsOf,
  Workload,
} from './bench-summary.schema.js'

const min = Math.min
const max = Math.max
const abs = Math.abs

export class SummarizeBenchCommand extends S.TaggedClass<SummarizeBenchCommand>()('SummarizeBenchCommand', {
  runs: S.Array(BenchRun),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class BenchRunsInvalid extends S.TaggedError<BenchRunsInvalid>()('BenchRunsInvalid', {
  runs: S.Array(BenchRun),
}) {
  override get message(): string {
    const labels = Arr.map(this.runs, (run) => run.key.label).join(', ')
    return `cannot summarize ${this.runs.length} invalid bench run(s): ${labels}`
  }
}

type CorpusName = BenchCorpusName

const CORPORA: ReadonlyArray<CorpusName> = ['repo', 'enterprise']

type PhaseReading = RunEvent.CheckDuration

interface PhaseRule {
  readonly read: (durations: RunEvent.PhaseDurations) => PhaseReading
  readonly sequential: boolean
  readonly includesUnrecordedReporting: boolean
}

const measuredReading = (ms: number): PhaseReading => ({ _tag: 'measured', ms })

const sequentialRule = (pick: (durations: RunEvent.PhaseDurations) => number): PhaseRule => ({
  read: (durations) => measuredReading(pick(durations)),
  sequential: true,
  includesUnrecordedReporting: false,
})

const COMPONENT_RULES: { readonly [P in Exclude<BenchPhase, 'total'>]: PhaseRule } = {
  prepare: sequentialRule((durations) => durations.prepare),
  instrument: sequentialRule((durations) => durations.instrument),
  check: { read: (durations) => durations.check, sequential: false, includesUnrecordedReporting: false },
  'dry-run': sequentialRule((durations) => durations['dry-run']),
  'mutation-test': {
    ...sequentialRule((durations) => durations['mutation-test']),
    includesUnrecordedReporting: true,
  },
  reporting: { read: (durations) => durations.reporting, sequential: true, includesUnrecordedReporting: false },
}

const msOrZero = (reading: PhaseReading): number =>
  Match.valueTags(reading, { measured: (measured) => measured.ms, 'not-run': () => 0, 'not-recorded': () => 0 })

const totalMsOf = (durations: RunEvent.PhaseDurations): number =>
  Arr.reduce(
    Arr.filter(Object.values(COMPONENT_RULES), (rule) => rule.sequential),
    0,
    (sum, rule) => sum + msOrZero(rule.read(durations)),
  )

const PHASE_RULES: { readonly [P in BenchPhase]: PhaseRule } = {
  ...COMPONENT_RULES,
  total: {
    read: (durations) => measuredReading(totalMsOf(durations)),
    sequential: false,
    includesUnrecordedReporting: false,
  },
}

const shareOf = (value: number, total: number): number =>
  Boolean.match(total === 0, { onTrue: () => 0, onFalse: () => value / total })

const isMeasuredReading = S.is(RunEvent.CheckDuration.members[0])

const isNotRunReading = S.is(RunEvent.CheckDuration.members[1])

interface Repetition {
  readonly reading: PhaseReading
  readonly totalMs: number
}

const repetitionOf = (runs: ReadonlyArray<BenchRunMeasured>, phase: BenchPhase): Repetition => {
  const readings = Arr.map(runs, (run) => PHASE_RULES[phase].read(run.phaseDurations))
  const value = Arr.reduce(readings, 0, (sum, reading) => sum + msOrZero(reading))
  const reading = Boolean.match(Arr.every(readings, isMeasuredReading), {
    onTrue: () => measuredReading(value),
    onFalse: () =>
      Boolean.match(Arr.every(readings, isNotRunReading), {
        onTrue: (): PhaseReading => ({ _tag: 'not-run' }),
        onFalse: (): PhaseReading => ({ _tag: 'not-recorded' }),
      }),
  })
  return { reading, totalMs: Arr.reduce(runs, 0, (sum, run) => sum + totalMsOf(run.phaseDurations)) }
}

const positionsOf = (runs: ReadonlyArray<BenchRunMeasured>, side: BenchSide): ReadonlyArray<number> =>
  Arr.sort(
    Arr.dedupe(
      Arr.map(
        Arr.filter(runs, (run) => run.key.side === side),
        (run) => run.key.position,
      ),
    ),
    Order.Number,
  )

const repetitionAt = (
  runs: ReadonlyArray<BenchRunMeasured>,
  side: BenchSide,
  position: number,
): ReadonlyArray<BenchRunMeasured> =>
  Arr.filter(runs, (run) => Boolean.and(run.key.side === side, run.key.position === position))

const repetitionsOf = (
  runs: ReadonlyArray<BenchRunMeasured>,
  side: BenchSide,
  phase: BenchPhase,
): ReadonlyArray<Repetition> =>
  Arr.map(positionsOf(runs, side), (position) => repetitionOf(repetitionAt(runs, side, position), phase))

const measuredCellOf = (repetitions: Arr.NonEmptyReadonlyArray<Repetition>): SideCell => ({
  _tag: 'measured',
  samples: Arr.map(repetitions, (repetition) => ({
    ms: msOrZero(repetition.reading),
    shareOfTotal: shareOf(msOrZero(repetition.reading), repetition.totalMs),
  })),
})

const unmeasuredCellOf = (repetitions: ReadonlyArray<Repetition>): SideCell =>
  Boolean.match(
    Boolean.and(repetitions.length > 0, Arr.every(repetitions, (repetition) => isNotRunReading(repetition.reading))),
    {
      onTrue: (): SideCell => ({ _tag: 'not-run' }),
      onFalse: (): SideCell => ({ _tag: 'not-measured' }),
    },
  )

const isFullyMeasured = (
  repetitions: ReadonlyArray<Repetition>,
): repetitions is Arr.NonEmptyReadonlyArray<Repetition> =>
  Boolean.and(repetitions.length > 0, Arr.every(repetitions, (repetition) => isMeasuredReading(repetition.reading)))

const sideCellOf = (runs: ReadonlyArray<BenchRunMeasured>, side: BenchSide, phase: BenchPhase): SideCell => {
  const repetitions = repetitionsOf(runs, side, phase)
  return Option.match(Option.liftPredicate(repetitions, isFullyMeasured), {
    onNone: () => unmeasuredCellOf(repetitions),
    onSome: measuredCellOf,
  })
}

const cellGapOf = (cell: SideCell, side: BenchSide, phase: BenchPhase): ReadonlyArray<string> =>
  Match.valueTags(cell, {
    measured: (): ReadonlyArray<string> => [],
    'not-run': () => [`${phase} did not run on side ${side}`],
    'not-measured': () => [`no repetition of ${phase} was recorded on side ${side}`],
  })

const SUPPRESSED_REASON = "mutation-test includes reporting and a side's reporting was not recorded"

const decisiveVerdict = (a: MeasuredSideCell, b: MeasuredSideCell, workloadSame: boolean): PhaseVerdict => {
  const statsA = statisticsOf(a)
  const statsB = statisticsOf(b)
  const deltaMs = statsB.medianMs - statsA.medianMs
  const separated = Boolean.or(statsB.maxMs < statsA.minMs, statsB.minMs > statsA.maxMs)
  const decisive = Boolean.and(separated, Boolean.and(abs(deltaMs) >= 0.03 * statsA.medianMs, workloadSame))
  const deltaShareOfA = shareOf(deltaMs, statsA.medianMs)
  return Boolean.match(decisive, {
    onTrue: () =>
      Boolean.match(deltaMs < 0, {
        onTrue: (): PhaseVerdict => ({ _tag: 'improved', deltaMs, deltaShareOfA }),
        onFalse: (): PhaseVerdict => ({ _tag: 'regressed', deltaMs, deltaShareOfA }),
      }),
    onFalse: (): PhaseVerdict => ({ _tag: 'no-signal', deltaMs }),
  })
}

const exclusiveVerdictOf = (a: SideCell, b: SideCell, workloadSame: boolean, phase: BenchPhase): PhaseVerdict => {
  const notMeasured = (): PhaseVerdict => ({
    _tag: 'not-measured',
    reason: [...cellGapOf(a, 'A', phase), ...cellGapOf(b, 'B', phase)].join('; '),
  })
  return Match.valueTags(a, {
    measured: (measuredA) =>
      Match.valueTags(b, {
        measured: (measuredB) => decisiveVerdict(measuredA, measuredB, workloadSame),
        'not-run': notMeasured,
        'not-measured': notMeasured,
      }),
    'not-run': notMeasured,
    'not-measured': notMeasured,
  })
}

interface ProjectCell {
  readonly phase: BenchPhase
  readonly a: SideCell
  readonly b: SideCell
}

const isReportingUnrecorded = (cells: ReadonlyArray<ProjectCell>): boolean =>
  Arr.some(
    cells,
    (cell) =>
      Boolean.and(
        cell.phase === 'reporting',
        Boolean.or(!S.is(SideCell.cases.measured)(cell.a), !S.is(SideCell.cases.measured)(cell.b)),
      ),
  )

const verdictOf = (cell: ProjectCell, workload: Workload, reportingUnrecorded: boolean): PhaseVerdict =>
  Match.valueTags(workload, {
    unverified: (unverified): PhaseVerdict => ({
      _tag: 'workload-unverified',
      reason: unverified.reasons.join('; '),
    }),
    changed: () => suppressibleVerdictOf(cell, false, reportingUnrecorded),
    same: () => suppressibleVerdictOf(cell, true, reportingUnrecorded),
  })

const suppressibleVerdictOf = (cell: ProjectCell, workloadSame: boolean, reportingUnrecorded: boolean): PhaseVerdict =>
  Boolean.match(Boolean.and(PHASE_RULES[cell.phase].includesUnrecordedReporting, reportingUnrecorded), {
    onTrue: (): PhaseVerdict => ({ _tag: 'not-measured', reason: SUPPRESSED_REASON }),
    onFalse: () => exclusiveVerdictOf(cell.a, cell.b, workloadSame, cell.phase),
  })

const unverifiedReasonsOf = (runs: ReadonlyArray<BenchRunMeasured>): ReadonlyArray<string> =>
  Arr.dedupe(
    Arr.flatMap(runs, (run) =>
      Match.valueTags(run.workloadDigest, {
        verified: (): ReadonlyArray<string> => [],
        unverified: (unverified) => [`${run.key.label}: ${unverified.reason}`],
      })),
  )

const digestOf = (digest: WorkloadDigest): ReadonlyArray<string> =>
  Match.valueTags(digest, {
    verified: (verified): ReadonlyArray<string> => [verified.digest],
    unverified: (): ReadonlyArray<string> => [],
  })

const verifiedDigestsOf = (runs: ReadonlyArray<BenchRunMeasured>, entry: string): ReadonlyArray<string> =>
  Arr.dedupe(
    Arr.flatMap(
      Arr.filter(runs, (run) => run.key.entry === entry),
      (run: BenchRunMeasured) => digestOf(run.workloadDigest),
    ),
  )

const changedEntriesOf = (runs: ReadonlyArray<BenchRunMeasured>): ReadonlyArray<string> =>
  Arr.sort(
    Arr.filter(
      Arr.dedupe(Arr.map(runs, (run) => run.key.entry)),
      (entry) => verifiedDigestsOf(runs, entry).length > 1,
    ),
    Order.String,
  )

const workloadOf = (runs: ReadonlyArray<BenchRunMeasured>): Workload => {
  const unverified = unverifiedReasonsOf(runs)
  const changed = changedEntriesOf(runs)
  return Boolean.match(unverified.length > 0, {
    onTrue: (): Workload => ({ _tag: 'unverified', reasons: unverified }),
    onFalse: () =>
      Boolean.match(changed.length > 0, {
        onTrue: (): Workload => ({ _tag: 'changed', entries: changed }),
        onFalse: (): Workload => ({ _tag: 'same' }),
      }),
  })
}

const countRangeOf = (values: ReadonlyArray<number>): { readonly min: number; readonly max: number } =>
  Boolean.match(values.length === 0, {
    onTrue: () => ({ min: 0, max: 0 }),
    onFalse: () => ({ min: min(...values), max: max(...values) }),
  })

const sideCountsOf = (runs: ReadonlyArray<BenchRunMeasured>, side: BenchSide): SideCounts => {
  const own = Arr.filter(runs, (run) => run.key.side === side)
  return SideCounts.make({
    mutants: countRangeOf(Arr.map(own, (run) => run.mutants)),
    testsExecuted: countRangeOf(Arr.map(own, (run) => run.testsExecuted)),
  })
}

const projectSummaryOf = (
  corpus: CorpusName,
  entry: string,
  runs: ReadonlyArray<BenchRunMeasured>,
): BenchProjectSummary => {
  const workload = workloadOf(runs)
  const cells = Arr.map(BenchPhase.literals, (phase): ProjectCell => ({
    phase,
    a: sideCellOf(runs, 'A', phase),
    b: sideCellOf(runs, 'B', phase),
  }))
  const reportingUnrecorded = isReportingUnrecorded(cells)
  return BenchProjectSummary.make({
    corpus,
    entry,
    workload,
    counts: { a: sideCountsOf(runs, 'A'), b: sideCountsOf(runs, 'B') },
    rows: Arr.map(cells, (cell) =>
      BenchPhaseRow.make({
        phase: cell.phase,
        a: cell.a,
        b: cell.b,
        verdict: verdictOf(cell, workload, reportingUnrecorded),
      })),
  })
}

interface ProjectGroup {
  readonly corpus: CorpusName
  readonly entry: string
  readonly runs: ReadonlyArray<BenchRunMeasured>
}

const projectGroupsOf = (runs: ReadonlyArray<BenchRunMeasured>): ReadonlyArray<ProjectGroup> =>
  runs.reduce<ReadonlyArray<ProjectGroup>>(
    (groups, run) =>
      Boolean.match(
        groups.some((group) => Boolean.and(group.corpus === run.key.corpus, group.entry === run.key.entry)),
        {
          onTrue: () => groups,
          onFalse: () => [
            ...groups,
            {
              corpus: run.key.corpus,
              entry: run.key.entry,
              runs: Arr.filter(runs, (candidate) =>
                Boolean.and(candidate.key.corpus === run.key.corpus, candidate.key.entry === run.key.entry)),
            },
          ],
        },
      ),
    [],
  )

const summaryOf = (runs: ReadonlyArray<BenchRun>): BenchSummary => {
  const measured = Arr.filter(runs, S.is(BenchRunMeasured))
  const groups = projectGroupsOf(measured)
  const ordered = Arr.flatMap(CORPORA, (corpus) => Arr.filter(groups, (group) => group.corpus === corpus))
  return BenchSummary.make({
    projects: Arr.map(ordered, (group) => projectSummaryOf(group.corpus, group.entry, group.runs)),
  })
}

const refusalOf = (runs: ReadonlyArray<BenchRun>): Result.Result<void, BenchRunsInvalid> => {
  const invalid = Arr.filter(runs, S.is(BenchRunInvalid))
  return Boolean.match(invalid.length === 0, {
    onTrue: () => Result.succeed(undefined),
    onFalse: () => Result.fail(BenchRunsInvalid.make({ runs: invalid })),
  })
}

const decide = (command: SummarizeBenchCommand): Result.Result<BenchSummary, BenchRunsInvalid> =>
  Result.map(refusalOf(command.runs), () => summaryOf(command.runs))

export const summarizeBench = Workflow.make({
  command: SummarizeBenchCommand,
  decision: BenchSummary,
  error: BenchRunsInvalid,
  decide,
})
