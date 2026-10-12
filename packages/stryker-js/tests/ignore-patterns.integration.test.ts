import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const ALWAYS_IGNORED: ReadonlyArray<readonly [pattern: string, sample: string]> = [
  ['node_modules', 'node_modules/left-pad/index.js'],
  ['.git', '.git/HEAD'],
  ['*.tsbuildinfo', 'tsconfig.tsbuildinfo'],
  ['/stryker.log', 'stryker.log'],
  ['.next', '.next/server/page.js'],
  ['.nuxt', '.nuxt/app.js'],
  ['.svelte-kit', '.svelte-kit/output.js'],
  ['.turbo', '.turbo/cache.json'],
]

const OUTPUT_FILES = [
  '.stryker-scratch/leftover.txt',
  'out/stream.jsonl',
  'out/report.html',
  'out/report.json',
  'out/report.sarif',
  'reports/mutation/reproducers.json',
]

const NAMED_OUTPUTS = [
  '`tempDirName`',
  '`incrementalFile`',
  '`progressStreamFile`',
  '`htmlReporter.fileName`',
  '`jsonReporter.fileName`',
  'the SARIF file beside `jsonReporter.fileName`',
  '`reports/mutation/reproducers.json`',
]

const FOREIGN_REPORT = 'reports/coverage/lcov.info'

const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'

const ALWAYS_IGNORED_LIST = /always ignored: \[([^\]]*)\]/

const OUTPUT_LIST = /own output files are always excluded too: (.*?)\. Other files under `reports\/` are not ignored\./

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

const optionsOf = (root: string): Options.PartialStrykerOptions => ({
  testRunner: 'command',
  commandRunner: { command: 'true' },
  coverageAnalysis: 'off',
  reporters: [],
  mutate: ['src/**/*.ts'],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${root}/reports/main.json`,
  tempDirName: '.stryker-scratch',
  progressStreamFile: 'out/stream.jsonl',
  htmlReporter: { fileName: 'out/report.html' },
  jsonReporter: { fileName: 'out/report.json' },
  ignorePatterns: [],
})

interface ReuseRun {
  readonly succeeded: boolean
  readonly reuse: RunEvent.ReuseReported | undefined
}

const reuseOf = (root: string): Effect.Effect<ReuseRun> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const runLayer = Layer.merge(Layer.provide(Engine.RunEnvironment.stage(environmentFor(root), queue), ports), ports)
    const exit = yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root), targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events = [
      ...(yield* Queue.end(queue).pipe(
        Effect.andThen(Queue.takeAll(queue)),
        Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
      )),
    ]
    return {
      succeeded: Exit.isSuccess(exit),
      reuse: events.find((event): event is RunEvent.ReuseReported => S.is(RunEvent.ReuseReported)(event)),
    }
  })

const writeFiles = (root: string, files: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* Effect.forEach(
      files,
      (file) =>
        Effect.gen(function*() {
          const target = path.join(root, file)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, `${file}\n`)
        }),
      { discard: true },
    )
  })

const renderedHelp = Effect.scoped(
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(
      ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'run', '--help'], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: { STRYKER_MODE: 'machine', NO_COLOR: '1' },
        extendEnv: true,
      }),
    )
    const printedOut = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
    const printedErr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
    const exitCode = Number(yield* handle.exitCode)
    const [out] = yield* Effect.all([Fiber.join(printedOut), Fiber.join(printedErr)])
    const help = out.split('\n').flatMap((line) =>
      Option.toArray(S.decodeOption(S.fromJsonString(RunEvent.HelpRendered))(line.trim()))
    )
    return { exitCode, text: help.map((event) => event.help).join('\n') }
  }),
).pipe(Effect.orDie)

Feature('What Stryker always leaves out of a project', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the scenarios drive the real engine over the host filesystem and the built stryker binary')
  .body(({ scenario }) => {
    scenario(
      'Every always-ignored pattern stays out of the project while other files under reports/ do not',
      Gherkin.Do.pipe(
        Given(
          'a workspace with no ignore patterns of its own and its outputs moved, run once, then given files under each pattern and at each output',
        )(
          'runs',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const root = yield* fs.makeTempDirectory()
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  yield* writeFiles(root, ['src/math.ts'])
                  yield* fs.writeFileString(`${root}/src/math.ts`, SOURCE)
                  const first = yield* reuseOf(root)
                  yield* writeFiles(root, [
                    ...ALWAYS_IGNORED.map(([, sample]) => sample),
                    ...OUTPUT_FILES,
                  ])
                  const afterIgnored = yield* reuseOf(root)
                  yield* writeFiles(root, [FOREIGN_REPORT])
                  const afterForeignReport = yield* reuseOf(root)
                  return { first, afterIgnored, afterForeignReport }
                }),
                fs.remove(root, { recursive: true, force: true }).pipe(Effect.orDie),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then(
          'files under the always-ignored patterns and at every output keep every verdict, and a foreign report refuses them',
        )(
          (s, expect) => {
            const planned = s.runs.afterIgnored.reuse?.reused ?? 0
            return expect({
              runsSucceeded: [s.runs.first, s.runs.afterIgnored, s.runs.afterForeignReport].map((run) => run.succeeded),
              plannedNonZero: planned > 0,
              afterIgnored: {
                ran: s.runs.afterIgnored.reuse?.ran,
                closureChanged: s.runs.afterIgnored.reuse?.refused.closureChanged,
              },
              afterForeignReport: {
                reused: s.runs.afterForeignReport.reuse?.reused,
                closureChanged: s.runs.afterForeignReport.reuse?.refused.closureChanged,
              },
            }).toEqual({
              runsSucceeded: [true, true, true],
              plannedNonZero: true,
              afterIgnored: { ran: 0, closureChanged: 0 },
              afterForeignReport: { reused: 0, closureChanged: planned },
            })
          },
        ),
      ),
    )

    scenario(
      'The --ignorePatterns help lists exactly what Stryker always ignores',
      Gherkin.Do.pipe(
        Given('the help the built binary renders for stryker run')('help', () => renderedHelp),
        Then('it lists the always-ignored patterns and every output by its option, and promises nothing for reports/')(
          (s, expect) =>
            expect({
              exitCode: s.help.exitCode,
              listed: ALWAYS_IGNORED_LIST.exec(s.help.text)?.[1]?.split(', ').map((item) => item.replaceAll('`', '')),
              outputs: OUTPUT_LIST.exec(s.help.text)?.[1]?.split(', '),
              claimsReportsIgnored: s.help.text.includes('`/reports`'),
            }).toEqual({
              exitCode: 0,
              listed: ALWAYS_IGNORED.map(([pattern]) => pattern),
              outputs: NAMED_OUTPUTS,
              claimsReportsIgnored: false,
            }),
        ),
      ),
    )
  })
