import type { ExpectStatic } from 'vitest'
import type { ExecResult } from './__fixtures__/container-environment.js'
import { test } from './__fixtures__/container-harness.js'

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
const stepProcessAndStreamIntegrity = (
  expect: ExpectStatic,
  run: ExecResult,
  rawEvents: ReadonlyArray<string>,
  kinds: ReadonlyArray<string>,
): void => {
  expect(run.exitCode).toBe(0)
  expect(rawEvents.length).toBeGreaterThan(0)
  expect(run.stdout).not.toMatch(/Could not restrict "[^"]*worker\.sock"/)
  expect(kinds.at(-1)).toBe('verdict')
  expect(kinds).not.toContain('error')
  expect(terminalIndexesIn(kinds)).toEqual([kinds.length - 1])
  expect(kindsOutsideOf(kinds, RUN_EVENT_KINDS)).toEqual([])
}

const stepVerdictCountsAndScore = (expect: ExpectStatic, verdict: unknown): void => {
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

  const score = numberFieldOf(verdict, 'score')
  expect(score).toBeCloseTo(66.67, 2)
}

const stepMutantStreamAndActionables = (
  expect: ExpectStatic,
  events: ReadonlyArray<unknown>,
  verdict: unknown,
): void => {
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
  const runIds = events
    .map((e) => fieldOf(e, 'runId'))
    .filter((id): id is string => typeof id === 'string')
  expect(new Set(runIds).size).toBe(1)
  expect(fieldOf(verdict, 'runId')).toBe(runIds[0])
}
test.concurrent.for(TYPESCRIPT_CHECKER_ARMS)(
  '$name exits on a verdict with compile errors and killed mutants',
  async (arm, { annotate, expect, prepareFixture }) => {
    await annotate(`Step 1: Install ${arm.name} fixture in container`, 'lifecycle')
    const fixture = await prepareFixture(FIXTURE_URL, arm.fixture)

    await annotate(`Step 2: Run Stryker CLI with ${arm.config}`, 'execution')
    const run = await fixture.run(['run', arm.config])
    const rawEvents = stdoutLines(run.stdout)
    const events = rawEvents.map(parseEventLine)
    const kinds = events.map(eventKind)
    const verdict = lastEvent(events)
    await annotate('Step 3: Verify protocol, verdict counts, and mutant reporting', 'assertions')
    stepProcessAndStreamIntegrity(expect, run, rawEvents, kinds)
    stepVerdictCountsAndScore(expect, verdict)
    stepMutantStreamAndActionables(expect, events, verdict)
  },
)

test('failing checker emits structured StageError carrying the diagnostic cause, not an empty crash', async ({ annotate, expect, prepareFixture }) => {
  await annotate('Step 1: Install fixture with broken tsconfig path', 'lifecycle')
  const fixture = await prepareFixture(FIXTURE_URL, 'typescript-checker-broken-fixture')

  await annotate('Step 2: Run Stryker CLI expecting checker failure', 'execution')
  const run = await fixture.run(['run', 'stryker.broken-checker.config.ts'])
  const rawEvents = stdoutLines(run.stdout)
  const events = rawEvents.map(parseEventLine)
  const kinds = events.map(eventKind)
  const terminal = lastEvent(events)

  await annotate('Step 3: Verify typed error document and cause attribution', 'assertions')
  expect(run.exitCode).not.toBe(0)
  expect(kinds.at(-1)).toBe('error')
  expect(kinds).not.toContain('verdict')

  expect(fieldOf(terminal, 'kind')).toBe('error')
  const errorMessage = String(fieldOf(terminal, 'error'))
  expect(errorMessage).toMatch(/non-existent-tsconfig\.json|Cannot read|failed/i)
  expect(errorMessage).not.toBe('')
})

test('persists mutation-stream.jsonl on disk matching stdout events', async ({ annotate, expect, prepareFixture }) => {
  await annotate('Step 1: Install fixture and execute run', 'execution')
  const fixture = await prepareFixture(FIXTURE_URL, 'typescript-checker-disk-fixture')
  const run = await fixture.run(['run', 'stryker.vm.config.ts'])
  const stdoutEvents = stdoutLines(run.stdout).map(parseEventLine)

  await annotate('Step 2: Read reports/mutation-stream.jsonl from container disk', 'assertions')
  const streamFileContent = await fixture.readFile('reports/mutation-stream.jsonl')
  const diskEvents = stdoutLines(streamFileContent).map(parseEventLine)

  expect(diskEvents.length).toBe(stdoutEvents.length)
  expect(diskEvents.map(eventKind)).toEqual(stdoutEvents.map(eventKind))
})
