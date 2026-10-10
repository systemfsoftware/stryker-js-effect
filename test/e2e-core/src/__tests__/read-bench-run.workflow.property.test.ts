import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchRunKey, BenchRunMeasured } from '../bench-run.schema.js'
import { readBenchRun, ReadBenchRunCommand } from '../read-bench-run.workflow.js'

const ENCODE = S.encodeResult(RunEvent.RunEventWireLine)

const RUN_ID = Result.getOrThrow(S.decodeResult(RunEvent.RunId)('01ARZ3NDEKTSV4RRFFQ69G5FAV'))
const MUTANT_ID = Result.getOrThrow(S.decodeResult(Mutant.MutantId)('0000000000000001'))
const MUTANT_FILE = Result.getOrThrow(S.decodeResult(Mutant.CanonicalFileName)('src/a.ts'))
const MUTATOR_NAME = Result.getOrThrow(S.decodeResult(Mutant.MutatorName)('ArithmeticOperator'))

const commandOf = (lines: ReadonlyArray<string>): ReadBenchRunCommand =>
  ReadBenchRunCommand.make({
    key: BenchRunKey.make({ corpus: 'repo', entry: 'packages/a', side: 'A', position: 0 }),
    lines,
    exitCode: 0,
    workloadDigest: 'digest',
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
})
