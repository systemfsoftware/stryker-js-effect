import { type RunEvent, RunEventWireLine, type RunFailed, S } from '@systemfsoftware/stryker-js'
import type { ExpectStatic } from 'vitest'
import type { ExecResult } from './__fixtures__/microvm-environment.js'
import { type PreparedFixture, test } from './__fixtures__/microvm-harness.js'

const FAILING_DRY_RUN_RUNTIME_ERROR_CODE = 3
const FAILING_FIXTURE_URL = new URL('../testResources/failing-fixture', import.meta.url)

const parseEventStream = (stdout: string): ReadonlyArray<RunEvent> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => S.decodeUnknownSync(RunEventWireLine)(line))
const lastEvent = (events: ReadonlyArray<RunEvent>): RunEvent => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error('stdout carries no events')
  }
  return event
}

const stepVerifyFailingDryRunExit = (expect: ExpectStatic, run: ExecResult): void => {
  expect.soft(run.exitCode).toBe(FAILING_DRY_RUN_RUNTIME_ERROR_CODE)
}

const stepVerifyTypedErrorDocument = (
  expect: ExpectStatic,
  events: ReadonlyArray<RunEvent>,
): void => {
  const terminal = lastEvent(events)
  const tags = events.map((event) => event._tag)

  expect.soft(terminal._tag).toBe('error')
  if (terminal._tag === 'error') {
    const errorDoc: RunFailed = terminal
    expect.soft(errorDoc.schemaVersion).toBe('1.0')
    expect.soft(errorDoc.code).toBe(FAILING_DRY_RUN_RUNTIME_ERROR_CODE)
    expect.soft(typeof errorDoc.error).toBe('string')
    expect.soft(errorDoc.remediation).toMatch(/\S/)
  }
  expect.soft(tags).not.toContain('verdict')
}

const stepVerifyStreamCleanliness = (
  expect: ExpectStatic,
  events: ReadonlyArray<RunEvent>,
): void => {
  expect.soft(events.length).toBeGreaterThan(0)
  expect.soft(events.every((e) => typeof e._tag === 'string')).toBe(true)
}

test('failing a run at the process boundary', async ({ bdd, expect, prepareFixture }) => {
  let fixture: PreparedFixture
  let run: ExecResult
  let events: ReadonlyArray<RunEvent>

  await bdd.given('a fixture configured to fail during dry run', async () => {
    fixture = await prepareFixture(FAILING_FIXTURE_URL, 'failing-fixture')
  })

  await bdd.when('the CLI is executed in machine mode', async () => {
    run = await fixture.run(['run'])
    events = parseEventStream(run.stdout)
  })

  await bdd.thenAssert('the process exits with runtime error code and emits a structured error document', () => {
    stepVerifyFailingDryRunExit(expect, run)
    stepVerifyTypedErrorDocument(expect, events)
    stepVerifyStreamCleanliness(expect, events)
  })
})
