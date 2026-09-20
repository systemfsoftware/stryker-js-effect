import type { ExpectStatic } from 'vitest'
import type { ExecResult } from './__fixtures__/container-environment.js'
import './__fixtures__/custom-matchers.js'
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
    .filter((line) => line.startsWith('{') && line.endsWith('}'))

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
  expect.soft(run.exitCode).toBe(0)
  expect.soft(rawEvents.length).toBeGreaterThan(0)
  expect.soft(run.stdout).not.toMatch(/Could not restrict "[^"]*worker\.sock"/)
  expect.soft(kinds).toEqual(
    expect.arrayContaining(['stream', 'phase', 'plan', 'mutant', 'verdict']),
  )
  expect.soft(kinds.at(-1)).toBe('verdict')
  expect.soft(kinds).not.toContain('error')
  expect.soft(terminalIndexesIn(kinds)).toEqual([kinds.length - 1])
  expect.soft(kindsOutsideOf(kinds, RUN_EVENT_KINDS)).toEqual([])
}

const stepVerdictCountsAndScore = (expect: ExpectStatic, verdict: unknown): void => {
  expect(verdict).toMatchVerdict({
    counts: {
      compileErrors: 4,
      killed: 2,
      survived: 1,
      pending: 0,
      runtimeErrors: 0,
      timeout: 0,
    },
    score: 66.67,
  })
}

const stepMutantStreamAndActionables = (
  expect: ExpectStatic,
  events: ReadonlyArray<unknown>,
  verdict: unknown,
): void => {
  const reportedMutants = events
    .filter((e) => eventKind(e) === 'mutant')
    .map((e) => `${String(fieldOf(e, 'mutator'))}:${String(fieldOf(e, 'status'))}`)

  expect.soft(reportedMutants).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^StringLiteral:CompileError$/),
      expect.stringMatching(/:Killed$/),
      expect.stringMatching(/:Survived$/),
    ]),
  )
  expect.soft(reportedMutants).toHaveLength(7)
  expect.soft(reportedMutants.filter((s) => s.endsWith(':CompileError'))).toHaveLength(4)
  expect.soft(reportedMutants.filter((s) => s.endsWith(':Killed'))).toHaveLength(2)
  expect.soft(reportedMutants.filter((s) => s.endsWith(':Survived'))).toHaveLength(1)

  const actionable = (fieldOf(verdict, 'mutants') as readonly unknown[]).map(
    (m) => `${String(fieldOf(m, 'mutator'))}:${String(fieldOf(m, 'status'))}`,
  )
  expect.soft(actionable).toEqual([expect.stringMatching(/:Survived$/)])

  const runIds = events
    .map((e) => fieldOf(e, 'runId'))
    .filter((id): id is string => typeof id === 'string')
  expect.soft(new Set(runIds).size).toBe(1)
  expect.soft(fieldOf(verdict, 'runId')).toBe(runIds[0])
}

const stepStructuredDiskReport = (expect: ExpectStatic, reportText: string): void => {
  const report = JSON.parse(reportText)
  expect(report).toMatchMutationReport({
    schemaVersion: '1.0',
    file: 'src/order.ts',
    mutants: [
      { status: 'CompileError' },
      { status: 'CompileError' },
      { status: 'CompileError' },
      { status: 'CompileError' },
      { status: 'Killed' },
      { status: 'Killed' },
      { status: 'Survived' },
    ],
  })
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
  expect.soft(run.exitCode).not.toBe(0)
  expect.soft(kinds.at(-1)).toBe('error')
  expect.soft(kinds).not.toContain('verdict')

  expect.soft(terminal).toEqual(
    expect.objectContaining({
      kind: 'error',
      error: expect.stringMatching(/non-existent-tsconfig\.json|Cannot read|failed/i),
    }),
  )
})

test('persists structured json report artifact on container disk and matches contract', async ({ annotate, expect, prepareFixture }) => {
  await annotate('Step 1: Install fixture and execute run with json reporter configured', 'execution')
  const fixture = await prepareFixture(FIXTURE_URL, 'typescript-checker-disk-fixture')
  const run = await fixture.run(['run', 'stryker.vm.config.ts'])
  expect(run.exitCode).toBe(0)

  await annotate('Step 2: Read and parse reports/mutation/mutation.json from container disk', 'assertions')
  const reportJsonText = await fixture.readFile('reports/mutation/mutation.json')
  stepStructuredDiskReport(expect, reportJsonText)
})

test('persists mutation-stream.jsonl on disk matching stdout events', async ({ annotate, expect, prepareFixture }) => {
  await annotate('Step 1: Install fixture and execute run', 'execution')
  const fixture = await prepareFixture(FIXTURE_URL, 'typescript-checker-stream-fixture')
  const run = await fixture.run(['run', 'stryker.vm.config.ts'])
  const stdoutEvents = stdoutLines(run.stdout).map(parseEventLine)

  await annotate('Step 2: Read reports/mutation-stream.jsonl from container disk', 'assertions')
  const streamFileContent = await fixture.readFile('reports/mutation-stream.jsonl')
  const diskEvents = stdoutLines(streamFileContent).map(parseEventLine)

  expect(diskEvents.length).toBe(stdoutEvents.length)
  expect(diskEvents.map(eventKind)).toEqual(stdoutEvents.map(eventKind))
})

test('exercises TypeScript composite project references in build mode', async ({ annotate, expect, prepareFixture }) => {
  await annotate('Step 1: Install fixture with tsconfig project references solution', 'lifecycle')
  const fixture = await prepareFixture(FIXTURE_URL, 'typescript-checker-references-fixture')

  await annotate('Step 2: Run Stryker CLI with build-mode project references config', 'execution')
  const run = await fixture.run(['run', 'stryker.references.config.ts'])
  const rawEvents = stdoutLines(run.stdout)
  const events = rawEvents.map(parseEventLine)
  const kinds = events.map(eventKind)
  const verdict = lastEvent(events)

  await annotate('Step 3: Verify build mode intercepted compile errors across project references', 'assertions')
  stepProcessAndStreamIntegrity(expect, run, rawEvents, kinds)
  stepVerdictCountsAndScore(expect, verdict)
  stepMutantStreamAndActionables(expect, events, verdict)
})
