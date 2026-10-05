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
import type { PlatformError } from 'effect/PlatformError'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
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
  allowConsoleColors: false,
})

const writeFixture = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
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
    return root
  }).pipe(Effect.orDie)

const removeFixture = (root: string): Effect.Effect<void, never, never> =>
  Effect.provide(
    Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true }))),
    filePorts,
  )

const optionsOf = (root: string, command: string): Options.PartialStrykerOptions => ({
  testRunner: 'command',
  commandRunner: { command },
  coverageAnalysis: 'off',
  reporters: [],
  mutate: ['src/**/*.ts'],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${root}/reports/main.json`,
})

const runLayerOf = (root: string) =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    return {
      queue,
      layer: Layer.merge(Layer.provide(Engine.RunEnvironment.stage(environmentFor(root), queue), ports), ports),
    }
  })

const runToCompletion = (root: string, command: string): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { layer } = yield* runLayerOf(root)
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root, command), targetMutatePatterns: undefined })
      .pipe(Effect.provide(layer), Effect.scoped, Effect.orDie)
    return yield* fs.readFileString(path.join(root, 'reports', 'main.json'))
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const interruptAtFirstCheckpoint = (root: string, command: string): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { layer } = yield* runLayerOf(root)
    const fiber = yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root, command), targetMutatePatterns: undefined })
      .pipe(Effect.provide(layer), Effect.scoped, Effect.exit, Effect.forkChild)
    const file = path.join(root, 'reports', 'main.json')
    const waitForFile = (attempts: number): Effect.Effect<boolean, PlatformError> =>
      fs.exists(file).pipe(
        Effect.flatMap((present) =>
          present
            ? Effect.succeed(true)
            : attempts <= 0
            ? Effect.succeed(false)
            : Effect.andThen(Effect.sleep(25), waitForFile(attempts - 1))
        ),
      )
    const appeared = yield* waitForFile(2000)
    yield* Fiber.interrupt(fiber)
    return appeared ? yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => '')) : ''
  }).pipe(Effect.orDie, Effect.provide(filePorts))

interface Decoded {
  readonly decoded: boolean
  readonly error: string
  readonly shape: {
    readonly bytes: number
    readonly carriesFramework: boolean
    readonly carriesConfig: boolean
    readonly carriesDryRunDigest: boolean
    readonly carriesPendingMutants: boolean
  }
}

const decodedOf = (text: string): Decoded => {
  const result = S.decodeResult(S.fromJsonString(Engine.IncrementalReportSchema))(text)
  const document = S.decodeOption(
    S.fromJsonString(
      S.Struct({
        framework: S.optional(S.Unknown),
        config: S.optional(S.Unknown),
        dryRunCoverage: S.optional(S.Struct({ testClosureDigest: S.String })),
      }),
    ),
  )(text)
  return {
    decoded: Result.isSuccess(result),
    error: Result.isFailure(result) ? result.failure.message : '',
    shape: {
      bytes: text.length,
      carriesFramework: Option.exists(document, (present) => present.framework !== undefined),
      carriesConfig: Option.exists(document, (present) => present.config !== undefined),
      carriesDryRunDigest: Option.exists(document, (present) => present.dryRunCoverage !== undefined),
      carriesPendingMutants: text.includes('"Pending"'),
    },
  }
}

Feature('Reading the incremental report the engine writes')
  .withLayer(Layer.empty)
  .live('the scenarios drive the real engine and read the report it leaves on the host filesystem')
  .body(({ scenario }) => {
    scenario(
      'A completed incremental run leaves a report the reader decodes',
      Gherkin.Do.pipe(
        Given('a workspace whose incremental run completes')(
          'observed',
          () =>
            Effect.gen(function*() {
              const root = yield* writeFixture([['src/math.ts', SOURCE]])
              return yield* Effect.ensuring(
                Effect.map(runToCompletion(root, 'true'), (text) => {
                  const { decoded, error, shape } = decodedOf(text)
                  return { decoded, error, shape }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the report decodes with the full-run fields and a dry-run closure digest')((s, expect) =>
          expect({
            decoded: s.observed.decoded,
            error: s.observed.error,
            fullReport: s.observed.shape.carriesFramework && s.observed.shape.carriesConfig,
            carriesDryRunDigest: s.observed.shape.carriesDryRunDigest,
          }).toEqual({ decoded: true, error: '', fullReport: true, carriesDryRunDigest: true })
        ),
      ),
    )

    scenario(
      'A run interrupted during mutation testing leaves a checkpoint the reader decodes',
      Gherkin.Do.pipe(
        Given('a workspace whose incremental run is interrupted once its first checkpoint lands')(
          'observed',
          () =>
            Effect.gen(function*() {
              const root = yield* writeFixture([['src/math.ts', SOURCE]])
              return yield* Effect.ensuring(
                Effect.map(interruptAtFirstCheckpoint(root, 'sleep 0.2'), (text) => {
                  const { decoded, error, shape } = decodedOf(text)
                  return { decoded, error, shape }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the checkpoint decodes, carries no full-run section, and still names its planned mutants')((s, expect) =>
          expect({
            decoded: s.observed.decoded,
            error: s.observed.error,
            slimReport: !s.observed.shape.carriesFramework && !s.observed.shape.carriesConfig,
            carriesPendingMutants: s.observed.shape.carriesPendingMutants,
          }).toEqual({ decoded: true, error: '', slimReport: true, carriesPendingMutants: true })
        ),
      ),
    )
  })
