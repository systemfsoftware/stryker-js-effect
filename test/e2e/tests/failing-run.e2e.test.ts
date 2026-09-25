import { RunEvent } from '@systemfsoftware/stryker-js'
import { it } from '@systemfsoftware/vitest'
import type { Check, Expect } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
import * as S from 'effect/Schema'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import { bddStep, prepareFixture } from './__fixtures__/microvm-harness.js'

const FAILING_DRY_RUN_RUNTIME_ERROR_CODE = 3
const FAILING_FIXTURE_URL = new URL('../testResources/failing-fixture', import.meta.url)

const parseEventStream = (stdout: string): ReadonlyArray<RunEvent.RunEvent> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => S.decodeUnknownSync(RunEvent.RunEventWireLine)(line))

const lastEvent = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.RunEvent => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error('stdout carries no events')
  }
  return event
}

const verifyFailingDryRunExit = (expect: Expect, run: ExecResult): Check =>
  expect(run.exitCode).toBe(FAILING_DRY_RUN_RUNTIME_ERROR_CODE)

const verifyTypedErrorDocument = (expect: Expect, events: ReadonlyArray<RunEvent.RunEvent>): Check => {
  const terminal = lastEvent(events)
  const errorDocument: RunEvent.RunFailed | undefined = terminal._tag === 'error' ? terminal : undefined
  const tags = events.map((event) => event._tag)

  return expect({
    terminalTag: terminal._tag,
    schemaVersion: errorDocument?.schemaVersion,
    code: errorDocument?.code,
    errorIsString: typeof errorDocument?.error === 'string',
    remediationHasContent: /\S/.test(errorDocument?.remediation ?? ''),
    carriesVerdict: tags.includes('verdict'),
  }).toStrictEqual({
    terminalTag: 'error',
    schemaVersion: '1.1',
    code: FAILING_DRY_RUN_RUNTIME_ERROR_CODE,
    errorIsString: true,
    remediationHasContent: true,
    carriesVerdict: false,
  })
}

const verifyStreamCleanliness = (expect: Expect, events: ReadonlyArray<RunEvent.RunEvent>): Check =>
  expect({
    hasEvents: events.length > 0,
    everyTagIsAString: events.every((event) => typeof event._tag === 'string'),
  }).toStrictEqual({ hasEvents: true, everyTagIsAString: true })

it.live('failing a run at the process boundary', function*({ expect }) {
  const fixture = yield* bddStep(
    'Given',
    'a fixture configured to fail during dry run',
    prepareFixture(FAILING_FIXTURE_URL, 'failing-fixture'),
  )
  const run = yield* bddStep(
    'When',
    'the CLI is executed in machine mode',
    Effect.promise(() => fixture.run(['run'])),
  )
  const events = parseEventStream(run.stdout)

  yield* bddStep('Then', 'the process exits with the failing dry run code', verifyFailingDryRunExit(expect, run))
  yield* bddStep(
    'And',
    'the run emits a structured error document and no verdict',
    verifyTypedErrorDocument(expect, events),
  )
  yield* bddStep('And', 'every machine event is a tagged record', verifyStreamCleanliness(expect, events))
})
