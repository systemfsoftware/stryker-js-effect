import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  BenchRunInvalid,
  BenchRunKey,
  BenchRunMeasured,
  type RunExit,
  type WorkloadDigest,
} from '../bench-run.schema.js'
import { readBenchRun, ReadBenchRunCommand } from '../read-bench-run.workflow.js'

const ENCODE = S.encodeResult(RunEvent.RunEventWireLine)

const RUN_ID = Result.getOrThrow(S.decodeResult(RunEvent.RunId)('01ARZ3NDEKTSV4RRFFQ69G5FAV'))
const MUTANT_ID = Result.getOrThrow(S.decodeResult(Mutant.MutantId)('0000000000000001'))
const MUTANT_FILE = Result.getOrThrow(S.decodeResult(Mutant.CanonicalFileName)('src/a.ts'))
const MUTATOR_NAME = Result.getOrThrow(S.decodeResult(Mutant.MutatorName)('ArithmeticOperator'))

interface CommandOptions {
  readonly exit?: RunExit
  readonly workloadDigest?: WorkloadDigest
  readonly stderrTail?: string
  readonly arrivalsMs?: ReadonlyArray<number>
}

const commandOf = (lines: ReadonlyArray<string>, options: CommandOptions = {}): ReadBenchRunCommand =>
  ReadBenchRunCommand.make({
    key: BenchRunKey.make({ corpus: 'repo', entry: 'packages/a', side: 'A', position: 0 }),
    lines,
    arrivalsMs: options.arrivalsMs ?? lines.map((_line, index) => index),
    exit: options.exit ?? { _tag: 'exited', code: 0 },
    workloadDigest: options.workloadDigest ?? { _tag: 'verified', digest: 'digest' },
    stderrTail: options.stderrTail ?? '',
    wallMs: 10,
  })

const metricsOf = (killed: number, survived: number): Report.Metrics =>
  Report.Metrics.make({
    pending: 0,
    killed,
    timeout: 0,
    survived,
    noCoverage: 0,
    runtimeErrors: 0,
    compileErrors: 0,
    ignored: 0,
  })

const phasesOf = (checkMs: number, reportingMs: number): RunEvent.PhaseDurations => ({
  prepare: 1,
  instrument: 2,
  'dry-run': 3,
  'mutation-test': 4,
  check: { _tag: 'measured', ms: checkMs },
  reporting: { _tag: 'measured', ms: reportingMs },
})

const verdictOf = (counts: Report.Metrics, phaseDurations: RunEvent.PhaseDurations | null): RunEvent.RunEvent =>
  RunEvent.VerdictReached.make({
    schemaVersion: RunEvent.StreamSchemaVersion.literal,
    runId: RUN_ID,
    mode: 'machine',
    signal: 'flag',
    score: null,
    thresholds: { high: 80, low: 60, break: null },
    reportFile: null,
    counts,
    mutants: [],
    scope: 'full',
    mutantSetPolicy: 'default',
    phaseDurations,
    static: null,
    budget: { predictedSeconds: 0, actualSeconds: 1 },
  })

const mutantOf = (cost: RunEvent.MutantCost | null): RunEvent.RunMutantTestedEvent =>
  RunEvent.RunMutantTestedEvent.make({
    id: MUTANT_ID,
    status: 'Killed',
    statusReason: null,
    fileName: MUTANT_FILE,
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    mutatorName: MUTATOR_NAME,
    replacement: null,
    completed: 1,
    total: 1,
    static: false,
    subsumption: null,
    cost,
  })

const costOf = (testsExecuted: number): RunEvent.MutantCost => ({
  fixedOverheadMs: 1,
  testBodyMs: 2,
  testsExecuted,
  shared: false,
})

const lineOf = (event: RunEvent.RunEvent): string => Result.getOrThrow(ENCODE(event))

const checkIsMeasuredAt = (check: RunEvent.CheckDuration, ms: number): boolean =>
  Match.value(check).pipe(
    Match.tag('measured', (measured) => measured.ms === ms),
    Match.tag('not-run', () => false),
    Match.tag('not-recorded', () => false),
    Match.exhaustive,
  )

const nonNegativeIntArb = Arbitrary.schema(Report.NonNegativeInt)

const runningSums = (gaps: ReadonlyArray<number>): ReadonlyArray<number> =>
  gaps.reduce<ReadonlyArray<number>>((sums, gap) => [...sums, (sums.at(-1) ?? 0) + gap], [])

