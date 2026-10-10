import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  BenchCorpusJson,
  BenchRun,
  BenchRunInvalid,
  BenchRunKey,
  BenchRunMeasured,
  coveringTestFiles,
  CoveringTestFilesCommand,
  readBenchRun,
  ReadBenchRunCommand,
} from '@systemfsoftware/stryker-e2e-core'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const ENCODE = S.encodeResult(RunEvent.RunEventWireLine)

const RUN_ID = Result.getOrThrow(S.decodeResult(RunEvent.RunId)('01ARZ3NDEKTSV4RRFFQ69G5FAV'))
const MUTANT_ID = Result.getOrThrow(S.decodeResult(Mutant.MutantId)('0000000000000001'))
const MUTANT_FILE = Result.getOrThrow(S.decodeResult(Mutant.CanonicalFileName)('src/a.ts'))
const MUTATOR_NAME = Result.getOrThrow(S.decodeResult(Mutant.MutatorName)('ArithmeticOperator'))

interface CorpusShape {
  readonly repo: ReadonlyArray<{ readonly project: string; readonly mutate: ReadonlyArray<string> }>
  readonly enterprise: { readonly fixture: string; readonly config: string }
}

interface MeasuredShape {
  readonly mutants: number
  readonly testsExecuted: number
  readonly check: RunEvent.CheckDuration
  readonly reporting: RunEvent.PhaseDurations['reporting']
  readonly prepare: number
}

interface InvalidShape {
  readonly lineNumber: number | null
  readonly namesVerdicts: boolean
}

const runCommandOf = (lines: ReadonlyArray<string>): ReadBenchRunCommand =>
  ReadBenchRunCommand.make({
    key: BenchRunKey.make({ corpus: 'repo', entry: 'packages/a', side: 'A', position: 0 }),
    lines,
    exit: { _tag: 'exited', code: 0 },
    workloadDigest: { _tag: 'verified', digest: 'digest' },
    stderrTail: '',
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

const mutantOf = (testsExecuted: number | null): RunEvent.RunMutantTestedEvent =>
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
    cost: testsExecuted === null ? null : { fixedOverheadMs: 1, testBodyMs: 2, testsExecuted, shared: false },
  })

const lineOf = (event: RunEvent.RunEvent): string => Result.getOrThrow(ENCODE(event))

const RAW_VERDICT_FIELDS = {
  _tag: 'verdict',
  schemaVersion: RunEvent.StreamSchemaVersion.literal,
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  mode: 'machine',
  signal: 'flag',
  score: null,
  thresholds: { high: 80, low: 60, break: null },
  reportFile: null,
  counts: {
    pending: 0,
    killed: 2,
    timeout: 0,
    survived: 1,
    noCoverage: 0,
    runtimeErrors: 0,
    compileErrors: 0,
    ignored: 0,
  },
  mutants: [],
  scope: 'full',
  mutantSetPolicy: 'default',
  static: null,
  budget: { predictedSeconds: 0, actualSeconds: 1 },
} as const

const PRE_CHECK_VERDICT = JSON.stringify({
  ...RAW_VERDICT_FIELDS,
  phaseDurations: { prepare: 1, instrument: 2, 'dry-run': 3, 'mutation-test': 4 },
})

const PRE_REPORTING_VERDICT = JSON.stringify({
  ...RAW_VERDICT_FIELDS,
  phaseDurations: { prepare: 1, instrument: 2, 'dry-run': 3, 'mutation-test': 4, check: { _tag: 'measured', ms: 1 } },
})

const corpusShapeOf = (text: string): CorpusShape | null =>
  Result.match(S.decodeResult(BenchCorpusJson)(text), {
    onFailure: () => null,
    onSuccess: (corpus): CorpusShape => ({
      repo: corpus.repo.map((entry) => ({ project: entry.project, mutate: entry.mutate })),
      enterprise: { fixture: corpus.enterprise.fixture, config: corpus.enterprise.config },
    }),
  })

const measuredOf = (run: BenchRun): MeasuredShape | null =>
  S.is(BenchRunMeasured)(run)
    ? {
      mutants: run.mutants,
      testsExecuted: run.testsExecuted,
      check: run.phaseDurations.check,
      reporting: run.phaseDurations.reporting,
      prepare: run.phaseDurations.prepare,
    }
    : null

const checkOf = (run: BenchRun): RunEvent.CheckDuration | null =>
  S.is(BenchRunMeasured)(run) ? run.phaseDurations.check : null

const reportingOf = (run: BenchRun): RunEvent.PhaseDurations['reporting'] | null =>
  S.is(BenchRunMeasured)(run) ? run.phaseDurations.reporting : null

