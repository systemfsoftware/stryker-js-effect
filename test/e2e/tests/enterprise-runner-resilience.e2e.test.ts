import { type RunEvent, RunEventWireLine, S, type VerdictReached } from '@systemfsoftware/stryker-js'
import type { ExecResult } from './__fixtures__/container-environment.js'
import { type PreparedFixture, test } from './__fixtures__/container-harness.js'

const RESILIENCE_ORACLE = {
  counts: {
    compileErrors: 14,
    ignored: 0,
    killed: 12,
    noCoverage: 0,
    pending: 0,
    runtimeErrors: 0,
    survived: 10,
    timeout: 18,
  },
  killed: 12,
  survived: 10,
  timeout: 18,
  compileErrors: 14,
  total: 54,
} as const

const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)

const parseEventStream = (stdout: string): ReadonlyArray<RunEvent> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => S.decodeUnknownSync(RunEventWireLine)(line))

const lastEvent = (events: ReadonlyArray<RunEvent>): RunEvent | undefined => events.at(-1)

test(
  'enterprise journey: runner resilience, worker process timeouts, and concurrency',
  { timeout: 900_000 },
  async ({ bdd, expect, prepareFixture }) => {
    let fixture: PreparedFixture
    let run: ExecResult
    let events: ReadonlyArray<RunEvent>
    let verdict: VerdictReached | undefined

    await bdd.given('an enterprise fixture in an isolated runner resilience container directory', async () => {
      fixture = await prepareFixture(ENTERPRISE_FIXTURE_URL, 'enterprise-resilience-fixture')
    })

    await bdd.when('the CLI executes with resilience and timeout configuration', async () => {
      run = await fixture.run(['run', 'stryker.resilience.config.ts'])
      events = parseEventStream(run.stdout)
      const terminal = lastEvent(events)
      if (terminal !== undefined && terminal._tag === 'verdict') {
        verdict = terminal
      }
    })

    await bdd.thenAssert('the test runner executes and matches the resilience mathematical oracle', () => {
      expect.soft(run.exitCode).toBe(0)
      expect.soft(verdict).toBeDefined()
      if (verdict === undefined) return

      expect.soft(verdict.thresholds.break).toBeNull()
      expect.soft(verdict.counts).toEqual(RESILIENCE_ORACLE.counts)

      const reportedMutants = events.filter(
        (event): event is Extract<RunEvent, { _tag: 'mutant' }> => event._tag === 'mutant',
      )
      expect.soft(reportedMutants).toHaveLength(RESILIENCE_ORACLE.total)

      const timeouts = reportedMutants.filter((m) => m.status === 'Timeout')
      expect.soft(timeouts).toHaveLength(RESILIENCE_ORACLE.timeout)

      const survivors = reportedMutants.filter((m) => m.status === 'Survived')
      expect.soft(survivors).toHaveLength(RESILIENCE_ORACLE.survived)
    })
  },
)
