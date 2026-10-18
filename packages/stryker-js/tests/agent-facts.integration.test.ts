import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { type ProjectFiles, runCli, writeProject } from './__fixtures__/cli-project.fixture.js'

const Feature = makeFeature({ it })

const UNASSERTED_FILE = 'src/lib/doubled.ts'
const UNCOVERED_FILE = 'src/lib/tripled.ts'
const STATIC_FILE = 'src/lib/limit.ts'

const PROJECT: ProjectFiles = [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['vitest.config.ts', 'export default { test: { testTimeout: 600_000, hookTimeout: 600_000 } }\n'],
  [
    'stryker.config.mjs',
    `export default {
  testRunner: 'vm',
  plugins: [],
  reporters: [],
  thresholds: { high: 60, low: 40, break: null },
  checkers: [],
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.ts'],
  mutator: { excludedMutations: ['ArrowFunction'] },
  coverageAnalysis: 'perTest',
  cleanTempDir: 'always',
  incremental: true,
}
`,
  ],
  [UNASSERTED_FILE, 'export const doubled = (n: number): number => n * 2\n'],
  [UNCOVERED_FILE, 'export const tripled = (n: number): number => n * 3\n'],
  [STATIC_FILE, 'export const LIMIT = 2 * 3\n'],
  [
    'test/doubled.test.mjs',
    [
      "import { test } from 'vitest'",
      "import { doubled } from '../src/lib/doubled.ts'",
      '',
      "test('calls doubled without asserting', () => {",
      '  doubled(3)',
      '})',
      '',
    ].join('\n'),
  ],
  [
    'test/limit.test.mjs',
    [
      "import { test } from 'vitest'",
      "import { LIMIT } from '../src/lib/limit.ts'",
      '',
      "test('loads the limit without asserting', () => {",
      '  void LIMIT',
      '})',
      '',
    ].join('\n'),
  ],
]

const TESTS_LOADING_THE_STATIC_MODULE = 1

const decodeWireLine = S.decodeOption(RunEvent.RunEventWireLine)

const mutantLinesOf = (output: string): ReadonlyArray<RunEvent.RunMutantTested> =>
  output.split('\n').flatMap((line) =>
    Option.toArray(Option.filter(decodeWireLine(line.trim()), RunEvent.RunEvent.guards.mutantTested))
  )

const decodeStatusReason = S.decodeOption(Mutant.StatusReason)

const decodedReasonOf = (line: RunEvent.RunMutantTested) =>
  decodeStatusReason({ status: line.status, statusReason: line.statusReason })

const reasonCodeOf = (line: RunEvent.RunMutantTested): string =>
  Option.match(decodedReasonOf(line), {
    onNone: () => 'undecodable',
    onSome: (decoded) => decoded.statusReason.code,
  })

const reasonDetailOf = (line: RunEvent.RunMutantTested): string =>
  Option.match(decodedReasonOf(line), {
    onNone: () => 'undecodable',
    onSome: (decoded) => decoded.statusReason.detail,
  })

const arithmeticLineIn = (lines: ReadonlyArray<RunEvent.RunMutantTested>, file: string) =>
  lines.find((line) => line.fileName === file && line.mutatorName === 'ArithmeticOperator')

const runOnce = Effect.scoped(
  Effect.gen(function*() {
    const root = yield* writeProject(PROJECT)
    const run = yield* runCli({ root, args: ['run', '--json'] })
    return { exitCode: run.exitCode, lines: mutantLinesOf(run.output) }
  }),
)

const runTwice = Effect.scoped(
  Effect.gen(function*() {
    const root = yield* writeProject(PROJECT)
    const first = yield* runCli({ root, args: ['run', '--json'] })
    const second = yield* runCli({ root, args: ['run', '--json'] })
    return {
      exitCodes: [first.exitCode, second.exitCode],
      first: mutantLinesOf(first.output),
      second: mutantLinesOf(second.output),
    }
  }),
)

