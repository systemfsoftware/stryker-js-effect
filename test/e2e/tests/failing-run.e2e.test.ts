import type { ExpectStatic } from 'vitest'
import type { ExecResult } from './__fixtures__/container-environment.js'
import { test } from './__fixtures__/container-harness.js'

const FAILING_DRY_RUN_RUNTIME_ERROR_CODE = 3

const FAILING_FIXTURE_URL = new URL('../testResources/failing-fixture', import.meta.url)

const RUN_EVENT_KINDS: ReadonlyArray<string> = [
  'stream',
  'phase',
  'plan',
  'mutant',
  'tick',
  'verdict',
  'error',
  'help',
]

const stdoutLines = (stdout: string): ReadonlyArray<string> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const parseEventLine = (line: string): unknown => {
  const value: unknown = JSON.parse(line)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object on stdout, received: ${line}`)
  }
  return value
}

const fieldOf = (event: unknown, field: string): unknown => {
  if (typeof event !== 'object' || event === null) {
    throw new Error(`no ${field} on a non-object event: ${JSON.stringify(event)}`)
  }
  return Reflect.get(event, field)
}

const eventKind = (event: unknown): string => {
  const kind = fieldOf(event, '_tag')
  if (typeof kind !== 'string') {
    throw new Error(`an event carries no string tag: ${JSON.stringify(event)}`)
  }
  return kind
}

const lastEvent = (events: ReadonlyArray<unknown>): unknown => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error('stdout carries no events')
  }
  return event
}

const kindsOutsideOf = (
  kinds: ReadonlyArray<string>,
  allowed: ReadonlyArray<string>,
): ReadonlyArray<string> => kinds.filter((kind) => !allowed.includes(kind))
const stepVerifyFailingDryRunExit = (expect: ExpectStatic, run: ExecResult): void => {
  expect(run.exitCode).toBe(FAILING_DRY_RUN_RUNTIME_ERROR_CODE)
}

const stepVerifyTypedErrorDocument = (
  expect: ExpectStatic,
  events: ReadonlyArray<unknown>,
): void => {
  const terminal = lastEvent(events)
  const kinds = events.map(eventKind)

  expect(eventKind(terminal)).toBe('error')
  expect(typeof fieldOf(terminal, 'schemaVersion')).toBe('string')
  expect(typeof fieldOf(terminal, 'code')).toBe('number')
  expect(typeof fieldOf(terminal, 'error')).toBe('string')
  expect(fieldOf(terminal, 'remediation')).toMatch(/\S/)
  expect(kinds).not.toContain('verdict')
}

const stepVerifyStreamCleanliness = (
  expect: ExpectStatic,
  events: ReadonlyArray<unknown>,
): void => {
  expect(events.length).toBeGreaterThan(0)
  expect(kindsOutsideOf(events.map(eventKind), RUN_EVENT_KINDS)).toEqual([])
}

test('failing a run at the process boundary', async ({ annotate, expect, prepareFixture }) => {
  await annotate('Step 1: Install fixture in container', 'lifecycle')
  const fixture = await prepareFixture(FAILING_FIXTURE_URL, 'failing-fixture')

  await annotate('Step 2: Execute CLI and parse machine stream', 'execution')
  const run = await fixture.run(['run'])
  const events = stdoutLines(run.stdout).map(parseEventLine)

  await annotate('Step 3: Verify failure exit code, error document, and stream cleanliness', 'assertions')
  stepVerifyFailingDryRunExit(expect, run)
  stepVerifyTypedErrorDocument(expect, events)
  stepVerifyStreamCleanliness(expect, events)
})
