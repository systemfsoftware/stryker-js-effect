import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type ExecResult, installFixture, runCli, teardownBed } from './__fixtures__/bed.js'

const FIXTURE_URL = new URL('../testResources/typescript-checker-fixture', import.meta.url)

const TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['verdict', 'error', 'help']
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

const numberFieldOf = (event: unknown, field: string): number => {
  const value = fieldOf(event, field)
  if (typeof value !== 'number') {
    throw new Error(`no numeric ${field} on: ${JSON.stringify(event)}`)
  }
  return value
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
    throw new Error('stdout carries no events')
  }
  return event
}

const terminalIndexesIn = (kinds: ReadonlyArray<string>): ReadonlyArray<number> =>
  kinds
    .map((kind, index) => ({ index, kind }))
    .filter((entry) => TERMINAL_RUN_KINDS.includes(entry.kind))
    .map((entry) => entry.index)

const kindsOutsideOf = (
  kinds: ReadonlyArray<string>,
  allowed: ReadonlyArray<string>,
): ReadonlyArray<string> => kinds.filter((kind) => !allowed.includes(kind))

describe('Arm 1: typescript-checker with in-memory vm runner', () => {
  let run: ExecResult = EMPTY_EXEC
  let events: ReadonlyArray<unknown> = []

  beforeAll(async () => {
    const fixturePath = await installFixture(FIXTURE_URL, 'typescript-checker-vm-fixture')
    run = await runCli(['run', 'stryker.vm.config.ts'], { cwd: fixturePath })
    events = stdoutLines(run.stdout).map(parseEventLine)
  })

  afterAll(teardownBed)

  it('exits cleanly with exactly one terminal verdict event', () => {
    const kinds = events.map(eventKind)

    expect(run.exitCode).toBe(0)
    expect(terminalIndexesIn(kinds)).toEqual([kinds.length - 1])
    expect(kinds.at(-1)).toBe('verdict')
    expect(kinds).not.toContain('error')
  })

  it('verifies type checking intercepted compile errors and test runner killed valid mutants', () => {
    const verdict = lastEvent(events)
    const counts = fieldOf(verdict, 'counts')
    const compileErrors = numberFieldOf(counts, 'compileErrors')
    const killed = numberFieldOf(counts, 'killed')
    const survived = numberFieldOf(counts, 'survived')
    const score = fieldOf(verdict, 'score')
    expect(compileErrors).toBeGreaterThanOrEqual(1)
    expect(killed).toBeGreaterThanOrEqual(1)
    expect(survived).toBeGreaterThanOrEqual(1)

    const expectedScore = (killed / (killed + survived)) * 100
    expect(score).toBeCloseTo(expectedScore, 2)
    expect(Number.isFinite(score)).toBe(true)
    expect(Number.isNaN(score)).toBe(false)
  })

  it('leaves no unstructured text on the machine stream', () => {
    expect(events.length).toBeGreaterThan(0)
    expect(kindsOutsideOf(events.map(eventKind), RUN_EVENT_KINDS)).toEqual([])
  })
})

describe('Arm 2: typescript-checker with vitest runner', () => {
  let run: ExecResult = EMPTY_EXEC
  let events: ReadonlyArray<unknown> = []

  beforeAll(async () => {
    const fixturePath = await installFixture(FIXTURE_URL, 'typescript-checker-vitest-fixture')
    run = await runCli(['run', 'stryker.vitest.config.ts'], { cwd: fixturePath })
    events = stdoutLines(run.stdout).map(parseEventLine)
  })

  afterAll(teardownBed)

  it('exits cleanly with exactly one terminal verdict event', () => {
    const kinds = events.map(eventKind)

    expect(run.exitCode).toBe(0)
    expect(terminalIndexesIn(kinds)).toEqual([kinds.length - 1])
    expect(kinds.at(-1)).toBe('verdict')
    expect(kinds).not.toContain('error')
  })

  it('verifies type checking intercepted compile errors and test runner killed valid mutants', () => {
    const verdict = lastEvent(events)
    const counts = fieldOf(verdict, 'counts')
    const score = numberFieldOf(verdict, 'score')

    const compileErrors = numberFieldOf(counts, 'compileErrors')
    const killed = numberFieldOf(counts, 'killed')
    const survived = numberFieldOf(counts, 'survived')
    expect(compileErrors).toBeGreaterThanOrEqual(1)
    expect(killed).toBeGreaterThanOrEqual(1)
    expect(survived).toBeGreaterThanOrEqual(1)

    const expectedScore = (killed / (killed + survived)) * 100
    expect(score).toBeCloseTo(expectedScore, 2)
    expect(Number.isFinite(score)).toBe(true)
    expect(Number.isNaN(score)).toBe(false)
  })

  it('leaves no unstructured text on the machine stream', () => {
    expect(events.length).toBeGreaterThan(0)
    expect(kindsOutsideOf(events.map(eventKind), RUN_EVENT_KINDS)).toEqual([])
  })
})
