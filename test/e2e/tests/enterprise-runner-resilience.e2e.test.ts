import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect, Schema as S } from 'effect'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { verifyAnnotatedRun } from './__fixtures__/annotation-oracle.fixture.js'
import { E2eHarnessLive, runStryker } from './__fixtures__/e2e-harness.fixture.js'
import { decodeStream, reuseEventOf, terminalEvent, verdictEvent } from './__fixtures__/machine-stream.fixture.js'
import { DEFAULT_VERDICT_DIRECTORY, readReportOf } from './__fixtures__/run-artifacts.fixture.js'

const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)
const RESILIENCE_SLICE = 'stryker.resilience.config.ts'
const TRAP_FILE = 'packages/services/src/nontermination.ts'
const INTERRUPT_AFTER_MUTANT_EVENTS = 1
const TIMEOUT = 'Timeout'
const INTERRUPTED_EXIT_CODE = 130

type MutantEvent = Extract<RunEvent.RunEvent, { readonly _tag: 'mutantTested' }>

const isMutantEvent = (event: RunEvent.RunEvent): event is MutantEvent => event._tag === 'mutantTested'

const mutantEventsOf = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<MutantEvent> =>
  events.filter(isMutantEvent)

const isRemembered = S.is(Mutant.RememberedStatusSchema)

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

const verifyInterruptedVerdictsReused = (
  expect: Expect,
  events: ReadonlyArray<RunEvent.RunEvent>,
  rerun: ExecResult,
  reuse: RunEvent.ReuseReported,
): Check => {
  const reusable = mutantEventsOf(events).filter((event) => isRemembered(event.status) && event.status !== TIMEOUT)
  return expect({
    rerunExitCode: rerun.exitCode,
    announcedIsNonEmpty: reusable.length > 0,
    unreadableEntries: reuse.refused.entryUnreadable,
    reusedEveryAnnouncedVerdict: reuse.reused >= reusable.length,
  }).toStrictEqual({
    rerunExitCode: 0,
    announcedIsNonEmpty: true,
    unreadableEntries: 0,
    reusedEveryAnnouncedVerdict: true,
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
      'An interrupted run leaves every verdict it announced readable, and the next run reuses them',
      Gherkin.Do.pipe(
        When('the CLI runs the resilience slice in incremental mode until a stored mutant settles')(
          'run',
          () =>
            runStryker({
              fixture: ENTERPRISE_FIXTURE_URL,
              label: 'enterprise-resilience-interrupted',
              args: ['run', RESILIENCE_SLICE, '--incremental'],
              interrupt: {
                afterMutantEvents: INTERRUPT_AFTER_MUTANT_EVENTS,
                storeDirectory: DEFAULT_VERDICT_DIRECTORY,
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
        When('the CLI runs the same slice incrementally again on the interrupted machine')(
          'rerun',
          (s) => s.run.output.runAgain(['run', RESILIENCE_SLICE, '--incremental']),
        ),
        When('the re-run reports its reuse counts on its own event stream')(
          'reuse',
          (s) => Effect.flatMap(decodeStream(s.rerun.stdout), reuseEventOf),
        ),
        Then('no stored entry is unreadable and the re-run reuses every verdict the interrupted run announced')(
          (s, expect) => verifyInterruptedVerdictsReused(expect, s.events, s.rerun, s.reuse),
        ),
      ),
    )
  })
