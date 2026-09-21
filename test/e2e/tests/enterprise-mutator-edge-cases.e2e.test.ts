import { readFileSync } from 'node:fs'

import { type RunEvent, RunEventWireLine, S, type VerdictReached } from '@systemfsoftware/stryker-js'
import { type BlessedBaseline, decodeBaseline } from '../scripts/oracle/baseline.js'
import type { ExecResult } from './__fixtures__/container-environment.js'
import { type PreparedFixture, test } from './__fixtures__/container-harness.js'

function loadEdgeBaseline(): BlessedBaseline {
  const url = new URL('../oracle-baselines/edge.json', import.meta.url)
  try {
    return decodeBaseline(readFileSync(url, 'utf8'))
  } catch (cause) {
    throw new Error(
      `Failed to load blessed baseline for slice "edge" at ${url.pathname}: ${(cause as Error).message}`,
      { cause },
    )
  }
}

const EDGE_BASELINE: BlessedBaseline = loadEdgeBaseline()
const EDGE_COUNTS = EDGE_BASELINE.counts
const EDGE_TOTAL = EDGE_COUNTS.compileErrors +
  EDGE_COUNTS.ignored +
  EDGE_COUNTS.killed +
  EDGE_COUNTS.noCoverage +
  EDGE_COUNTS.pending +
  EDGE_COUNTS.runtimeErrors +
  EDGE_COUNTS.survived +
  EDGE_COUNTS.timeout
const EDGE_MUTATOR_TALLY = EDGE_BASELINE.mutatorStatusTally

const ENTERPRISE_FIXTURE_URL = new URL('../testResources/enterprise-monorepo-fixture', import.meta.url)

const parseEventStream = (stdout: string): ReadonlyArray<RunEvent> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => S.decodeUnknownSync(RunEventWireLine)(line))

const lastEvent = (events: ReadonlyArray<RunEvent>): RunEvent | undefined => events.at(-1)

const tallyOf = (
  keys: ReadonlyArray<string>,
  statuses: ReadonlyArray<string>,
): Readonly<Record<string, number>> =>
  keys.reduce<Record<string, number>>(
    (tally, key) => ({ ...tally, [key]: statuses.filter((status) => status === key).length }),
    {},
  )

test(
  'enterprise journey: mutator exclusion filters and ignored mutants',
  { timeout: 900_000 },
  async ({ bdd, expect, prepareFixture }) => {
    let fixture: PreparedFixture
    let run: ExecResult
    let events: ReadonlyArray<RunEvent>
    let verdict: VerdictReached | undefined

    await bdd.given('an enterprise fixture in an isolated edge cases container directory', async () => {
      fixture = await prepareFixture(ENTERPRISE_FIXTURE_URL, 'enterprise-edge-fixture')
    })

    await bdd.when('the CLI executes with excluded mutator configuration', async () => {
      run = await fixture.run(['run', 'stryker.edge.config.ts'])
      events = parseEventStream(run.stdout)
      const terminal = lastEvent(events)
      if (terminal !== undefined && terminal._tag === 'verdict') {
        verdict = terminal
      }
    })

    await bdd.thenAssert('the verdict matches the authored mathematical oracle exactly', () => {
      expect.soft(run.exitCode).toBe(0)
      expect.soft(verdict).toBeDefined()
      if (verdict === undefined) return

      expect.soft(verdict.thresholds.break).toBeNull()
      expect.soft(verdict.counts).toEqual(EDGE_COUNTS)

      const reported = events
        .filter((event): event is Extract<RunEvent, { _tag: 'mutant' }> => event._tag === 'mutant')
        .map((m) => `${m.mutator}:${m.status}`)

      expect.soft(reported).toHaveLength(EDGE_TOTAL)
      const reportedTally = tallyOf(Object.keys(EDGE_MUTATOR_TALLY), reported)
      expect.soft(reportedTally).toEqual(EDGE_MUTATOR_TALLY)
    })
  },
)
