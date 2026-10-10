import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

const UNASSERTED_FILE = 'src/lib/doubled.ts'
const UNCOVERED_FILE = 'src/lib/tripled.ts'

const FILES: ReadonlyArray<readonly [string, string]> = [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['vitest.config.ts', 'export default { test: { testTimeout: 600_000, hookTimeout: 600_000 } }\n'],
  [UNASSERTED_FILE, 'export const doubled = (n: number): number => n * 2\n'],
  [UNCOVERED_FILE, 'export const tripled = (n: number): number => n * 3\n'],
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
]

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

const writeWorkspace = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.makeTempDirectory()
  yield* Effect.forEach(
    FILES,
    ([name, content]) =>
      Effect.gen(function*() {
        const target = path.join(directory, name)
        yield* fs.makeDirectory(path.dirname(target), { recursive: true })
        yield* fs.writeFileString(target, content)
      }),
    { discard: true },
  )
  yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(directory, 'node_modules'))
  return directory
}).pipe(Effect.orDie)

const removeWorkspace = (directory: string) =>
  Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })))

const isMutantLine = (event: RunEvent.RunEvent): event is RunEvent.RunMutantTested =>
  RunEvent.RunEvent.guards.mutantTested(event)

const runOnce = (directory: string) =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(directory), queue), Engine.nodePlatformLayer),
      Engine.nodePlatformLayer,
    )
    const exit = yield* Engine.mutationTestCell
      .run({
        cliOptions: {
          testRunner: 'vm',
          plugins: [],
          reporters: [],
          thresholds: { high: 60, low: 40, break: 0 },
          checkers: [],
          testFiles: ['test/**/*.mjs'],
          mutate: ['src/**/*.ts'],
          mutator: { excludedMutations: ['ArrowFunction'] },
          coverageAnalysis: 'perTest',
          cleanTempDir: 'always',
          incremental: false,
        },
        targetMutatePatterns: undefined,
      })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events: ReadonlyArray<RunEvent.RunEvent> = yield* Queue.takeAll(queue).pipe(
      Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
    )
    return { succeeded: Exit.isSuccess(exit), lines: events.filter(isMutantLine) }
  })

const arithmeticLineIn = (lines: ReadonlyArray<RunEvent.RunMutantTested>, file: string) =>
  lines.find((line) => line.fileName === file && line.mutatorName === 'ArithmeticOperator')

Feature('A survivor and an uncovered mutant carry what an agent needs to act', { timeout: 300_000 })
  .withLayer(Layer.empty)
  .live('the engine runs the vm test runner over a real workspace and streams its mutant lines')
  .body(({ scenario }) => {
    scenario(
      'An unasserted call survives with its covering test and a strengthen action; an unreached function asks for a test at its own position',
      Gherkin.Do.pipe(
        Given('a project whose test calls doubled without asserting and never reaches tripled')(
          'directory',
          () => writeWorkspace.pipe(Effect.provide(filePorts)),
        ),
        When('the project is mutated')(
          'run',
          (s) => runOnce(s.directory).pipe(Effect.ensuring(removeWorkspace(s.directory)), Effect.provide(filePorts)),
        ),
        Then('each line reads as its status, reason code, original text, covering tests and next action')(
          (s, expect) => {
            const survived = arithmeticLineIn(s.run.lines, UNASSERTED_FILE)
            const uncovered = arithmeticLineIn(s.run.lines, UNCOVERED_FILE)
            return expect({
              succeeded: s.run.succeeded,
              survived: survived?.status === 'Survived'
                ? {
                  reason: survived.statusReason.split(':')[0],
                  original: survived.original,
                  replacement: survived.replacement,
                  coveringTests: survived.coveredBy.length,
                  namesTheSeededTest: survived.coveredBy.some((test) => test.includes('calls doubled')),
                  next: survived.next._tag,
                  shown: survived.next.tests.shown,
                  total: survived.next.tests.total,
                  reproduce: survived.next.reproduce,
                }
                : survived?.status,
              uncovered: uncovered?.status === 'NoCoverage'
                ? { reason: uncovered.statusReason.split(':')[0], original: uncovered.original, next: uncovered.next }
                : uncovered?.status,
            }).toEqual({
              succeeded: true,
              survived: {
                reason: 'covered-not-killed',
                original: 'n * 2',
                replacement: 'n / 2',
                coveringTests: 1,
                namesTheSeededTest: true,
                next: 'strengthen-tests',
                shown: survived?.status === 'Survived' ? survived.coveredBy : [],
                total: 1,
                reproduce: `stryker run --mutant ${survived?.id}`,
              },
              uncovered: {
                reason: 'not-covered',
                original: 'n * 3',
                next: { _tag: 'add-test', file: 'src/lib/tripled.ts', line: 1, column: 47 },
              },
            })
          },
        ),
      ),
    )
  })