describe('readBenchRun', () => {
  it.prop(
    '∀t_MutantTestCost_≡RecordedAsItsTestsExecutedAndTheVerdictsMutantCount',
    { of: [nonNegativeIntArb, nonNegativeIntArb, nonNegativeIntArb], subject: readBenchRun },
    (subject, [killed, survived, testsExecuted]) => {
      const lines = [
        lineOf(verdictOf(metricsOf(killed, survived), phasesOf(2.5, 3))),
        lineOf(mutantOf(null)),
        lineOf(mutantOf(costOf(testsExecuted))),
      ]
      return Result.match(subject(commandOf(lines)), {
        onFailure: () => false,
        onSuccess: (run) =>
          S.is(BenchRunMeasured)(run) &&
          run.mutants === killed + survived &&
          run.testsExecuted === testsExecuted &&
          checkIsMeasuredAt(run.phaseDurations.check, 2.5),
      })
    },
  )

  it.prop(
    '∀s_TimedOutExit_≡InvalidTimeoutCarryingNullExitCodeAndTheStderrTail',
    { of: [S.String], subject: readBenchRun },
    (subject, [stderrTail]) => {
      const command = commandOf([], { exit: { _tag: 'timed-out', afterMs: 60_000 }, stderrTail })
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (run) =>
          S.is(BenchRunInvalid)(run) &&
          run.code === 'timeout' &&
          run.exitCode === null &&
          run.stderrTail === stderrTail,
      })
    },
  )

  it.prop(
    '∀sn_ExitedUndecodableStream_≡InvalidCarryingThatExitCodeAndStderrTail',
    { of: [S.Int, S.String], subject: readBenchRun },
    (subject, [exitCode, stderrTail]) => {
      const command = commandOf(['not a stream line'], {
        exit: { _tag: 'exited', code: exitCode },
        stderrTail,
      })
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (run) =>
          S.is(BenchRunInvalid)(run) &&
          run.code === 'stream-undecodable' &&
          run.exitCode === exitCode &&
          run.stderrTail === stderrTail,
      })
    },
  )

  it.prop(
    '∀pg_TwoPhaseLinesArrivingAtTimes_≡EachPhaseTimedFromItsLineToTheNextMark',
    {
      of: [RunEvent.RunPhase, RunEvent.RunPhase, Report.NonNegativeInt, Report.NonNegativeInt, Report.NonNegativeInt],
      subject: readBenchRun,
    },
    (subject, [first, second, firstAt, secondGap, verdictGap]) => {
      const lines = [
        lineOf(RunEvent.PhaseEntered.make({ phase: first, elapsedMs: 0 })),
        lineOf(mutantOf(null)),
        lineOf(RunEvent.PhaseEntered.make({ phase: second, elapsedMs: 0 })),
        lineOf(verdictOf(metricsOf(1, 0), phasesOf(0, 0))),
      ]
      const secondAt = firstAt + 1 + secondGap
      const verdictAt = secondAt + verdictGap
      const arrivalsMs = [firstAt, firstAt + 1, secondAt, verdictAt]
      return Result.match(subject(commandOf(lines, { arrivalsMs })), {
        onFailure: () => false,
        onSuccess: (run) =>
          S.is(BenchRunMeasured)(run) &&
          run.phaseTimes.length === 2 &&
          run.phaseTimes[0]?.phase === first &&
          run.phaseTimes[0].startMs === firstAt &&
          run.phaseTimes[0].endMs === secondAt &&
          run.phaseTimes[1]?.phase === second &&
          run.phaseTimes[1].startMs === secondAt &&
          run.phaseTimes[1].endMs === verdictAt,
      })
    },
  )

  it.prop(
    '∀g_ArrivalCount_≡InvalidStreamExactlyWhenItDiffersFromTheLineCount',
    { of: [S.Array(Report.NonNegativeInt)], subject: readBenchRun },
    (subject, [gaps]) => {
      const lines = [lineOf(mutantOf(null)), lineOf(verdictOf(metricsOf(1, 0), phasesOf(0, 0)))]
      const arrivalsMs = runningSums(gaps)
      return Result.match(subject(commandOf(lines, { arrivalsMs })), {
        onFailure: () => false,
        onSuccess: (run) =>
          (arrivalsMs.length !== lines.length) === (S.is(BenchRunInvalid)(run) && run.code === 'stream-invalid'),
      })
    },
  )
})
