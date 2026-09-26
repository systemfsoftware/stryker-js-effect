import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect } from 'effect'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, terminalEvent, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import {
  FIXTURE_URL,
  runIdsIn,
  verifyBrokenCheckerError,
  verifyDiskReport,
  verifyDiskStream,
  verifyMutantStreamAndActionables,
  verifyPresetMutants,
  verifyProcessAndStreamIntegrity,
  verifyVerdictCounts,
} from './__fixtures__/typescript-checker.fixture.js'

const CHECKER_TIMEOUT_MS = 300_000

type CheckerOracle = 'verdict-and-mutants' | 'preset-mutants'

type CheckerConfigRow = {
  readonly config: string
  readonly label: string
  readonly oracle: CheckerOracle
}

const CHECKER_CONFIGS: ReadonlyArray<CheckerConfigRow> = [
  {
    config: 'stryker.references.config.ts',
    label: 'typescript-checker-references-fixture',
    oracle: 'verdict-and-mutants',
  },
  {
    config: 'stryker.preservation.config.ts',
    label: 'typescript-checker-preservation-fixture',
    oracle: 'verdict-and-mutants',
  },
  { config: 'stryker.preset.config.ts', label: 'typescript-checker-preset-fixture', oracle: 'preset-mutants' },
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

const verdictAndMutantsPipeline = (row: CheckerConfigRow) =>
  Gherkin.Do.pipe(
    runConfiguration(row.config, row.label),
    When('the stdout event stream decodes to run events')('events', (s) => decodeStream(s.run.output.result.stdout)),
    Then('the process protocol and stream invariants hold')((s, expect) =>
      verifyProcessAndStreamIntegrity(expect, s.run.output.result, s.events)
    ),
    When('the terminal verdict of the decoded stream is read')('verdict', (s) => verdictEvent(s.events)),
    Then('the verdict carries the oracle counts')((s, expect) => verifyVerdictCounts(expect, s.verdict)),
    When('the run ids carried by the decoded stream are read')('runIds', (s) => Effect.succeed(runIdsIn(s.events))),
    Then('the mutant stream matches the oracle and every event carries one run id')((s, expect) =>
      verifyMutantStreamAndActionables(expect, s.events, s.verdict, s.runIds)
    ),
  )

const presetMutantsPipeline = (row: CheckerConfigRow) =>
  Gherkin.Do.pipe(
    runConfiguration(row.config, row.label),
    When('the stdout event stream decodes to run events')('events', (s) => decodeStream(s.run.output.result.stdout)),
    Then('the process protocol and stream invariants hold')((s, expect) =>
      verifyProcessAndStreamIntegrity(expect, s.run.output.result, s.events)
    ),
    When('the terminal verdict of the decoded stream is read')('verdict', (s) => verdictEvent(s.events)),
    Then('the mutant that drops the guard inherited from the extended preset is a compile error')((s, expect) =>
      verifyPresetMutants(expect, s.events, s.verdict)
    ),
  )

const Feature = makeFeature({ it })

Feature('Checking mutations through the packed TypeScript checker', { timeout: CHECKER_TIMEOUT_MS })
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM per scenario and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'the checker reports its authored verdict under the <config> configuration',
      CHECKER_CONFIGS,
      (row) => row.oracle === 'preset-mutants' ? presetMutantsPipeline(row) : verdictAndMutantsPipeline(row),
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
        Then('the verdict carries the oracle counts')((s, expect) => verifyVerdictCounts(expect, s.verdict)),
        When('the run ids carried by the decoded stream are read')('runIds', (s) => Effect.succeed(runIdsIn(s.events))),
        Then('the mutant stream matches the oracle and every event carries one run id')((s, expect) =>
          verifyMutantStreamAndActionables(expect, s.events, s.verdict, s.runIds)
        ),
        When('the persisted mutation report is read')(
          'reportText',
          (s) => s.run.output.readFile('reports/mutation/mutation.json'),
        ),
        Then('the persisted report conforms to the published schema')((s, expect) =>
          verifyDiskReport(expect, s.run.output.result, s.reportText)
        ),
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
