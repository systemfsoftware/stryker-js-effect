import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Check, Expect } from '@systemfsoftware/vitest'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { verifyAnnotatedRun } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, terminalEvent, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import { readCheckpointOf, readReportOf } from './__fixtures__/run-artifacts.fixture.js'

const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)
const RESILIENCE_SLICE = 'stryker.resilience.config.ts'
const CHECKPOINT_FILE = 'reports/stryker-incremental.json'
const TRAP_FILE = 'packages/services/src/nontermination.ts'
const INTERRUPT_AFTER_MUTANT_EVENTS = 1
const PENDING = 'Pending'
const TIMEOUT = 'Timeout'
const INTERRUPTED_EXIT_CODE = 130

type MutantEvent = Extract<RunEvent.RunEvent, { readonly _tag: 'mutantTested' }>

const isMutantEvent = (event: RunEvent.RunEvent): event is MutantEvent => event._tag === 'mutantTested'

const mutantEventsOf = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<MutantEvent> =>
  events.filter(isMutantEvent)

const sortedIds = (ids: ReadonlyArray<string>): ReadonlyArray<string> => [...ids].sort()

const checkpointRowsOf = (checkpoint: Report.MutationTestResult) =>
  Object.values(checkpoint.files).flatMap((file) => file.mutants)

const verifyResilienceRun = (expect: Expect, run: ExecResult, events: ReadonlyArray<RunEvent.RunEvent>): Check => {
  const timedOut = mutantEventsOf(events).filter((event) => event.status === TIMEOUT)

  return expect({
    exitCode: run.exitCode,
    terminalKind: events.at(-1)?._tag,
    timedOutIsNonEmpty: timedOut.length > 0,
    everyTimeoutIsATrap: timedOut.every((event) => event.fileName === TRAP_FILE),
  }).toStrictEqual({
    exitCode: 0,
    terminalKind: 'verdict',
    timedOutIsNonEmpty: true,
    everyTimeoutIsATrap: true,
  })
}

const verifyInterruptEnvelope = (
  expect: Expect,
  run: ExecResult,
  interrupted: boolean,
  terminal: RunEvent.RunEvent,
): Check =>
  expect({
    exitCode: run.exitCode,
    interrupted,
    terminalKind: terminal._tag,
  }).toStrictEqual({
    exitCode: INTERRUPTED_EXIT_CODE,
    interrupted: true,
    terminalKind: 'error',
  })

const verifyInterruptedCheckpoint = (
  expect: Expect,
  events: ReadonlyArray<RunEvent.RunEvent>,
  checkpoint: Report.MutationTestResult,
): Check => {
  const rows = checkpointRowsOf(checkpoint)
  const plannedIds: ReadonlyArray<string> = rows.map((row) => String(row.id))
  const pendingIds: ReadonlyArray<string> = rows
    .filter((row) => row.status === PENDING)
    .map((row) => String(row.id))
  const settledIds: ReadonlyArray<string> = mutantEventsOf(events).map((event) => String(event.id))

  return expect({
    settledIsNonEmpty: settledIds.length > 0,
    pendingIsNonEmpty: pendingIds.length > 0,
    settledWithinPlanned: settledIds.every((id) => plannedIds.includes(id)),
    settledRowsWereAnnounced: checkpointRowsOf(checkpoint)
      .filter((row) => row.status !== PENDING)
      .every((row) => settledIds.includes(String(row.id))),
    pending: sortedIds(pendingIds),
  }).toStrictEqual({
    settledIsNonEmpty: true,
    pendingIsNonEmpty: true,
    settledWithinPlanned: true,
    settledRowsWereAnnounced: true,
    pending: sortedIds(plannedIds.filter((id) => !settledIds.includes(id))),
  })
}

const Feature = makeFeature({ it })

Feature('Surviving worker timeouts and concurrency in an enterprise fixture', { timeout: 900_000 })
  .withLayer(E2eHarnessLive)
  .live(
    'boots a warm microVM for the enterprise fixture and runs the packed CLI, exporting host and worker spans to the Grafana LGTM collector',
  )
  .body(({ scenario }) => {
    scenario(
      'A run with resilience and timeout configuration reports the trap timeout',
      Gherkin.Do.pipe(
        When('the CLI executes with resilience and timeout configuration')(
          'run',
          () =>
            runStryker({
              fixture: ENTERPRISE_FIXTURE_URL,
              label: 'enterprise-resilience-fixture',
              args: ['run', RESILIENCE_SLICE],
            }),
        ),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        Then('the run exits cleanly and every reported timeout belongs to the configured trap file')((s, expect) =>
          verifyResilienceRun(expect, s.run.output.result, s.events)
        ),
        When('the terminal verdict of the decoded stream is read')(
          'verdict',
          (s) => verdictEvent(s.events),
        ),
        When('the report the verdict names is read and decoded')(
          'report',
          (s) => readReportOf(s.verdict, s.run.output.readFile),
        ),
        Then('every reported mutant matches its authored annotation and the verdict tallies agree')((s, expect) =>
          verifyAnnotatedRun(expect, {
            fixture: 'enterprise-monorepo-fixture',
            slice: RESILIENCE_SLICE,
            report: s.report,
            verdict: s.verdict,
          })
        ),
      ),
    )

    scenario(
      'An interrupted run leaves the unsettled planned mutants Pending in its checkpoint',
      Gherkin.Do.pipe(
        When('the CLI runs the resilience slice in incremental mode until a mutant settles')(
          'run',
          () =>
            runStryker({
              fixture: ENTERPRISE_FIXTURE_URL,
              label: 'enterprise-resilience-interrupted',
              args: ['run', RESILIENCE_SLICE, '--incremental'],
              interrupt: {
                afterMutantEvents: INTERRUPT_AFTER_MUTANT_EVENTS,
                checkpointFile: CHECKPOINT_FILE,
              },
            }),
        ),
        When('the stdout event stream decodes to run events')(
          'events',
          (s) => decodeStream(s.run.output.result.stdout),
        ),
        When('the terminal event of the interrupted run is read')('terminal', (s) => terminalEvent(s.events)),
        Then('the interrupt ends the run before it reaches a verdict')((s, expect) =>
          verifyInterruptEnvelope(expect, s.run.output.result, s.run.output.interrupted, s.terminal)
        ),
        When('the run checkpoint of the interrupted run is read and decoded')(
          'checkpoint',
          (s) => readCheckpointOf(s.run.output.readFile, CHECKPOINT_FILE),
        ),
        Then('the checkpoint holds Pending rows for exactly the mutants the stream left unsettled')(
          (s, expect) => verifyInterruptedCheckpoint(expect, s.events, s.checkpoint),
        ),
      ),
    )
  })
