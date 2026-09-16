import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type ExecResult, installFixture, requireStep, runCli, runShell, teardownBed } from './__fixtures__/bed.js'

const FAILING_DRY_RUN_RUNTIME_ERROR_CODE = 3

const FAILING_FIXTURE_URL = new URL('../testResources/failing-fixture', import.meta.url)

const MACHINE_STREAM_FILE = 'reports/mutation-stream.jsonl'

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

const EMPTY_EXEC: ExecResult = { exitCode: 0, stdout: '', stderr: '' }

const stdoutLines = (stdout: string): ReadonlyArray<string> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const parseEventLine = (line: string): unknown => {
  const value: unknown = JSON.parse(line)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object in ${MACHINE_STREAM_FILE}, received: ${line}`)
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
  const kind = fieldOf(event, 'kind')
  if (typeof kind !== 'string') {
    throw new Error(`an event carries no string kind: ${JSON.stringify(event)}`)
  }
  return kind
}

const lastEvent = (events: ReadonlyArray<unknown>): unknown => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error(`${MACHINE_STREAM_FILE} carries no events`)
  }
  return event
}

const kindsOutsideOf = (
  kinds: ReadonlyArray<string>,
  allowed: ReadonlyArray<string>,
): ReadonlyArray<string> => kinds.filter((kind) => !allowed.includes(kind))

describe('failing a run at the process boundary', () => {
  let run: ExecResult = EMPTY_EXEC
  let stream: ExecResult = EMPTY_EXEC
  let events: ReadonlyArray<unknown> = []

  beforeAll(async () => {
    const fixturePath = await installFixture(FAILING_FIXTURE_URL, 'failing-fixture')
    run = await runCli(['run'], { cwd: fixturePath })
    stream = await requireStep(`read ${MACHINE_STREAM_FILE}`, async () => {
      const result = await runShell(`cat ${MACHINE_STREAM_FILE}`, { cwd: fixturePath })
      if (result.exitCode !== 0) {
        throw new Error(`the run wrote no ${MACHINE_STREAM_FILE}: ${result.stderr.trim()}`)
      }
      return result
    })
    events = stdoutLines(stream.stdout).map(parseEventLine)
  })

  afterAll(teardownBed)

  it('exits with the classed code for a failing dry run', () => {
    expect(run.exitCode).toBe(FAILING_DRY_RUN_RUNTIME_ERROR_CODE)
  })

  it('ends on the typed error document, and never on a verdict', () => {
    const terminal = lastEvent(events)
    const kinds = events.map(eventKind)

    expect(eventKind(terminal)).toBe('error')
    expect(typeof fieldOf(terminal, 'schemaVersion')).toBe('string')
    expect(typeof fieldOf(terminal, 'code')).toBe('number')
    expect(typeof fieldOf(terminal, 'error')).toBe('string')
    expect(fieldOf(terminal, 'remediation')).toMatch(/\S/)
    expect(kinds).not.toContain('verdict')
  })

  it('leaves no unstructured text on the machine stream', () => {
    expect(events.length).toBeGreaterThan(0)
    expect(kindsOutsideOf(events.map(eventKind), RUN_EVENT_KINDS)).toEqual([])
  })
})
