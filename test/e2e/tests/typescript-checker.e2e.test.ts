import { afterAll, beforeAll, describe, it } from 'vitest'

import { installFixture, runCli, teardownBed } from './__fixtures__/bed.js'

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

const TYPESCRIPT_CHECKER_ARMS = [
  {
    name: 'in-memory vm runner',
    config: 'stryker.vm.config.ts',
    fixture: 'typescript-checker-vm-fixture',
  },
  {
    name: 'vitest runner',
    config: 'stryker.vitest.config.ts',
    fixture: 'typescript-checker-vitest-fixture',
  },
] as const

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
    throw new Error(`expected number ${field}, received: ${JSON.stringify(value)}`)
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

describe('typescript-checker through packed runners', () => {
  const fixtures: Record<string, string> = {}

  beforeAll(async () => {
    for (const arm of TYPESCRIPT_CHECKER_ARMS) {
      fixtures[arm.name] = await installFixture(FIXTURE_URL, arm.fixture)
    }
  })

  afterAll(teardownBed)

  it.concurrent.for(TYPESCRIPT_CHECKER_ARMS)(
    '$name exits on a verdict with compile errors and killed mutants',
    async (arm, { expect }) => {
      const cwd = fixtures[arm.name]
      if (cwd === undefined) {
        throw new Error(`no installed fixture for ${arm.name}`)
      }

      const run = await runCli(['run', arm.config], { cwd })
      const rawEvents = stdoutLines(run.stdout)
      expect(run.exitCode).toBe(0)
      expect(rawEvents.length).toBeGreaterThan(0)
      expect(run.stdout).not.toMatch(/Could not restrict "[^"]*worker\.sock"/)

      const events = rawEvents.map(parseEventLine)
      const kinds = events.map(eventKind)
      expect(kinds.at(-1)).toBe('verdict')
      expect(kinds).not.toContain('error')
      expect(terminalIndexesIn(kinds)).toEqual([kinds.length - 1])
      expect(kindsOutsideOf(kinds, RUN_EVENT_KINDS)).toEqual([])

      const verdict = lastEvent(events)
      const counts = fieldOf(verdict, 'counts')
      const compileErrors = numberFieldOf(counts, 'compileErrors')
      const killed = numberFieldOf(counts, 'killed')
      const survived = numberFieldOf(counts, 'survived')
      const pending = numberFieldOf(counts, 'pending')
      const runtimeErrors = numberFieldOf(counts, 'runtimeErrors')
      const timeout = numberFieldOf(counts, 'timeout')

      expect(pending).toBe(0)
      expect(runtimeErrors).toBe(0)
      expect(timeout).toBe(0)
      expect({ compileErrors, killed, survived }).toEqual({ compileErrors: 4, killed: 2, survived: 1 })

      const reportedMutants = events
        .filter((e) => eventKind(e) === 'mutant')
        .map((e) => `${String(fieldOf(e, 'mutator'))}:${String(fieldOf(e, 'status'))}`)
      expect(reportedMutants).toHaveLength(7)

      const compileErrorsReported = reportedMutants.filter((s) => s.endsWith(':CompileError'))
      expect(compileErrorsReported).toHaveLength(4)
      expect(compileErrorsReported).toContain('StringLiteral:CompileError')
      expect(reportedMutants.filter((s) => s.endsWith(':Killed'))).toHaveLength(2)
      expect(reportedMutants.filter((s) => s.endsWith(':Survived'))).toHaveLength(1)

      const actionable = (fieldOf(verdict, 'mutants') as readonly unknown[]).map(
        (m) => `${String(fieldOf(m, 'mutator'))}:${String(fieldOf(m, 'status'))}`,
      )
      expect(actionable).toHaveLength(1)
      expect(actionable[0]).toMatch(/:Survived$/)

      const score = numberFieldOf(verdict, 'score')
      expect(score).toBeCloseTo(66.67, 2)

      const runIds = events
        .map((e) => fieldOf(e, 'runId'))
        .filter((id): id is string => typeof id === 'string')
      expect(new Set(runIds).size).toBe(1)
      expect(fieldOf(verdict, 'runId')).toBe(runIds[0])
    },
  )
})
