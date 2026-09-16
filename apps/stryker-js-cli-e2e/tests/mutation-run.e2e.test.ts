import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type ExecResult, installFixture, runCli, teardownBed } from './__fixtures__/bed.js'

const CALC_FIXTURE_ORACLE = {
  killed: 7,
  survived: 2,
  total: 9,
  mutantStatusTally: {
    'ArithmeticOperator:Killed': 1,
    'ArithmeticOperator:Survived': 1,
    'BlockStatement:Killed': 2,
    'BlockStatement:Survived': 1,
    'ConditionalExpression:Killed': 2,
    'EqualityOperator:Killed': 2,
  },
  actionableStatusTally: {
    'ArithmeticOperator:Survived': 1,
    'BlockStatement:Survived': 1,
  },
} as const

const CALC_FIXTURE_URL = new URL('../testResources/calc-fixture', import.meta.url)

const TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['verdict', 'error', 'help']

const NON_TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['stream', 'phase', 'plan', 'mutant', 'tick']

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[`)

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

const mutantsOf = (event: unknown): ReadonlyArray<unknown> => {
  const value = fieldOf(event, 'mutants')
  if (!Array.isArray(value)) {
    throw new Error(`the verdict carries no mutants array: ${JSON.stringify(event)}`)
  }
  return value
}

const statusKey = (mutant: unknown): string =>
  `${String(fieldOf(mutant, 'mutator'))}:${String(fieldOf(mutant, 'status'))}`

const tallyOf = (
  keys: ReadonlyArray<string>,
  statuses: ReadonlyArray<string>,
): Readonly<Record<string, number>> =>
  keys.reduce<Record<string, number>>(
    (tally, key) => ({ ...tally, [key]: statuses.filter((status) => status === key).length }),
    {},
  )

const terminalIndexesIn = (kinds: ReadonlyArray<string>): ReadonlyArray<number> =>
  kinds
    .map((kind, index) => ({ index, kind }))
    .filter((entry) => TERMINAL_RUN_KINDS.includes(entry.kind))
    .map((entry) => entry.index)

const kindsOutsideOf = (
  kinds: ReadonlyArray<string>,
  allowed: ReadonlyArray<string>,
): ReadonlyArray<string> => kinds.filter((kind) => !allowed.includes(kind))

describe('running one mutation run through the packed runner', () => {
  let run: ExecResult = EMPTY_EXEC
  let events: ReadonlyArray<unknown> = []

  beforeAll(async () => {
    const fixturePath = await installFixture(CALC_FIXTURE_URL, 'calc-fixture')
    run = await runCli(['run'], { cwd: fixturePath })
    events = stdoutLines(run.stdout).map(parseEventLine)
  })

  afterAll(teardownBed)

  it('exits 0 and closes the stream on exactly one terminal event, the verdict', () => {
    const kinds = events.map(eventKind)

    expect(run.exitCode).toBe(0)
    expect(terminalIndexesIn(kinds)).toEqual([kinds.length - 1])
    expect(kinds.at(-1)).toBe('verdict')
  })

  it('counts the mutants the oracle derives, against the default thresholds', () => {
    const verdict = lastEvent(events)
    const counts = fieldOf(verdict, 'counts')

    expect(fieldOf(fieldOf(verdict, 'thresholds'), 'break')).toBeNull()
    expect({
      compileErrors: numberFieldOf(counts, 'compileErrors'),
      ignored: numberFieldOf(counts, 'ignored'),
      killed: numberFieldOf(counts, 'killed'),
      noCoverage: numberFieldOf(counts, 'noCoverage'),
      pending: numberFieldOf(counts, 'pending'),
      runtimeErrors: numberFieldOf(counts, 'runtimeErrors'),
      survived: numberFieldOf(counts, 'survived'),
      timeout: numberFieldOf(counts, 'timeout'),
    }).toEqual({
      compileErrors: 0,
      ignored: 0,
      killed: CALC_FIXTURE_ORACLE.killed,
      noCoverage: 0,
      pending: 0,
      runtimeErrors: 0,
      survived: CALC_FIXTURE_ORACLE.survived,
      timeout: 0,
    })
  })

  it('reports the whole oracle through its mutant events, and only the actionable part in the verdict', () => {
    const reported = events
      .filter((event) => eventKind(event) === 'mutant')
      .map(statusKey)
    const actionable = mutantsOf(lastEvent(events)).map(statusKey)

    expect(reported).toHaveLength(CALC_FIXTURE_ORACLE.total)
    expect(tallyOf(Object.keys(CALC_FIXTURE_ORACLE.mutantStatusTally), reported)).toEqual(
      CALC_FIXTURE_ORACLE.mutantStatusTally,
    )
    expect(tallyOf(Object.keys(CALC_FIXTURE_ORACLE.actionableStatusTally), actionable)).toEqual(
      CALC_FIXTURE_ORACLE.actionableStatusTally,
    )
  })

  it('carries one runId across the events that have one', () => {
    const runIds = events
      .map((event) => fieldOf(event, 'runId'))
      .filter((runId): runId is string => typeof runId === 'string')

    expect(runIds.length).toBeGreaterThanOrEqual(2)
    expect(new Set(runIds).size).toBe(1)
    expect(fieldOf(lastEvent(events), 'runId')).toBe(runIds.at(0))
  })

  it('writes the stream as plain JSON, with a live non-terminal prefix', () => {
    const kinds = events.map(eventKind)
    const preceding = kinds.slice(0, -1)

    expect(run.stdout).not.toMatch(ANSI_ESCAPE)
    expect(preceding.length).toBeGreaterThan(0)
    expect(kindsOutsideOf(preceding, NON_TERMINAL_RUN_KINDS)).toEqual([])
  })
})
