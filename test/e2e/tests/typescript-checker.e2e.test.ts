import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import { verifyAnnotatedRun } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, runIdsIn, terminalEvent, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import { readReportOf } from './__fixtures__/run-artifacts.fixture.js'
import {
  FIXTURE_NAME,
  FIXTURE_URL,
  reportEnvelopeOf,
  verifyBrokenCheckerError,
  verifyDiskStream,
  verifyProcessAndStreamIntegrity,
  verifyReportEnvelope,
  verifyRunIds,
} from './__fixtures__/typescript-checker.fixture.js'

const CHECKER_TIMEOUT_MS = 300_000

type CheckerConfigRow = {
  readonly config: string
  readonly label: string
}

const CHECKER_CONFIGS: ReadonlyArray<CheckerConfigRow> = [
  { config: 'stryker.references.config.ts', label: 'typescript-checker-references-fixture' },
  { config: 'stryker.preservation.config.ts', label: 'typescript-checker-preservation-fixture' },
  { config: 'stryker.preset.config.ts', label: 'typescript-checker-preset-fixture' },
]

const BROKEN_CHECKER_CONFIG = 'stryker.broken-checker.config.ts'
const BROKEN_CHECKER_LABEL = 'typescript-checker-broken-fixture'
const VM_RUNNER_CONFIG = 'stryker.vm.config.ts'
const VM_RUNNER_LABEL = 'typescript-checker-vm-fixture'

const runConfiguration = (config: string, label: string) =>
  When(`the CLI runs the ${config} configuration`)(
    'run',
    () => runStryker({ fixture: FIXTURE_URL, label, args: ['run', config] }),
  )

const annotatedPipeline = (row: CheckerConfigRow) =>
  Gherkin.Do.pipe(
    runConfiguration(row.config, row.label),
    When('the stdout event stream decodes to run events')('events', (s) => decodeStream(s.run.output.result.stdout)),
    Then('the process protocol and stream invariants hold')((s, expect) =>
      verifyProcessAndStreamIntegrity(expect, s.run.output.result, s.events)
    ),
    When('the terminal verdict of the decoded stream is read')('verdict', (s) => verdictEvent(s.events)),
    When('the persisted report is read through the verdict report file')(
      'report',
      (s) => readReportOf(s.verdict, s.run.output.readFile),
    ),
    Then('every reported mutant matches its authored annotation, with its status and cause confirmed')(
      (s, expect) =>
        verifyAnnotatedRun(expect, {
          fixture: FIXTURE_NAME,
          slice: row.config,
          report: s.report,
          verdict: s.verdict,
        }),
    ),
    When('the persisted report envelope is read')('envelope', (s) =>
      Effect.succeed(reportEnvelopeOf(s.run.output.result, s.report))),
    Then('the persisted report names the contract schema version')((s, expect) =>
      verifyReportEnvelope(expect, s.envelope)
    ),
    When('the run ids carried by the decoded stream are read')('runIds', (s) =>
      Effect.succeed(runIdsIn(s.events))),
    Then('every event carries the one run id')((s, expect) => verifyRunIds(expect, s.verdict, s.runIds)),
  )

const Feature = makeFeature({ it })

Feature('Checking mutations through the packed TypeScript checker', { timeout: CHECKER_TIMEOUT_MS })
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM per scenario and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'the checker reports its authored annotation outcome under the <config> configuration',
      CHECKER_CONFIGS,
      (row) => annotatedPipeline(row),
    )

    scenario(
      'A checker whose tsconfig path does not exist fails with a structured error',
      Gherkin.Do.pipe(
        runConfiguration(BROKEN_CHECKER_CONFIG, BROKEN_CHECKER_LABEL),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        When('the terminal event of the decoded stream is read')('terminal', (s) => terminalEvent(s.events)),
        Then('the run fails with a structured error naming the missing tsconfig')((s, expect) =>
          verifyBrokenCheckerError(expect, s.run.output.result, s.events, s.terminal)
        ),
      ),
    )

    scenario(
      'The in-memory vm runner persists a report and a stream that agree with stdout',
      Gherkin.Do.pipe(
        runConfiguration(VM_RUNNER_CONFIG, VM_RUNNER_LABEL),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        Then('the process protocol and stream invariants hold')((s, expect) =>
          verifyProcessAndStreamIntegrity(expect, s.run.output.result, s.events)
        ),
        When('the terminal verdict of the decoded stream is read')('verdict', (s) => verdictEvent(s.events)),
        When('the persisted report is read through the verdict report file')(
          'report',
          (s) => readReportOf(s.verdict, s.run.output.readFile),
        ),
        Then('every reported mutant matches its authored annotation, with its status and cause confirmed')(
          (s, expect) =>
            verifyAnnotatedRun(expect, {
              fixture: FIXTURE_NAME,
              slice: VM_RUNNER_CONFIG,
              report: s.report,
              verdict: s.verdict,
            }),
        ),
        When('the persisted report envelope is read')(
          'envelope',
          (s) => Effect.succeed(reportEnvelopeOf(s.run.output.result, s.report)),
        ),
        Then('the persisted report names the contract schema version')((s, expect) =>
          verifyReportEnvelope(expect, s.envelope)
        ),
        When('the run ids carried by the decoded stream are read')('runIds', (s) => Effect.succeed(runIdsIn(s.events))),
        Then('every event carries the one run id')((s, expect) => verifyRunIds(expect, s.verdict, s.runIds)),
        When('the persisted mutation stream is read and decoded')(
          'diskEvents',
          (s) => Effect.flatMap(s.run.output.readFile('reports/mutation-stream.jsonl'), decodeStream),
        ),
        Then('the persisted stream on disk matches stdout')((s, expect) =>
          verifyDiskStream(expect, s.events, s.diskEvents)
        ),
      ),
    )
  })
