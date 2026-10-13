import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { type ProjectFiles, REPORT_FILE, runCli, writeProject } from './__fixtures__/cli-project.fixture.js'

const Feature = makeFeature({ it })

const DAEMON_FILE = 'src/lib/daemon.ts'
const DAEMON_SOURCE = [
  'export const settle = (immediate: boolean): Promise<string> => {',
  '  if (immediate) {',
  "    return Promise.resolve('settled')",
  '  }',
  '  return new Promise<string>(() => {})',
  '}',
  '',
  'export const double = (value: number): number => value * 2',
  '',
].join('\n')

const TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  "import { double, settle } from '../src/lib/daemon.ts'",
  '',
  "test('doubles a number', () => {",
  '  expect(double(3)).toBe(6)',
  '})',
  '',
  "test('settles immediately when asked', async () => {",
  "  await expect(settle(true)).resolves.toBe('settled')",
  '})',
].join('\n')

/**
 * The fixture's own test timeout must not fire before the mutant budget, or the
 * project would classify the hang as a failed test instead of a wall-clock clip.
 */
const VITEST_CONFIG_SOURCE = 'export default { test: { testTimeout: 600_000, hookTimeout: 600_000 } }\n'

const MUTANT_BUDGET_MS = 2_000

const PROJECT: ProjectFiles = [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['vitest.config.ts', VITEST_CONFIG_SOURCE],
  [
    'stryker.config.mjs',
    `export default {
  testRunner: 'vm',
  plugins: [],
  reporters: ['json'],
  jsonReporter: { fileName: '${REPORT_FILE}' },
  thresholds: { high: 60, low: 40, break: null },
  checkers: [],
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.ts'],
  coverageAnalysis: 'perTest',
  timeoutMS: ${MUTANT_BUDGET_MS},
  timeoutFactor: 0,
  cleanTempDir: 'always',
  incremental: true,
}
`,
  ],
  [DAEMON_FILE, DAEMON_SOURCE],
  ['test/sample.test.mjs', TEST_SOURCE],
]

interface MutantRow {
  readonly status: string
  readonly statusReason: string | undefined
}

const decodeWireLine = S.decodeOption(RunEvent.RunEventWireLine)

const eventsOf = (output: string): ReadonlyArray<RunEvent.RunEvent> =>
  output.split('\n').flatMap((line) => Option.toArray(decodeWireLine(line.trim())))

const daemonMutantsIn = (
  root: string,
): Effect.Effect<ReadonlyArray<MutantRow>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(root, REPORT_FILE))
    const report = yield* S.decodeEffect(S.fromJsonString(Report.MutationTestResult))(text)
    return (report.files[DAEMON_FILE]?.mutants ?? []).map((mutant): MutantRow => ({
      status: mutant.status,
      statusReason: mutant.statusReason,
    }))
  }).pipe(Effect.orElseSucceed((): ReadonlyArray<MutantRow> => []))

const observedRun = Effect.scoped(
  Effect.gen(function*() {
    const root = yield* writeProject(PROJECT)
    const run = yield* runCli({ root, args: ['run', '--json'] })
    return { exitCode: run.exitCode, events: eventsOf(run.output), daemonMutants: yield* daemonMutantsIn(root) }
  }),
)

Feature('Reporting a mutant that never settles without aborting the run')
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary spawns the vm worker and drives the real child-process test runner')
  .body(({ scenario }) => {
    scenario(
      'A mutant whose covering test never settles is reported as timed out and the run continues',
      Gherkin.Do.pipe(
        Given(
          'a project whose module can be mutated so its promise never settles, run with a short time budget for each mutant',
        )('observation', () => observedRun),
        Then(
          'the run finishes, the never-settling mutant is recorded as timed out, its siblings keep their results, and the run does not end as an internal failure',
        )((s, expect) => {
          const verdict = s.observation.events.find(S.is(RunEvent.VerdictReached))
          const timeouts = s.observation.daemonMutants.filter((mutant) => mutant.status === 'Timeout')
          const killed = s.observation.daemonMutants.filter((mutant) => mutant.status === 'Killed')
          return expect({
            exitCode: s.observation.exitCode,
            verdictReached: verdict !== undefined,
            wallClockTimeoutReported: timeouts.some((mutant) =>
              mutant.statusReason === 'timed-out: wall-clock-timeout'
            ),
            timeoutStreamed: s.observation.events.some((event) =>
              S.is(RunEvent.RunMutantTested)(event) && event.status === 'Timeout'
            ),
            verdictCountsTimeout: (verdict?.counts.timeout ?? 0) >= 1,
            siblingsStillClassified: killed.length >= 1,
          }).toEqual({
            exitCode: 0,
            verdictReached: true,
            wallClockTimeoutReported: true,
            timeoutStreamed: true,
            verdictCountsTimeout: true,
            siblingsStillClassified: true,
          })
        }),
      ),
    )
  })
