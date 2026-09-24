import { RunEvent } from '@systemfsoftware/stryker-js'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'
import type { ExpectStatic } from 'vitest'
import type { ExecResult } from '../src/Harness/guest-job.schema.js'
import './__fixtures__/custom-matchers.js'
import { type PreparedFixture, test } from './__fixtures__/microvm-harness.js'

const FIXTURE_URL = new URL('../testResources/typescript-checker-fixture', import.meta.url)
const TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['verdict', 'error', 'help']
const RUN_EVENT_KINDS: ReadonlyArray<string> = [
  'stream',
  'phase',
  'plan',
  'mutant',
  'plugins',
  'formats',
  'skipped',
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
  events: ReadonlyArray<RunEvent.RunEvent>,
): void => {
  const kinds = events.map((e) => e._tag)
  expect.soft(run.exitCode).toBe(0)
  expect.soft(events.length).toBeGreaterThan(0)
  expect.soft(run.stdout).not.toMatch(/Could not restrict "[^"]*worker\.sock"/)
  expect.soft(kinds).toEqual(
    expect.arrayContaining(['stream', 'phase', 'plan', 'mutant', 'verdict']),
  )
  expect.soft(kinds.at(-1)).toBe('verdict')
  expect.soft(kinds).not.toContain('error')
  expect.soft(terminalIndexesIn(kinds)).toEqual([kinds.length - 1])
  expect.soft(kindsOutsideOf(kinds, RUN_EVENT_KINDS)).toEqual([])
}

const stepVerdictCountsAndScore = (expect: ExpectStatic, verdict: RunEvent.VerdictReached): void => {
  expect(verdict.counts.compileErrors).toBe(4)
  expect(verdict.counts.pending).toBe(0)
  expect(verdict.counts.runtimeErrors).toBe(0)
}

const stepMutantStreamAndActionables = (
  expect: ExpectStatic,
  events: ReadonlyArray<RunEvent.RunEvent>,
  verdict: RunEvent.VerdictReached,
): void => {
  const reportedMutants = events
    .filter((e): e is Extract<RunEvent.RunEvent, { _tag: 'mutant' }> => e._tag === 'mutant')
    .map((e) => `${e.mutator}:${e.status}`)

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

  const actionable = verdict.mutants.map(
    (m) => `${m.mutator}:${m.status}`,
  )
  expect.soft(actionable).toEqual([expect.stringMatching(/:Survived$/)])

  const runIds = events
    .map((e) => ('runId' in e && typeof e.runId === 'string' ? e.runId : undefined))
    .filter((id): id is string => id !== undefined)
  expect.soft(new Set(runIds).size).toBe(1)
  expect.soft(verdict.runId).toBe(runIds[0])
}
const stepStructuredDiskReport = (expect: ExpectStatic, reportText: string): void => {
  const report = S.decodeUnknownSync(S.fromJsonString(Report.MutationTestResultSchema))(reportText)
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
  async (arm, { bdd, expect, prepareFixture }) => {
    let fixture: PreparedFixture
    let run: ExecResult
    let events: ReadonlyArray<RunEvent.RunEvent>
    let verdict: RunEvent.VerdictReached

    await bdd.given(`a ${arm.name} fixture installed in the container`, async () => {
      fixture = await prepareFixture(FIXTURE_URL, arm.fixture)
    })

    await bdd.when(`Stryker CLI runs with ${arm.config}`, async () => {
      run = await fixture.run(['run', arm.config])
      events = parseEventStream(run.stdout)
      const terminal = lastEvent(events)
      if (terminal._tag !== 'verdict') {
        throw new Error(`Expected verdict event, received: ${terminal._tag}`)
      }
      verdict = terminal
    })

    await bdd.thenAssert('the process protocol and verdict counts match the oracle', () => {
      stepProcessAndStreamIntegrity(expect, run, events)
      stepVerdictCountsAndScore(expect, verdict)
      stepMutantStreamAndActionables(expect, events, verdict)
    })
  },
)

