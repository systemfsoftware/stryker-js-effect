import { type RunEvent, RunEventWireLine, S } from '@systemfsoftware/stryker-js'
import type { ExecResult } from './__fixtures__/container-environment.js'
import { type PreparedFixture, test } from './__fixtures__/container-harness.js'

const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)

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

test(
  'sabotage verification: failing the break threshold on survived mutants causes non-zero process exit',
  { timeout: 900_000 },
  async ({ bdd, expect, prepareFixture }) => {
    let fixture: PreparedFixture
    let run: ExecResult
    let events: ReadonlyArray<RunEvent>

    await bdd.given('a packaged enterprise workspace in the container', async () => {
      fixture = await prepareFixture(ENTERPRISE_FIXTURE_URL, 'enterprise-monorepo-fixture')
    })

    await bdd.when('the CLI executes with an active break threshold on an imperfect suite', async () => {
      run = await fixture.run(['run', 'stryker.sabotage.config.ts'])
      events = parseEventStream(run.stdout)
    })

    await bdd.thenAssert('the CLI detects the surviving mutant, breaches the threshold, and exits non-zero', () => {
      const terminal = lastEvent(events)
      expect.soft(run.exitCode).toBe(1)
      expect.soft(terminal._tag).toBe('verdict')
      expect.soft(terminal._tag === 'verdict' ? terminal.counts.survived : -1).toBeGreaterThan(0)
      expect.soft(terminal._tag === 'verdict' ? terminal.thresholds.break : null).toBe(100)
    })
  },
)
