import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { mergeConfig } from '@systemfsoftware/stryker-js/config'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
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

const EXTRA_SOURCE = [
  'export const double = (value: number): number => value * 2',
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

const optionsOf = (
  root: string,
  command: string,
  mutate: readonly string[] = ['src/**/*.ts'],
): Options.PartialStrykerOptions => ({
  testRunner: 'command',
  commandRunner: { command },
  coverageAnalysis: 'off',
  reporters: [],
  mutate: [...mutate],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${root}/reports/main.json`,
})

const runLayerOf = (root: string, ports: Layer.Layer<Engine.EnginePorts> = Engine.nodePlatformLayer) =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    return {
      queue,
      layer: Layer.merge(Layer.provide(Engine.stage(environmentFor(root), queue), ports), ports),
    }
  })

const runToCompletion = (
  root: string,
  command: string,
  mutate?: readonly string[],
): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { layer } = yield* runLayerOf(root)
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root, command, mutate), targetMutatePatterns: undefined })
      .pipe(Effect.provide(layer), Effect.scoped, Effect.orDie)
    return yield* fs.readFileString(path.join(root, 'reports', 'main.json'))
  }).pipe(Effect.orDie, Effect.provide(filePorts))

interface RecordedFsOp {
  readonly op: 'write' | 'rename'
  readonly path: string
  readonly to?: string
  readonly data?: string
}

const recordingFileSystemLayer = (ops: RecordedFsOp[]): Layer.Layer<FileSystem.FileSystem> =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (base): FileSystem.FileSystem => ({
      ...base,
      writeFileString: (path, data, options) =>
        base.writeFileString(path, data, options).pipe(
          Effect.tap(() => Effect.sync(() => ops.push({ op: 'write', path, data }))),
        ),
      rename: (from, to) =>
        base.rename(from, to).pipe(
          Effect.tap(() => Effect.sync(() => ops.push({ op: 'rename', path: from, to }))),
        ),
    })),
  ).pipe(Layer.provide(NodeFileSystem.layer))

const writesTo = (ops: readonly RecordedFsOp[], target: string) =>
  ops.filter((op) => op.op === 'write').filter((op) => op.path === target)

const renamesTo = (ops: readonly RecordedFsOp[], target: string) =>
  ops.filter((op) => op.op === 'rename').filter((op) => op.to === target)

const runToCompletionRecordingWrites = (
  root: string,
  command: string,
  ops: RecordedFsOp[],
): Effect.Effect<{ readonly directWrites: number; readonly renamed: boolean }, never, never> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const target = pathService.join(root, 'reports', 'main.json')
    const { layer } = yield* runLayerOf(root, Layer.merge(Engine.nodePlatformLayer, recordingFileSystemLayer(ops)))
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root, command), targetMutatePatterns: undefined })
      .pipe(Effect.provide(layer), Effect.scoped, Effect.orDie)
    return { directWrites: writesTo(ops, target).length, renamed: renamesTo(ops, target).length > 0 }
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const runToCompletionRecordingContents = (
  root: string,
  command: string,
  ops: RecordedFsOp[],
): Effect.Effect<void, never, never> =>
  Effect.gen(function*() {
    const { layer } = yield* runLayerOf(root, Layer.merge(Engine.nodePlatformLayer, recordingFileSystemLayer(ops)))
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root, command), targetMutatePatterns: undefined })
      .pipe(Effect.provide(layer), Effect.scoped, Effect.orDie)
  }).pipe(Effect.orDie, Effect.provide(filePorts))

interface RecordedMutant {
  readonly id: string
  readonly file: string
  readonly remembered: boolean
}

const recordedMutantsOf = (text: string): readonly RecordedMutant[] =>
  Option.match(S.decodeOption(S.fromJsonString(Engine.IncrementalReportSchema))(text), {
    onNone: () => [],
    onSome: (report) =>
      Object.entries(report.files).flatMap(([file, result]) =>
        result.mutants.map((mutant) => ({ id: mutant.id, file, remembered: mutant.remembered === true }))
      ),
  })

const firstCheckpointOf = (ops: readonly RecordedFsOp[], target: string): string =>
  ops
    .filter((op) => op.op === 'write' && op.path.startsWith(`${target}.`))
    .map((op) => op.data ?? '')
    .find((data) => {
      const { decoded, shape } = decodedOf(data)
      return decoded && !shape.carriesFramework && !shape.carriesConfig
    }) ?? ''

const interruptAtFirstCheckpoint = (root: string, command: string): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { layer } = yield* runLayerOf(root)
    const fiber = yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root, command), targetMutatePatterns: undefined })
      .pipe(Effect.provide(layer), Effect.scoped, Effect.exit, Effect.forkChild)
    const file = path.join(root, 'reports', 'main.json')
    const waitForDecodable = (attempts: number): Effect.Effect<boolean, never> =>
      fs.readFileString(file).pipe(
        Effect.orElseSucceed(() => ''),
        Effect.flatMap((text) =>
          decodedOf(text).decoded
            ? Effect.succeed(true)
            : attempts <= 0
            ? Effect.succeed(false)
            : Effect.andThen(Effect.sleep(25), waitForDecodable(attempts - 1))
        ),
      )
    const appeared = yield* waitForDecodable(2000)
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

    scenario(
      'A completed incremental run writes the report by renaming a completed temporary file',
      Gherkin.Do.pipe(
        Given('a workspace whose incremental run completes under a filesystem that records its writes')(
          'observed',
          () =>
            Effect.gen(function*() {
              const root = yield* writeFixture([['src/math.ts', SOURCE]])
              const ops: RecordedFsOp[] = []
              return yield* Effect.ensuring(
                runToCompletionRecordingWrites(root, 'true', ops),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the incremental report path is only ever produced by renaming a completed temporary file')(
          (s, expect) => expect(s.observed).toEqual({ directWrites: 0, renamed: true }),
        ),
      ),
    )

    scenario(
      'A checkpoint written partway through a run marks exactly the reused mutants as remembered',
      Gherkin.Do.pipe(
        Given('a workspace whose first run mutates one file and whose second run widens the scope to a second')(
          'observed',
          () =>
            Effect.gen(function*() {
              const path = yield* Path.Path
              const root = yield* writeFixture([['src/math.ts', SOURCE], ['src/extra.ts', EXTRA_SOURCE]])
              const ops: RecordedFsOp[] = []
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const first = recordedMutantsOf(yield* runToCompletion(root, 'true', ['src/math.ts']))
                  yield* runToCompletionRecordingContents(root, 'true', ops)
                  const checkpoint = recordedMutantsOf(firstCheckpointOf(ops, path.join(root, 'reports', 'main.json')))
                  return { first, checkpoint }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then("the checkpoint marks the first run's mutants remembered and the newly scoped mutants not")(
          (s, expect) => {
            const ids = (mutants: readonly RecordedMutant[]) => mutants.map((mutant) => mutant.id).sort()
            return expect({
              firstRunMutated: s.observed.first.length > 0,
              rememberedInCheckpoint: ids(s.observed.checkpoint.filter((mutant) => mutant.remembered)),
              newlyScopedInCheckpoint: s.observed.checkpoint.some((mutant) => mutant.file === 'src/extra.ts'),
              newlyScopedRemembered: s.observed.checkpoint.some((mutant) =>
                mutant.file === 'src/extra.ts' && mutant.remembered
              ),
            }).toEqual({
              firstRunMutated: true,
              rememberedInCheckpoint: ids(s.observed.first),
              newlyScopedInCheckpoint: true,
              newlyScopedRemembered: false,
            })
          },
        ),
      ),
    )
  })