test('failing checker emits structured StageError carrying the diagnostic cause, not an empty crash', async ({ bdd, expect, prepareFixture }) => {
  let fixture: PreparedFixture
  let run: ExecResult
  let events: ReadonlyArray<RunEvent.RunEvent>

  await bdd.given('a fixture configured with a non-existent tsconfig path', async () => {
    fixture = await prepareFixture(FIXTURE_URL, 'typescript-checker-broken-fixture')
  })

  await bdd.when('Stryker CLI runs expecting checker failure', async () => {
    run = await fixture.run(['run', 'stryker.broken-checker.config.ts'])
    events = parseEventStream(run.stdout)
  })

  await bdd.thenAssert('the run fails with structured error payload without crash', () => {
    const kinds = events.map((e) => e._tag)
    const terminal = lastEvent(events)

    expect.soft(run.exitCode).not.toBe(0)
    expect.soft(kinds.at(-1)).toBe('error')
    expect.soft(kinds).not.toContain('verdict')
    expect.soft(terminal._tag).toBe('error')
    if (terminal._tag === 'error') {
      expect.soft(terminal.error).toMatch(/non-existent-tsconfig\.json|Cannot read|failed/i)
    }
  })
})

test('persists structured json report artifact on container disk and matches contract', async ({ bdd, expect, prepareFixture }) => {
  let fixture: PreparedFixture
  let run: ExecResult
  let reportJsonText: string

  await bdd.given('a fixture configured with json reporter', async () => {
    fixture = await prepareFixture(FIXTURE_URL, 'typescript-checker-disk-fixture')
  })

  await bdd.when('the CLI completes the mutation run', async () => {
    run = await fixture.run(['run', 'stryker.vm.config.ts'])
    expect(run.exitCode).toBe(0)
    reportJsonText = await fixture.readFile('reports/mutation/mutation.json')
  })

  await bdd.thenAssert('the persisted reports/mutation/mutation.json conforms to the schema', () => {
    stepStructuredDiskReport(expect, reportJsonText)
  })
})

test('persists mutation-stream.jsonl on disk matching stdout events', async ({ bdd, expect, prepareFixture }) => {
  let fixture: PreparedFixture
  let run: ExecResult
  let stdoutEvents: ReadonlyArray<RunEvent.RunEvent>
  let diskEvents: ReadonlyArray<RunEvent.RunEvent>

  await bdd.given('a fixture configured for progress stream tracking', async () => {
    fixture = await prepareFixture(FIXTURE_URL, 'typescript-checker-stream-fixture')
  })

  await bdd.when('the CLI finishes executing the test run', async () => {
    run = await fixture.run(['run', 'stryker.vm.config.ts'])
    stdoutEvents = parseEventStream(run.stdout)
    const streamFileContent = await fixture.readFile('reports/mutation-stream.jsonl')
    diskEvents = parseEventStream(streamFileContent)
  })

  await bdd.thenAssert('the persisted stream on disk is byte-complete and tags match stdout', () => {
    expect(diskEvents.length).toBe(stdoutEvents.length)
    expect(diskEvents.map((e) => e._tag)).toEqual(stdoutEvents.map((e) => e._tag))
  })
})

test('exercises TypeScript composite project references in build mode', async ({ bdd, expect, prepareFixture }) => {
  let fixture: PreparedFixture
  let run: ExecResult
  let events: ReadonlyArray<RunEvent.RunEvent>
  let verdict: RunEvent.VerdictReached

  await bdd.given('a fixture with composite project references', async () => {
    fixture = await prepareFixture(FIXTURE_URL, 'typescript-checker-references-fixture')
  })

  await bdd.when('Stryker CLI runs with build-mode project references config', async () => {
    run = await fixture.run(['run', 'stryker.references.config.ts'])
    events = parseEventStream(run.stdout)
    const terminal = lastEvent(events)
    if (terminal._tag !== 'verdict') {
      throw new Error(`Expected verdict event, received: ${terminal._tag}`)
    }
    verdict = terminal
  })

  await bdd.thenAssert('build mode catches compile errors across project references', () => {
    stepProcessAndStreamIntegrity(expect, run, events)
    stepVerdictCountsAndScore(expect, verdict)
    stepMutantStreamAndActionables(expect, events, verdict)
  })
})
