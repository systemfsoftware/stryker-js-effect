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
  BenchRunKey,
  BenchRunMeasured,
  BenchSide,
} from './bench-run.schema.js'
import {
  type BenchPhase,
  BenchPhaseRow,
  BenchProjectSummary,
  BenchSummary,
  PhaseVerdict,
  SideCell,
  SideCounts,
  Workload,
} from './bench-summary.schema.js'

const min = Math.min
const max = Math.max
const abs = Math.abs
const floor = Math.floor

const SEQUENTIAL_PHASES = ['prepare', 'instrument', 'dry-run', 'mutation-test'] as const

const PHASES: ReadonlyArray<BenchPhase> = [
  'prepare',
  'instrument',
  'check',
  'dry-run',
  'mutation-test',
  'reporting',
  'total',
]

export class SummarizeBenchCommand extends S.TaggedClass<SummarizeBenchCommand>()('SummarizeBenchCommand', {
  runs: S.Array(BenchRun),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class BenchRunsInvalid extends S.TaggedError<BenchRunsInvalid>()('BenchRunsInvalid', {
  runs: S.Array(BenchRun),
}) {
  override get message(): string {
    const labels = Arr.map(this.runs, (run) => keyLabel(run.key)).join(', ')
    return `cannot summarize ${this.runs.length} invalid bench run(s): ${labels}`
  }
}

type CorpusName = BenchCorpusName

const CORPORA: ReadonlyArray<CorpusName> = ['repo', 'enterprise']

const keyLabel = (key: BenchRunKey): string => `${key.corpus}/${key.entry} ${key.side}@${key.position}`

const isMeasuredCell = (cell: SideCell): boolean => S.is(SideCell.cases.measured)(cell)

const reportingMsOf = (duration: RunEvent.ReportingDuration): number =>
  Match.valueTags(duration, { measured: (measured) => measured.ms, 'not-recorded': () => 0 })

const isReportingRecorded = (duration: RunEvent.ReportingDuration): boolean =>
  Match.valueTags(duration, { measured: () => true, 'not-recorded': () => false })

const checkMsOf = (duration: RunEvent.CheckDuration): number =>
  Match.valueTags(duration, { measured: (measured) => measured.ms, 'not-run': () => 0, 'not-recorded': () => 0 })

const checkNotRunOf = (duration: RunEvent.CheckDuration): number =>
  Match.valueTags(duration, { measured: () => 0, 'not-run': () => 1, 'not-recorded': () => 0 })

const isCheckRecorded = (duration: RunEvent.CheckDuration): boolean =>
  Match.valueTags(duration, { measured: () => true, 'not-run': () => true, 'not-recorded': () => false })

const totalOf = (run: BenchRunMeasured): number =>
  SEQUENTIAL_PHASES.reduce((sum, phase) => sum + run.phaseDurations[phase], 0) +
  reportingMsOf(run.phaseDurations.reporting)

const SequentialMs: Record<(typeof SEQUENTIAL_PHASES)[number], (run: BenchRunMeasured) => number> = {
  prepare: (run) => run.phaseDurations.prepare,
  instrument: (run) => run.phaseDurations.instrument,
  'dry-run': (run) => run.phaseDurations['dry-run'],
  'mutation-test': (run) => run.phaseDurations['mutation-test'],
}

interface RepetitionMeasurement {
  readonly value: number
  readonly notRun: number
  readonly share: number
}

const shareOf = (value: number, total: number): number =>
  Boolean.match(total === 0, { onTrue: () => 0, onFalse: () => value / total })

const sequentialRepetitionOf = (
  runs: ReadonlyArray<BenchRunMeasured>,
  total: number,
  pick: (run: BenchRunMeasured) => number,
): Option.Option<RepetitionMeasurement> =>
  Option.some({
    value: Arr.reduce(runs, 0, (sum, run) => sum + pick(run)),
    notRun: 0,
    share: shareOf(Arr.reduce(runs, 0, (sum, run) => sum + pick(run)), total),
  })

const checkRepetitionOf = (
  runs: ReadonlyArray<BenchRunMeasured>,
  total: number,
): Option.Option<RepetitionMeasurement> => {
  const durations = runs.map((run) => run.phaseDurations.check)
  const allRecorded = durations.every(isCheckRecorded)
  const value = Arr.reduce(durations, 0, (sum, duration) => sum + checkMsOf(duration))
  const notRun = Arr.reduce(durations, 0, (count, duration) => count + checkNotRunOf(duration))
  return Boolean.match(allRecorded, {
    onTrue: () => Option.some({ value, notRun, share: shareOf(value, total) }),
    onFalse: () => Option.none(),
  })
}

const reportingRepetitionOf = (
  runs: ReadonlyArray<BenchRunMeasured>,
  total: number,
): Option.Option<RepetitionMeasurement> => {
  const recorded = runs.every((run) => isReportingRecorded(run.phaseDurations.reporting))
  const value = Arr.reduce(runs, 0, (sum, run) => sum + reportingMsOf(run.phaseDurations.reporting))
  return Boolean.match(recorded, {
    onTrue: () => Option.some({ value, notRun: 0, share: shareOf(value, total) }),
    onFalse: () => Option.none(),
  })
}

const repetitionMeasurementOf = (
  runs: ReadonlyArray<BenchRunMeasured>,
  phase: BenchPhase,
): Option.Option<RepetitionMeasurement> => {
  const total = runs.reduce((sum, run) => sum + totalOf(run), 0)
  return Match.value(phase).pipe(
    Match.when('check', () => checkRepetitionOf(runs, total)),
    Match.when('reporting', () => reportingRepetitionOf(runs, total)),
    Match.when('total', (): Option.Option<RepetitionMeasurement> => Option.some({ value: total, notRun: 0, share: 1 })),
    Match.when('prepare', () => sequentialRepetitionOf(runs, total, SequentialMs.prepare)),
    Match.when('instrument', () => sequentialRepetitionOf(runs, total, SequentialMs.instrument)),
    Match.when('dry-run', () => sequentialRepetitionOf(runs, total, SequentialMs['dry-run'])),
    Match.when('mutation-test', () => sequentialRepetitionOf(runs, total, SequentialMs['mutation-test'])),
    Match.exhaustive,
  )
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

const groupByPosition = (
  runs: ReadonlyArray<BenchRunMeasured>,
  side: BenchSide,
): ReadonlyArray<ReadonlyArray<BenchRunMeasured>> =>
  Arr.map(positionsOf(runs, side), (position) => repetitionAt(runs, side, position))

const medianOf = (values: ReadonlyArray<number>): number => {
  const sorted = Arr.sort(values, Order.Number)
  const half = sorted.length / 2
  return Boolean.match(sorted.length % 2 === 1, {
    onTrue: () => sorted[floor(half)],
    onFalse: () => (sorted[half - 1] + sorted[half]) / 2,
  })
}

const sideCellOf = (runs: ReadonlyArray<BenchRunMeasured>, side: BenchSide, phase: BenchPhase): SideCell => {
  const measurements = Arr.map(
    groupByPosition(runs, side),
    (repetition) => repetitionMeasurementOf(repetition, phase),
  )
  const present = Arr.getSomes(measurements)
  const values = Arr.map(present, (measurement) => measurement.value)
  const shares = Arr.map(present, (measurement) => measurement.share)
  const complete = Boolean.and(measurements.length > 0, measurements.every(Option.isSome))
  const measured: SideCell = {
    _tag: 'measured',
    medianMs: medianOf(values),
    minMs: min(...values),
    maxMs: max(...values),
    shareMedian: medianOf(shares),
    notRunEntries: Arr.reduce(present, 0, (accumulated, measurement) => max(accumulated, measurement.notRun)),
    samplesMs: values,
  }
  return Boolean.match(complete, {
    onTrue: () => measured,
    onFalse: (): SideCell => ({ _tag: 'not-measured' }),
  })
}

const missingReason = (a: SideCell, b: SideCell, phase: BenchPhase): string =>
  Boolean.match(isMeasuredCell(a), {
    onFalse: () =>
      Boolean.match(isMeasuredCell(b), {
        onFalse: () => `no repetition of ${phase} was recorded on either side`,
        onTrue: () => `no repetition of ${phase} was recorded on side A`,
      }),
    onTrue: () => `no repetition of ${phase} was recorded on side B`,
  })

const SUPPRESSED_REASON = "mutation-test includes reporting and a side's reporting was not recorded"

type MeasuredCell = S.Schema.Type<typeof SideCell.cases.measured>

const decisiveVerdict = (a: MeasuredCell, b: MeasuredCell, workloadSame: boolean): PhaseVerdict => {
  const deltaMs = b.medianMs - a.medianMs
  const separated = Boolean.or(b.maxMs < a.minMs, b.minMs > a.maxMs)
  const decisive = Boolean.and(separated, Boolean.and(abs(deltaMs) >= 0.03 * a.medianMs, workloadSame))
  const deltaShareOfA = shareOf(deltaMs, a.medianMs)
  return Boolean.match(decisive, {
    onTrue: () =>
      Boolean.match(deltaMs < 0, {
        onTrue: (): PhaseVerdict => ({ _tag: 'improved', deltaMs, deltaShareOfA }),
        onFalse: (): PhaseVerdict => ({ _tag: 'regressed', deltaMs, deltaShareOfA }),
      }),
    onFalse: (): PhaseVerdict => ({ _tag: 'no-signal', deltaMs }),
  })
}

const exclusiveVerdictOf = (a: SideCell, b: SideCell, workloadSame: boolean, phase: BenchPhase): PhaseVerdict =>
  Match.value(a).pipe(
    Match.tag('not-measured', (): PhaseVerdict => ({ _tag: 'not-measured', reason: missingReason(a, b, phase) })),
    Match.tag('measured', (measuredA) =>
      Match.value(b).pipe(
        Match.tag('not-measured', (): PhaseVerdict => ({ _tag: 'not-measured', reason: missingReason(a, b, phase) })),
        Match.tag('measured', (measuredB): PhaseVerdict => decisiveVerdict(measuredA, measuredB, workloadSame)),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const verdictOf = (
  a: SideCell,
  b: SideCell,
  workloadSame: boolean,
  suppress: boolean,
  phase: BenchPhase,
): PhaseVerdict =>
  Boolean.match(suppress, {
    onTrue: (): PhaseVerdict => ({ _tag: 'not-measured', reason: SUPPRESSED_REASON }),
    onFalse: () => exclusiveVerdictOf(a, b, workloadSame, phase),
  })

const distinctDigestsOf = (runs: ReadonlyArray<BenchRunMeasured>, entry: string): ReadonlyArray<string> =>
  Arr.dedupe(
    Arr.map(
      Arr.filter(runs, (run) => run.key.entry === entry),
      (run) => run.workloadDigest,
    ),
  )

const changedEntriesOf = (runs: ReadonlyArray<BenchRunMeasured>): ReadonlyArray<string> =>
  Arr.sort(
    Arr.filter(
      Arr.dedupe(Arr.map(runs, (run) => run.key.entry)),
      (entry) => distinctDigestsOf(runs, entry).length > 1,
    ),
    Order.String,
  )

const workloadOf = (runs: ReadonlyArray<BenchRunMeasured>): Workload => {
  const changed = changedEntriesOf(runs)
  return Boolean.match(changed.length > 0, {
    onTrue: (): Workload => ({ _tag: 'changed', entries: changed }),
    onFalse: (): Workload => ({ _tag: 'same' }),
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
  const workloadSame = S.is(Workload.cases.same)(workload)
  const suppress = Boolean.or(
    S.is(SideCell.cases['not-measured'])(sideCellOf(runs, 'A', 'reporting')),
    S.is(SideCell.cases['not-measured'])(sideCellOf(runs, 'B', 'reporting')),
  )
  const rows = Arr.map(PHASES, (phase) => {
    const a = sideCellOf(runs, 'A', phase)
    const b = sideCellOf(runs, 'B', phase)
    return BenchPhaseRow.make({
      phase,
      a,
      b,
      verdict: verdictOf(a, b, workloadSame, Boolean.and(phase === 'mutation-test', suppress), phase),
    })
  })
  return BenchProjectSummary.make({
    corpus,
    entry,
    workload,
    counts: { a: sideCountsOf(runs, 'A'), b: sideCountsOf(runs, 'B') },
    rows,
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
