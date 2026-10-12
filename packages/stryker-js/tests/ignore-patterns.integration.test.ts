import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
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

const OUTPUT_OPTIONS = [
  'tempDirName',
  'incrementalFile',
  'progressStreamFile',
  'htmlReporter.fileName',
  'jsonReporter.fileName',
]

const FOREIGN_REPORT = 'reports/coverage/lcov.info'

const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'

const ALWAYS_IGNORED_LIST = /always ignored, whatever `ignorePatterns` holds: \[([^\]]*)\]/

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
  ignorePatterns: [],
})

const reuseOf = (root: string): Effect.Effect<RunEvent.ReuseReported | undefined> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const runLayer = Layer.merge(Layer.provide(Engine.RunEnvironment.stage(environmentFor(root), queue), ports), ports)
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root), targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events = [
      ...(yield* Queue.end(queue).pipe(
        Effect.andThen(Queue.takeAll(queue)),
        Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
      )),
    ]
    return events.find((event): event is RunEvent.ReuseReported => S.is(RunEvent.ReuseReported)(event))
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
    const printed = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
    yield* handle.exitCode
    const lines = (yield* Fiber.join(printed)).split('\n')
    const help = lines.flatMap((line) =>
      Option.toArray(S.decodeOption(S.fromJsonString(RunEvent.HelpRendered))(line.trim()))
    )
    return help.map((event) => event.help).join('\n')
  }),
).pipe(Effect.orDie)

Feature('What Stryker always leaves out of a project', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the scenarios drive the real engine over the host filesystem and the built stryker binary')
  .body(({ scenario }) => {
    scenario(
      'Every always-ignored pattern stays out of the project while other files under reports/ do not',
      Gherkin.Do.pipe(
        Given('a workspace with no ignore patterns of its own, run once, then given files under each pattern')(
          'runs',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const root = yield* fs.makeTempDirectory()
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  yield* writeFiles(root, ['src/math.ts'])
                  yield* fs.writeFileString(`${root}/src/math.ts`, SOURCE)
                  yield* reuseOf(root)
                  yield* writeFiles(root, ALWAYS_IGNORED.map(([, sample]) => sample))
                  const afterIgnored = yield* reuseOf(root)
                  yield* writeFiles(root, [FOREIGN_REPORT])
                  const afterForeignReport = yield* reuseOf(root)
                  return { afterIgnored, afterForeignReport }
                }),
                fs.remove(root, { recursive: true, force: true }).pipe(Effect.orDie),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('files under the always-ignored patterns keep every verdict, and a foreign report refuses them')(
          (s, expect) => {
            const planned = s.runs.afterIgnored?.reused ?? 0
            return expect({
              plannedNonZero: planned > 0,
              afterIgnored: {
                ran: s.runs.afterIgnored?.ran,
                closureChanged: s.runs.afterIgnored?.refused.closureChanged,
              },
              afterForeignReport: {
                reused: s.runs.afterForeignReport?.reused,
                closureChanged: s.runs.afterForeignReport?.refused.closureChanged,
              },
            }).toEqual({
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
        Then('it lists the always-ignored patterns, names every output option, and promises nothing for reports/')(
          (s, expect) =>
            expect({
              listed: Option.getOrUndefined(
                Option.map(Option.fromNullishOr(ALWAYS_IGNORED_LIST.exec(s.help)?.[1]), (list) =>
                  list.split(', ').map((item) => item.replaceAll('`', ''))),
              ),
              namesEveryOutputOption: OUTPUT_OPTIONS.every((option) =>
                s.help.includes(`\`${option}\``)
              ),
              saysOtherReportsAreNotIgnored: s.help.includes('Other files under `reports/` are not ignored.'),
              claimsReportsIgnored: s.help.includes('`/reports`'),
            }).toEqual({
              listed: ALWAYS_IGNORED.map(([pattern]) => pattern),
              namesEveryOutputOption: true,
              saysOtherReportsAreNotIgnored: true,
              claimsReportsIgnored: false,
            }),
        ),
      ),
    )
  })
