import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchRunInvalid, BenchRunKey, BenchRunMeasured, type WorkloadDigest } from '../bench-run.schema.js'
import { readBenchRun, ReadBenchRunCommand } from '../read-bench-run.workflow.js'

const ENCODE = S.encodeResult(RunEvent.RunEventWireLine)

const RUN_ID = Result.getOrThrow(S.decodeResult(RunEvent.RunId)('01ARZ3NDEKTSV4RRFFQ69G5FAV'))
const MUTANT_ID = Result.getOrThrow(S.decodeResult(Mutant.MutantId)('0000000000000001'))
const MUTANT_FILE = Result.getOrThrow(S.decodeResult(Mutant.CanonicalFileName)('src/a.ts'))
const MUTATOR_NAME = Result.getOrThrow(S.decodeResult(Mutant.MutatorName)('ArithmeticOperator'))

interface CommandOptions {
  readonly exitCode?: number
  readonly workloadDigest?: WorkloadDigest
  readonly stderrTail?: string
}

const commandOf = (lines: ReadonlyArray<string>, options: CommandOptions = {}): ReadBenchRunCommand =>
  ReadBenchRunCommand.make({
    key: BenchRunKey.make({ corpus: 'repo', entry: 'packages/a', side: 'A', position: 0 }),
    lines,
    exitCode: options.exitCode ?? 0,
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

const mutantOf = (cost: RunEvent.MutantCost | null): RunEvent.RunMutantTested =>
  RunEvent.RunMutantTestedEvent.cases.Killed.make({
    _tag: 'mutantTested',
    id: MUTANT_ID,
    status: 'Killed',
    statusReason: 'killed: expected 1 to be 2',
    killedBy: [],
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

const VALID_VERDICT = lineOf(verdictOf(metricsOf(0, 1), phasesOf(1, 2)))

const verdictLinesOf = (counts: Report.Metrics | null): ReadonlyArray<string> =>
  counts === null ? [] : [lineOf(verdictOf(counts, phasesOf(1, 2)))]

const prefixLineOf = (slot: boolean | null): ReadonlyArray<string> =>
  slot === null ? [] : slot ? ['  '] : [lineOf(mutantOf(null))]

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
    '∀sn_ExitedUndecodableStream_≡InvalidCarryingThatExitCodeAndStderrTail',
    { of: [S.Int, S.String], subject: readBenchRun },
    (subject, [exitCode, stderrTail]) => {
      const command = commandOf(['not a stream line'], { exitCode, stderrTail })
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
    '∀ts_TestedEventCosts_≡SummedIntoTestsExecutedWithAMissingCostCountingZero',
    {
      of: [S.NullOr(RunEvent.MutantCost), S.NullOr(RunEvent.MutantCost), S.NullOr(RunEvent.MutantCost)],
      subject: readBenchRun,
    },
    (subject, [first, second, third]) => {
      const lines = [lineOf(mutantOf(first)), VALID_VERDICT, lineOf(mutantOf(second)), lineOf(mutantOf(third))]
      const expected = (first?.testsExecuted ?? 0) + (second?.testsExecuted ?? 0) + (third?.testsExecuted ?? 0)
      return Result.match(subject(commandOf(lines)), {
        onFailure: () => false,
        onSuccess: (run) => S.is(BenchRunMeasured)(run) && run.testsExecuted === expected,
      })
    },
  )

  it.prop(
    '∀ln_UndecodableLineAmongBlankAndDecodableLines_≡InvalidNamingItsOneBasedLineNumber',
    { of: [S.NullOr(S.Boolean), S.NullOr(S.Boolean), S.NullOr(S.Boolean)], subject: readBenchRun },
    (subject, [first, second, third]) => {
      const prefix = [...prefixLineOf(first), ...prefixLineOf(second), ...prefixLineOf(third)]
      const lineNumber = prefix.length + 1
      return Result.match(subject(commandOf([...prefix, 'not a stream line', 'also not a stream line'])), {
        onFailure: () => false,
        onSuccess: (run) =>
          S.is(BenchRunInvalid)(run) &&
          run.code === 'stream-undecodable' &&
          run.lineNumber === lineNumber &&
          run.reason.startsWith(`stdout line ${lineNumber} `),
      })
    },
  )

  it.prop(
    '∀vc_VerdictLines_≡MeasuredWithItsMutantCountIffExactlyOneElseInvalidNamingTheCount',
    { of: [S.NullOr(Report.Metrics), S.NullOr(Report.Metrics), S.NullOr(Report.Metrics)], subject: readBenchRun },
    (subject, [first, second, third]) => {
      const verdicts = [...verdictLinesOf(first), ...verdictLinesOf(second), ...verdictLinesOf(third)]
      const only = first ?? second ?? third
      return Result.match(subject(commandOf([lineOf(mutantOf(null)), ...verdicts])), {
        onFailure: () => false,
        onSuccess: (run) =>
          verdicts.length === 1
            ? S.is(BenchRunMeasured)(run) && run.mutants === only?.totalMutants
            : S.is(BenchRunInvalid)(run) &&
              run.code === 'stream-invalid' &&
              run.lineNumber === null &&
              run.reason.endsWith(`found ${verdicts.length}`),
      })
    },
  )

  it.prop(
    '∀pd_VerdictPhaseDurations_≡CarriedAsReportedOrStreamInvalidWhenAbsent',
    { of: [Report.Metrics, S.NullOr(RunEvent.PhaseDurations)], subject: readBenchRun },
    (subject, [counts, phaseDurations]) =>
      Result.match(subject(commandOf([lineOf(verdictOf(counts, phaseDurations))])), {
        onFailure: () => false,
        onSuccess: (run) =>
          phaseDurations === null
            ? S.is(BenchRunInvalid)(run) && run.code === 'stream-invalid' && run.lineNumber === null
            : S.is(BenchRunMeasured)(run) &&
              S.toEquivalence(RunEvent.PhaseDurations)(run.phaseDurations, phaseDurations),
      }),
  )
})
