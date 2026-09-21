import { readFileSync } from 'node:fs'

import { type RunEvent, RunEventWireLine, S, type VerdictReached } from '@systemfsoftware/stryker-js'
import { type BlessedBaseline, decodeBaseline } from '../scripts/oracle/baseline.js'
import type { ExecResult } from './__fixtures__/container-environment.js'
import { type PreparedFixture, test } from './__fixtures__/container-harness.js'

function loadCheckerBaseline(): BlessedBaseline {
  const url = new URL('../oracle-baselines/checker.json', import.meta.url)
  try {
    return decodeBaseline(readFileSync(url, 'utf8'))
  } catch (cause) {
    throw new Error(
      `Failed to load blessed baseline for slice "checker" at ${url.pathname}: ${(cause as Error).message}`,
      { cause },
    )
  }
}

const CHECKER_BASELINE: BlessedBaseline = loadCheckerBaseline()
const CHECKER_COUNTS = CHECKER_BASELINE.counts
const CHECKER_TOTAL = CHECKER_COUNTS.compileErrors +
  CHECKER_COUNTS.ignored +
  CHECKER_COUNTS.killed +
  CHECKER_COUNTS.noCoverage +
  CHECKER_COUNTS.pending +
  CHECKER_COUNTS.runtimeErrors +
  CHECKER_COUNTS.survived +
  CHECKER_COUNTS.timeout
const CHECKER_MUTATOR_TALLY = CHECKER_BASELINE.mutatorStatusTally

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
  'enterprise journey: TypeScript composite checker project references and cross-package compile errors',
  { timeout: 900_000 },
  async ({ bdd, expect, prepareFixture }) => {
    let fixture: PreparedFixture
    let run: ExecResult
    let events: ReadonlyArray<RunEvent>
    let verdict: VerdictReached | undefined

    await bdd.given('an enterprise fixture in an isolated composite checker container directory', async () => {
      fixture = await prepareFixture(ENTERPRISE_FIXTURE_URL, 'enterprise-checker-fixture')
    })

    await bdd.when('the CLI executes with composite checker configuration', async () => {
      run = await fixture.run(['run', 'stryker.checker.config.ts'])
      events = parseEventStream(run.stdout)
      const terminal = lastEvent(events)
      if (terminal !== undefined && terminal._tag === 'verdict') {
        verdict = terminal
      }
    })

    await bdd.thenAssert('the composite checker identifies downstream compilation errors matching oracle', () => {
      expect.soft(run.exitCode).toBe(0)
      expect.soft(verdict).toBeDefined()
      if (verdict === undefined) return

      expect.soft(verdict.thresholds.break).toBeNull()
      expect.soft(verdict.counts).toEqual(CHECKER_COUNTS)

      const contractCompileErrors = events.filter(
        (e): e is Extract<RunEvent, { _tag: 'mutant' }> =>
          e._tag === 'mutant' && e.status === 'CompileError' && e.file.includes('contracts.ts'),
      )
      expect.soft(contractCompileErrors.length).toBe(CHECKER_COUNTS.compileErrors)

      const reported = events
        .filter((event): event is Extract<RunEvent, { _tag: 'mutant' }> => event._tag === 'mutant')
        .map((m) => `${m.mutator}:${m.status}`)

      expect.soft(reported).toHaveLength(CHECKER_TOTAL)
      const reportedTally = tallyOf(Object.keys(CHECKER_MUTATOR_TALLY), reported)
      expect.soft(reportedTally).toEqual(CHECKER_MUTATOR_TALLY)
    })
  },
)
