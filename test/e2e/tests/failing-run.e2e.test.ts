import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { FailureRecord, type RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect, Schema } from 'effect'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, MachineStreamError, terminalEvent } from './__fixtures__/machine-stream.fixture.js'

const BASELINE_TESTS_FAILED_EXIT_CODE = 5
const STREAM_SCHEMA_VERSION = '3.0'
const FAILING_FIXTURE_URL = new URL('../testResources/failing-fixture', import.meta.url)
const FAILING_TEST_NAME = 'isEven reports three as even'
const FAILING_TEST_FILE = 'src/thing.test.ts'
const FAILING_TEST_LINE = 7
const FAILURE_RECORD_FILE = 'reports/mutation/failure.json'
const FAILING_TEST_REPLAY_ARGV: ReadonlyArray<string> = ['vitest', 'run', FAILING_TEST_FILE, '-t', FAILING_TEST_NAME]
const BASELINE_TESTS_FAILED_NEXT_ACTION: FailureRecord.NextAction = { primary: 'fixCode', otherwise: 'fixTest' }

const failureRecordOf = (terminal: RunEvent.RunEvent): FailureRecord.FailureRecord | undefined =>
  terminal._tag === 'error' ? terminal.record : undefined

const failingTestOf = (
  record: FailureRecord.FailureRecord | undefined,
): FailureRecord.FailedTestEvidence | undefined => record?._tag === 'BaselineTestsFailed' ? record.tests[0] : undefined

const decodeFailureRecord = (
  text: string,
): Effect.Effect<FailureRecord.FailureRecord, MachineStreamError> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(FailureRecord.FailureRecordFile)(text),
    (issue) => new MachineStreamError({ line: text.slice(0, 400), detail: `failure record: ${issue.message}` }),
  )

const verifyFailingDryRunExit = (expect: Expect, run: ExecResult): Check =>
  expect(run.exitCode).toBe(BASELINE_TESTS_FAILED_EXIT_CODE)

const verifyStreamCleanliness = (expect: Expect, events: ReadonlyArray<RunEvent.RunEvent>): Check =>
  expect({
    hasEvents: events.length > 0,
    everyTagIsAString: events.every((event) => typeof event._tag === 'string'),
  }).toStrictEqual({ hasEvents: true, everyTagIsAString: true })

const verifyTypedErrorDocument = (
  expect: Expect,
  terminal: RunEvent.RunEvent,
  events: ReadonlyArray<RunEvent.RunEvent>,
): Check => {
  const failure: RunEvent.RunFailed | undefined = terminal._tag === 'error' ? terminal : undefined
  const record = failureRecordOf(terminal)
  const capsule = record?.capsule
  const tags = events.map((event) => event._tag)
  const failed = failingTestOf(record)

  return expect({
    terminalTag: terminal._tag,
    schemaVersion: failure?.schemaVersion,
    code: failure?.code,
    recordTag: record?._tag,
    stage: record?.stage,
    capsuleReplays: capsule?._tag === 'Replays',
    argv: capsule?._tag === 'Replays' ? capsule.argv : undefined,
    nextAction: record?.nextAction,
    carriesVerdict: tags.includes('verdict'),
    testCount: record?._tag === 'BaselineTestsFailed' ? record.testCount : undefined,
    failedTestCount: record?._tag === 'BaselineTestsFailed' ? record.tests.length : undefined,
    name: failed?.name,
    fileNameNamesTheFailingTest: (failed?.file ?? '').endsWith(FAILING_TEST_FILE),
    locationFile: failed?.location?.file,
    locationLine: failed?.location?.line,
    locationColumnIsPositive: (failed?.location?.column ?? 0) >= 1,
    messageNamesTheFailure: /\S/.test(failed?.message ?? '') && (failed?.message ?? '').includes('expected'),
  }).toStrictEqual({
    terminalTag: 'error',
    schemaVersion: STREAM_SCHEMA_VERSION,
    code: BASELINE_TESTS_FAILED_EXIT_CODE,
    recordTag: 'BaselineTestsFailed',
    stage: 'dryRun',
    capsuleReplays: true,
    argv: FAILING_TEST_REPLAY_ARGV,
    nextAction: BASELINE_TESTS_FAILED_NEXT_ACTION,
    carriesVerdict: false,
    testCount: 1,
    failedTestCount: 1,
    name: FAILING_TEST_NAME,
    fileNameNamesTheFailingTest: true,
    locationFile: FAILING_TEST_FILE,
    locationLine: FAILING_TEST_LINE,
    locationColumnIsPositive: true,
    messageNamesTheFailure: true,
  })
}

const verifyPersistedFailureRecord = (
  expect: Expect,
  terminal: RunEvent.RunEvent,
  persisted: FailureRecord.FailureRecord,
): Check => expect(persisted).toStrictEqual(failureRecordOf(terminal))

const Feature = makeFeature({ it })

Feature('Failing a mutation run at the process boundary')
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM per scenario and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'A dry-run failure reports an error document instead of a verdict',
      Gherkin.Do.pipe(
        When('the CLI runs in machine mode against a fixture configured to fail during dry run')(
          'run',
          () => runStryker({ fixture: FAILING_FIXTURE_URL, label: 'failing-fixture', args: ['run'] }),
        ),
        Then('the process exits with the baseline tests failed code')((s, expect) =>
          verifyFailingDryRunExit(expect, s.run.output.result)
        ),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        Then('every machine event is a tagged record')((s, expect) => verifyStreamCleanliness(expect, s.events)),
        When('the terminal event of the decoded stream is read')('terminal', (s) => terminalEvent(s.events)),
        Then(
          'the run emits a structured error document whose baseline failure record names the failing test with its file, line and failure message, and no verdict',
        )((s, expect) => verifyTypedErrorDocument(expect, s.terminal, s.events)),
        When('the failure record the run wrote to disk is read')(
          'persistedRecord',
          (s) => Effect.flatMap(s.run.output.readFile(FAILURE_RECORD_FILE), decodeFailureRecord),
        ),
        Then('the persisted failure record is the one the terminal event carries')((s, expect) =>
          verifyPersistedFailureRecord(expect, s.terminal, s.persistedRecord)
        ),
      ),
    )
  })