Feature('A survivor and an uncovered mutant carry what an agent needs to act', { timeout: 300_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs the vm test runner over a real project and streams its mutant lines')
  .body(({ scenario }) => {
    scenario(
      'An unasserted call survives with its covering test and a strengthen action; an unreached function asks for a test at its own position',
      Gherkin.Do.pipe(
        Given('a project whose test calls doubled without asserting and never reaches tripled')(
          'run',
          () => runOnce,
        ),
        Then('each line reads as its status, reason code, original text, covering tests and next action')(
          (s, expect) => {
            const survived = arithmeticLineIn(s.run.lines, UNASSERTED_FILE)
            const uncovered = arithmeticLineIn(s.run.lines, UNCOVERED_FILE)
            return expect({
              exitCode: s.run.exitCode,
              survived: survived?.status === 'Survived'
                ? {
                  reason: reasonCodeOf(survived),
                  original: survived.original,
                  replacement: survived.replacement,
                  coveringTests: survived.coveredBy.length,
                  namesTheSeededTest: survived.coveredBy.some((test) => test.includes('calls doubled')),
                  next: survived.next,
                }
                : survived?.status,
              uncovered: uncovered?.status === 'NoCoverage'
                ? { reason: reasonCodeOf(uncovered), original: uncovered.original, next: uncovered.next }
                : uncovered?.status,
            }).toEqual({
              exitCode: 0,
              survived: {
                reason: 'covered-not-killed',
                original: 'n * 2',
                replacement: 'n / 2',
                coveringTests: 1,
                namesTheSeededTest: true,
                next: {
                  _tag: 'strengthen-tests',
                  tests: { total: 1, shown: survived?.status === 'Survived' ? survived.coveredBy : [] },
                  reproduce: `stryker run --mutant ${survived?.id}`,
                },
              },
              uncovered: {
                reason: 'not-covered',
                original: 'n * 3',
                next: { _tag: 'add-test', file: UNCOVERED_FILE, line: 1, column: 47 },
              },
            })
          },
        ),
      ),
    )

    scenario(
      'A static mutant the suite loads but no single test covers survives without claiming a covering test',
      Gherkin.Do.pipe(
        Given('a project whose tests load a module-level constant and never assert on it')('run', () => runOnce),
        Then(
          'its line names no covering test, its reason says every test ran with it active, and it asks for a strengthening test',
        )(
          (s, expect) => {
            const staticLine = arithmeticLineIn(s.run.lines, STATIC_FILE)
            return expect({
              exitCode: s.run.exitCode,
              staticLine: staticLine?.status === 'Survived'
                ? {
                  reason: reasonCodeOf(staticLine),
                  detail: reasonDetailOf(staticLine),
                  original: staticLine.original,
                  coveredBy: staticLine.coveredBy,
                  next: staticLine.next,
                }
                : staticLine?.status,
            }).toEqual({
              exitCode: 0,
              staticLine: {
                reason: 'covered-not-killed',
                detail:
                  `no test covers it alone; ${TESTS_LOADING_THE_STATIC_MODULE} tests ran with it active, none failed`,
                original: '2 * 3',
                coveredBy: [],
                next: {
                  _tag: 'strengthen-tests',
                  tests: { total: 0, shown: [] },
                  reproduce: `stryker run --mutant ${staticLine?.id}`,
                },
              },
            })
          },
        ),
      ),
    )

    scenario(
      'A repeat run of an unchanged project names every reused verdict as remembered, while ignored mutants keep their ignore reason',
      Gherkin.Do.pipe(
        Given('the same project, run once and then again with nothing changed')('runs', () => runTwice),
        Then('every verdict the second run reuses carries the remembered code and its first-run status')(
          (s, expect) => {
            const reused = s.runs.second.filter((line) => line.status !== 'Ignored')
            const ignored = s.runs.second.filter((line) => line.status === 'Ignored')
            return expect({
              exitCodes: s.runs.exitCodes,
              reusedNonZero: reused.length > 0,
              reusedCodes: [...new Set(reused.map(reasonCodeOf))],
              ignoredCodes: [...new Set(ignored.map(reasonCodeOf))],
              statuses: s.runs.second.map((line) => `${line.id}:${line.status}`).sort(),
            }).toEqual({
              exitCodes: [0, 0],
              reusedNonZero: true,
              reusedCodes: ['remembered'],
              ignoredCodes: ['excluded-mutator'],
              statuses: s.runs.first.map((line) => `${line.id}:${line.status}`).sort(),
            })
          },
        ),
      ),
    )
  })
