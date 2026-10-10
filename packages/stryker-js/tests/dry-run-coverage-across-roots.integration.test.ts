import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Cli, Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { mergeConfig } from '@systemfsoftware/stryker-js/config'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const SOURCE = [
  'export const add = (left: number, right: number): number => left + right',
  'export const label = (): string => "value"',
  '',
].join('\n')

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  configOverlay: mergeConfig,
  allowConsoleColors: false,
})

const writeFiles = (
  root: string,
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* Effect.forEach(
      files,
      ([file, content]) =>
        Effect.gen(function*() {
          const target = path.join(root, file)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
  }).pipe(Effect.orDie)

const writeFixture = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectory()
    yield* writeFiles(root, [['src/math.ts', SOURCE], ...files])
    return root
  }).pipe(Effect.orDie)

const removeFixture = (root: string): Effect.Effect<void, never, never> =>
  Effect.provide(
    Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true }))),
    filePorts,
  )

const buildLogOf = (root: string, millis: number): string =>
  [
    '$ pnpm run build',
    `ℹ config file: ${root}/tsdown.config.ts`,
    '✔ Build complete in ',
    String(millis),
    'ms',
    '',
  ].join('')

const optionsOf = (root: string, commandRunner: string): Options.PartialStrykerOptions => ({
  testRunner: 'command',
  commandRunner: { command: commandRunner },
  coverageAnalysis: 'off',
  reporters: [],
  mutate: ['src/**/*.ts'],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${root}/reports/main.json`,
})

interface RunObservation {
  readonly report: string
  readonly reused: number | undefined
  readonly ran: number | undefined
  readonly refused: Readonly<Record<string, number>> | undefined
  readonly spawns: number
  readonly logs: readonly string[]
}

const runOnce = (
  root: string,
  spawnLog: string,
): Effect.Effect<RunObservation, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Cli.platformLayer
    const logs: string[] = []
    const layer = Layer.mergeAll(
      Layer.provide(Engine.stage(environmentFor(root), queue), ports),
      ports,
      Logger.layer([
        Logger.make((entry) => {
          logs.push([entry.message].flat().map(String).join(' '))
        }),
      ]),
    )
    const spawnsBefore = (yield* fs.readFileString(spawnLog).pipe(Effect.orElseSucceed(() => '')))
      .split('\n')
      .filter((line) => line.length > 0)
      .length
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root, `echo spawned >> ${spawnLog}`), targetMutatePatterns: undefined })
      .pipe(Effect.provide(layer), Effect.scoped, Effect.orDie)
    const events = [
      ...(yield* Queue.end(queue).pipe(
        Effect.andThen(Queue.takeAll(queue)),
        Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
      )),
    ]
    const reuse = events.find((event): event is RunEvent.ReuseReported => S.is(RunEvent.ReuseReported)(event))
    const spawnsAfter = (yield* fs.readFileString(spawnLog).pipe(Effect.orElseSucceed(() => '')))
      .split('\n')
      .filter((line) => line.length > 0)
      .length
    return {
      report: yield* fs.readFileString(path.join(root, 'reports', 'main.json')).pipe(Effect.orElseSucceed(() => '')),
      reused: reuse?.reused,
      ran: reuse?.ran,
      refused: reuse === undefined ? undefined : reuse.refused,
      spawns: spawnsAfter - spawnsBefore,
      logs,
    }
  }).pipe(Effect.provide(filePorts), Effect.orDie)

const closureDigestOf = (report: string): string =>
  Option.getOrElse(
    Option.map(
      S.decodeOption(
        S.fromJsonString(S.Struct({ dryRunCoverage: S.Struct({ testClosureDigest: S.String }) })),
      )(report),
      (document) => document.dryRunCoverage.testClosureDigest,
    ),
    () => '',
  )

const ZERO_REFUSALS = {
  semanticsChanged: 0,
  policyChanged: 0,
  runInputsChanged: 0,
  closureChanged: 0,
  closureAnalysisFailed: 0,
  programChanged: 0,
  flakyDependency: 0,
  timeoutUnreproduced: 0,
  noPriorRecord: 0,
}

const copyReport = (
  from: string,
  to: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(path.join(to, 'reports'), { recursive: true })
    yield* fs.writeFileString(
      path.join(to, 'reports', 'main.json'),
      yield* fs.readFileString(path.join(from, 'reports', 'main.json')),
    )
  }).pipe(Effect.orDie)

Feature('Reusing dry-run coverage of a project that was built elsewhere')
  .withLayer(Layer.empty)
  .live('the scenarios drive the real engine over the host filesystem, so build logs and roots are the real ones')
  .body(({ scenario }) => {
    scenario(
      'A rebuild that only rewrites the task log keeps the dry-run digest and the reuse',
      Gherkin.Do.pipe(
        Given('a workspace whose task log is rewritten with a new wall-clock between two runs')(
          'observed',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const spawnLog = yield* fs.makeTempFile({ prefix: 'rebuild-spawns', suffix: '.log' })
              const root = yield* writeFixture([['.turbo/turbo-build.log', buildLogOf('', 1)]])
              yield* fs.writeFileString(path.join(root, '.turbo', 'turbo-build.log'), buildLogOf(root, 1000))
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const first = yield* runOnce(root, spawnLog)
                  yield* fs.writeFileString(path.join(root, '.turbo', 'turbo-build.log'), buildLogOf(root, 2000))
                  const second = yield* runOnce(root, spawnLog)
                  return { first, second }
                }),
                Effect.andThen(removeFixture(root), Effect.orDie(fs.remove(spawnLog, { force: true }))),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('both runs compute the same digest and the second one reuses everything without spawning a runner')(
          (s, expect) =>
            expect({
              digestsEqual: closureDigestOf(s.observed.first.report) === closureDigestOf(s.observed.second.report),
              digestNamed: closureDigestOf(s.observed.first.report).length > 0,
              second: {
                reused: s.observed.second.reused,
                ran: s.observed.second.ran,
                refused: s.observed.second.refused,
                spawns: s.observed.second.spawns,
              },
            }).toEqual({
              digestsEqual: true,
              digestNamed: true,
              second: {
                reused: s.observed.first.ran,
                ran: 0,
                refused: { ...ZERO_REFUSALS },
                spawns: 0,
              },
            }),
        ),
      ),
    )

    scenario(
      'The same project built at another absolute root keeps the digest the first root recorded',
      Gherkin.Do.pipe(
        Given("a workspace whose build is repeated in a second root from the first root's report")(
          'observed',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const spawnLog = yield* fs.makeTempFile({ prefix: 'reroot-spawns', suffix: '.log' })
              const rootA = yield* writeFixture([
                ['.turbo/turbo-build.log', ''],
                ['package.json', '{"name":"root-a","private":true}\n'],
              ])
              yield* fs.writeFileString(path.join(rootA, '.turbo', 'turbo-build.log'), buildLogOf(rootA, 1000))
              const rootB = yield* writeFixture([
                ['.turbo/turbo-build.log', ''],
                ['package.json', '{"name":"root-a","private":true}\n'],
              ])
              yield* fs.writeFileString(path.join(rootB, '.turbo', 'turbo-build.log'), buildLogOf(rootB, 2000))
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const first = yield* runOnce(rootA, spawnLog)
                  yield* copyReport(rootA, rootB)
                  const second = yield* runOnce(rootB, spawnLog)
                  return { first, second }
                }),
                Effect.andThen(
                  removeFixture(rootA),
                  Effect.andThen(removeFixture(rootB), Effect.orDie(fs.remove(spawnLog, { force: true }))),
                ),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then("the second root records the first root's digest and reuses the pending coverage")((s, expect) =>
          expect({
            digestsEqual: closureDigestOf(s.observed.first.report) === closureDigestOf(s.observed.second.report),
            rootDigestNamed: closureDigestOf(s.observed.first.report).length > 0,
            secondRun: {
              reusedCoverage: s.observed.second.logs.some((line) =>
                line.includes('Reusing the persisted dry-run coverage')
              ),
              refusedCoverage: s.observed.second.logs.some((line) => line.includes('dry-run coverage reuse refused')),
            },
          }).toEqual({
            digestsEqual: true,
            rootDigestNamed: true,
            secondRun: { reusedCoverage: true, refusedCoverage: false },
          })
        ),
      ),
    )
  })