const invalidOf = (run: BenchRun): InvalidShape | null =>
  S.is(BenchRunInvalid)(run) ? { lineNumber: run.lineNumber, namesVerdicts: run.reason.includes('verdict') } : null

const coveringCommandOf = (report: string): CoveringTestFilesCommand => CoveringTestFilesCommand.make({ report })

Feature('The bench lane reads runs and covering tests from their own stream and report')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'The corpus JSON accepts a populated corpus and refuses an empty repo list',
      Gherkin.Do.pipe(
        Given('a populated corpus text and one with an empty repo list')(
          'texts',
          () =>
            Effect.succeed({
              populated: JSON.stringify({
                repo: [{ project: 'packages/a', mutate: ['src/a.ts'] }],
                enterprise: { fixture: 'test/e2e/fixture', config: 'stryker.conf.json' },
              }),
              empty: JSON.stringify({
                repo: [],
                enterprise: { fixture: 'test/e2e/fixture', config: 'stryker.conf.json' },
              }),
            }),
        ),
        When('each text is decoded as a corpus')(
          'corpora',
          (s) =>
            Effect.sync(() => ({ populated: corpusShapeOf(s.texts.populated), empty: corpusShapeOf(s.texts.empty) })),
        ),
        Then('the populated corpus decodes and the empty repo list is refused')((s, expect) =>
          expect(s.corpora).toStrictEqual({
            populated: {
              repo: [{ project: 'packages/a', mutate: ['src/a.ts'] }],
              enterprise: { fixture: 'test/e2e/fixture', config: 'stryker.conf.json' },
            },
            empty: null,
          })
        ),
      ),
    )

    scenario(
      'A valid stream yields a measured run carrying the verdict durations and summed test executions',
      Gherkin.Do.pipe(
        Given('a stream with one measured verdict and two mutant lines, one without a cost')(
          'lines',
          () =>
            Effect.succeed([
              lineOf(verdictOf(metricsOf(2, 1), phasesOf(2.5, 3))),
              lineOf(mutantOf(4)),
              lineOf(mutantOf(null)),
              lineOf(mutantOf(6)),
            ]),
        ),
        When('the stream is read as a bench run')('run', (s) => Effect.sync(() => readBenchRun(runCommandOf(s.lines)))),
        Then('the run is measured with the durations, the verdict mutant count and the summed costs')((s, expect) =>
          expect(Result.isSuccess(s.run) ? measuredOf(s.run.success) : null).toStrictEqual({
            mutants: 3,
            testsExecuted: 10,
            check: { _tag: 'measured', ms: 2.5 },
            reporting: { _tag: 'measured', ms: 3 },
            prepare: 1,
          })
        ),
      ),
    )

    scenario(
      'A verdict line written before check existed decodes as check not-recorded',
      Gherkin.Do.pipe(
        Given('a verdict line whose phase durations carry no check key')(
          'lines',
          () => Effect.succeed([PRE_CHECK_VERDICT]),
        ),
        When('the stream is read as a bench run')('run', (s) => Effect.sync(() => readBenchRun(runCommandOf(s.lines)))),
        Then('the run is measured and its check is not-recorded')((s, expect) =>
          expect(Result.isSuccess(s.run) ? checkOf(s.run.success) : null).toStrictEqual({ _tag: 'not-recorded' })
        ),
      ),
    )

    scenario(
      'A verdict line written before reporting existed decodes as reporting not-recorded while one carrying it is measured',
      Gherkin.Do.pipe(
        Given('a verdict line without a reporting key and one whose reporting is measured 2.5')(
          'runs',
          () =>
            Effect.succeed({
              absent: readBenchRun(runCommandOf([PRE_REPORTING_VERDICT])),
              present: readBenchRun(runCommandOf([lineOf(verdictOf(metricsOf(0, 1), phasesOf(1, 2.5)))])),
            }),
        ),
        Then('the absent key reads not-recorded and the present one measured')((s, expect) =>
          expect({
            absent: Result.isSuccess(s.runs.absent) ? reportingOf(s.runs.absent.success) : null,
            present: Result.isSuccess(s.runs.present) ? reportingOf(s.runs.present.success) : null,
          }).toStrictEqual({ absent: { _tag: 'not-recorded' }, present: { _tag: 'measured', ms: 2.5 } })
        ),
      ),
    )

    scenario(
      'An undecodable line anywhere in the stream is refused naming its 1-based line number',
      Gherkin.Do.pipe(
        Given('a stream whose third line decodes under no contract event')(
          'lines',
          () =>
            Effect.succeed([
              lineOf(verdictOf(metricsOf(0, 1), phasesOf(1, 2))),
              '',
              'not a stream line',
              lineOf(mutantOf(1)),
            ]),
        ),
        When('the stream is read as a bench run')('run', (s) => Effect.sync(() => readBenchRun(runCommandOf(s.lines)))),
        Then('the run is invalid naming line 3')((s, expect) =>
          expect(Result.isSuccess(s.run) ? invalidOf(s.run.success) : null).toStrictEqual({
            lineNumber: 3,
            namesVerdicts: false,
          })
        ),
      ),
    )

    scenario(
      'A stream with zero verdict events is refused',
      Gherkin.Do.pipe(
        Given('a stream holding only a mutant line')('lines', () => Effect.succeed([lineOf(mutantOf(1))])),
        When('the stream is read as a bench run')('run', (s) => Effect.sync(() => readBenchRun(runCommandOf(s.lines)))),
        Then('the run is invalid and names the verdict count')((s, expect) =>
          expect(Result.isSuccess(s.run) ? invalidOf(s.run.success) : null).toStrictEqual({
            lineNumber: null,
            namesVerdicts: true,
          })
        ),
      ),
    )

    scenario(
      'A stream with two verdict events is refused',
      Gherkin.Do.pipe(
        Given('a stream holding two verdict lines')(
          'lines',
          () =>
            Effect.succeed([
              lineOf(verdictOf(metricsOf(0, 1), phasesOf(1, 2))),
              lineOf(verdictOf(metricsOf(0, 1), phasesOf(1, 2))),
            ]),
        ),
        When('the stream is read as a bench run')('run', (s) => Effect.sync(() => readBenchRun(runCommandOf(s.lines)))),
        Then('the run is invalid and names the verdict count')((s, expect) =>
          expect(Result.isSuccess(s.run) ? invalidOf(s.run.success) : null).toStrictEqual({
            lineNumber: null,
            namesVerdicts: true,
          })
        ),
      ),
    )

    scenario(
      'A verdict whose phase durations are null is refused',
      Gherkin.Do.pipe(
        Given('a verdict line carrying null phase durations')(
          'lines',
          () => Effect.succeed([lineOf(verdictOf(metricsOf(0, 1), null))]),
        ),
        When('the stream is read as a bench run')('run', (s) => Effect.sync(() => readBenchRun(runCommandOf(s.lines)))),
        Then('the run is invalid')((s, expect) =>
          expect(s.run).toSatisfy(
            (run) => Result.isSuccess(run) && S.is(BenchRunInvalid)(run.success),
            'a verdict with null phase durations leaves the run invalid',
          )
        ),
      ),
    )

    scenario(
      'Covering test files name exactly the files holding a covering id, deduped and sorted',
      Gherkin.Do.pipe(
        Given('a report whose mutants cover two ids in one test file and one in another')(
          'report',
          () =>
            Effect.succeed(
              JSON.stringify({
                files: {
                  'src/b.ts': { mutants: [{ coveredBy: ['t1', 't2'] }] },
                  'src/a.ts': { mutants: [{ coveredBy: ['t3'] }] },
                },
                testFiles: {
                  'test/z.test.ts': { tests: [{ id: 't1' }, { id: 't3' }] },
                  'test/a.test.ts': { tests: [{ id: 't2' }, { id: 'uncovered' }] },
                },
              }),
            ),
        ),
        When('the report is read as covering test files')(
          'found',
          (s) => Effect.sync(() => coveringTestFiles(coveringCommandOf(s.report))),
        ),
        Then('the mutated files are sorted and the covering test files are the deduped, sorted holders')((s, expect) =>
          expect(
            Result.isSuccess(s.found)
              ? { mutatedFiles: s.found.success.mutatedFiles, testFiles: s.found.success.testFiles }
              : null,
          ).toStrictEqual({
            mutatedFiles: ['src/a.ts', 'src/b.ts'],
            testFiles: ['test/a.test.ts', 'test/z.test.ts'],
          })
        ),
      ),
    )

    scenario(
      'A covering id no test file declares and a malformed report are both refused',
      Gherkin.Do.pipe(
        Given('a report whose mutant covers an undeclared id and a report that is not JSON')(
          'reports',
          () =>
            Effect.succeed({
              undeclared: JSON.stringify({
                files: { 'src/a.ts': { mutants: [{ coveredBy: ['ghost'] }] } },
                testFiles: { 'test/a.test.ts': { tests: [{ id: 'declared' }] } },
              }),
              malformed: 'not json',
            }),
        ),
        When('each report is read as covering test files')(
          'outcomes',
          (s) =>
            Effect.sync(() => ({
              undeclared: Result.isFailure(coveringTestFiles(coveringCommandOf(s.reports.undeclared))),
              malformed: Result.isFailure(coveringTestFiles(coveringCommandOf(s.reports.malformed))),
            })),
        ),
        Then('both are refused')((s, expect) =>
          expect(s.outcomes).toStrictEqual({ undeclared: true, malformed: true })
        ),
      ),
    )
  })
