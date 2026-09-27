import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { Contract } from '@systemfsoftware/trace-spec'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'

import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { compareAnnotatedRun } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, runIdsIn, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import { readReportOf } from './__fixtures__/run-artifacts.fixture.js'
import { strykerLifecycleContract } from './__fixtures__/stryker-trace.fixture.js'
import { TraceObservationLive } from './__fixtures__/trace-observation.fixture.js'

const ENTERPRISE_FIXTURE = 'enterprise-monorepo-fixture'
const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)
const ENTERPRISE_FIXTURE_LABEL = 'enterprise-lifecycle-fixture'
const LIFECYCLE_SLICE = 'stryker.config.ts'
const LIFECYCLE_TIMEOUT_MILLIS = 2_400_000
const TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['verdict', 'error', 'help']
const NON_TERMINAL_RUN_KINDS: ReadonlyArray<string> = [
  'stream',
  'phase',
  'plan',
  'mutantTested',
  'tick',
  'plugins',
  'formats',
  'skipped',
]
const REQUIRED_EVENT_KINDS: ReadonlyArray<string> = ['stream', 'phase', 'plan', 'mutantTested', 'verdict']
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[`)

const statusesOf = (report: Report.MutationTestResult): ReadonlyArray<string> =>
  Object.values(report.files).flatMap((file) => file.mutants.map((mutant) => mutant.status))

const terminalIndexesIn = (kinds: ReadonlyArray<string>): ReadonlyArray<number> =>
  kinds
    .map((kind, index) => ({ index, kind }))
    .filter((entry) => TERMINAL_RUN_KINDS.includes(entry.kind))
    .map((entry) => entry.index)

const verifyStreamAndExit = (
  expect: Expect,
  run: ExecResult,
  events: ReadonlyArray<RunEvent.RunEvent>,
): Check => {
  const kinds: ReadonlyArray<string> = events.map((event) => event._tag)
  const preceding = kinds.slice(0, -1)

  return expect({
    exitCode: run.exitCode,
    terminalIndexes: terminalIndexesIn(kinds),
    lastKind: kinds.at(-1),
    ansiMatch: run.stdout.match(ANSI_ESCAPE),
    precedingIsNonEmpty: preceding.length > 0,
    strayPrecedingKinds: preceding.filter((kind) => !NON_TERMINAL_RUN_KINDS.includes(kind)),
    missingRequiredKinds: REQUIRED_EVENT_KINDS.filter((kind) => !kinds.includes(kind)),
  }).toStrictEqual({
    exitCode: 0,
    terminalIndexes: [kinds.length - 1],
    lastKind: 'verdict',
    ansiMatch: null,
    precedingIsNonEmpty: true,
    strayPrecedingKinds: [],
    missingRequiredKinds: [],
  })
}

const verifyRunIdConsistency = (
  expect: Expect,
  runIds: ReadonlyArray<string>,
  verdict: RunEvent.VerdictReached,
): Check =>
  expect({
    carriesRunIds: runIds.length > 0,
    everyRunIdMatchesTheVerdict: runIds.every((runId) => runId === verdict.runId),
  }).toStrictEqual({
    carriesRunIds: true,
    everyRunIdMatchesTheVerdict: true,
  })

const Feature = makeFeature({ it })

Feature('Running the enterprise mutation lifecycle through the packed CLI', { timeout: LIFECYCLE_TIMEOUT_MILLIS })
  .withLayer(E2eHarnessLive)
  .withScenarioLayer(TraceObservationLive)
  .live(
    'boots a warm microVM for the enterprise fixture and runs the packed CLI, whose host and worker spans the Grafana LGTM collector holds under the owned trace id of the run',
  )
  .body(({ scenario }) => {
    scenario(
      'The lifecycle run holds its trace contract and confirms the annotations authored in its fixture',
      Gherkin.Do.pipe(
        When('the CLI executes the full lifecycle mutation run and the trace contract is judged')(
          'judgment',
          () =>
            Contract.judge(strykerLifecycleContract, {
              fixture: ENTERPRISE_FIXTURE_URL,
              label: ENTERPRISE_FIXTURE_LABEL,
              args: ['run'],
            }),
        ),
        Then('the trace of the run holds the lifecycle contract')((s, expect) =>
          Contract.verdictCheck(strykerLifecycleContract, expect, s.judgment)
        ),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.judgment.run.output.result.stdout),
        ),
        Then('the process stream protocol invariants hold')((s, expect) =>
          verifyStreamAndExit(expect, s.judgment.run.output.result, s.events)
        ),
        When('the terminal verdict of the decoded stream is read')(
          'verdict',
          (s) => verdictEvent(s.events),
        ),
        When('the run ids carried by the decoded stream are read')(
          'runIds',
          (s) => Effect.succeed(runIdsIn(s.events)),
        ),
        Then('every event carries the verdict run id')((s, expect) =>
          verifyRunIdConsistency(expect, s.runIds, s.verdict)
        ),
        When('the persisted report of the run is read from its fork')(
          'report',
          (s) => readReportOf(s.verdict, s.judgment.run.output.readFile),
        ),
        Then('every reported mutant matches its annotation and the run witnessed every status this journey owns')(
          (s, expect) =>
            Effect.map(
              compareAnnotatedRun({
                fixture: ENTERPRISE_FIXTURE,
                slice: LIFECYCLE_SLICE,
                report: s.report,
                verdict: s.verdict,
              }),
              (comparison) => {
                const statuses = statusesOf(s.report)
                return expect({
                  ...comparison.actual,
                  ignored: statuses.includes('Ignored'),
                  noCoverage: statuses.includes('NoCoverage'),
                  runtimeErrors: statuses.includes('RuntimeError'),
                }).toStrictEqual({
                  ...comparison.expected,
                  ignored: true,
                  noCoverage: true,
                  runtimeErrors: true,
                })
              },
            ),
        ),
      ),
    )
  })
