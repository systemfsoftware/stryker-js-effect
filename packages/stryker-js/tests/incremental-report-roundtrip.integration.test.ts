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
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type StoredVerdict, storedVerdictsIn } from './__fixtures__/stored-verdicts.fixture.js'

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

const runLayerOf = (root: string, ports: Layer.Layer<Engine.EnginePorts> = Engine.nodePlatformLayer) =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
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

interface RecordedFsOp {
  readonly op: 'write' | 'rename'
  readonly path: string
  readonly to?: string
}

const recordingFileSystemLayer = (ops: RecordedFsOp[]): Layer.Layer<FileSystem.FileSystem> =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (base): FileSystem.FileSystem => ({
      ...base,
      writeFileString: (path, data, options) =>
        base.writeFileString(path, data, options).pipe(
          Effect.tap(() => Effect.sync(() => ops.push({ op: 'write', path }))),
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

type Tested = RunEvent.RunMutantTestedEvent

const isTested = S.is(RunEvent.RunMutantTestedEvent)

interface Interrupted {
  readonly text: string
  readonly firstStoredId: string
  readonly tested: readonly Tested[]
  readonly stored: Readonly<Record<string, StoredVerdict>>
}

const interruptOnceAVerdictIsStored = (root: string, command: string): Effect.Effect<Interrupted, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { queue, layer } = yield* runLayerOf(root)
    const fiber = yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root, command), targetMutatePatterns: undefined })
      .pipe(Effect.provide(layer), Effect.scoped, Effect.exit, Effect.forkChild)
    const takeUntilTested = (
      taken: readonly RunEvent.RunEvent[],
    ): Effect.Effect<readonly RunEvent.RunEvent[], Cause.Done> =>
      Effect.flatMap(
        Queue.take(queue),
        (event) => isTested(event) ? Effect.succeed([...taken, event]) : takeUntilTested([...taken, event]),
      )
    const before = yield* takeUntilTested([])
    const first = before.filter(isTested)[0]?.id ?? ''
    const waitForStored = (attempts: number): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
      Effect.flatMap(
        storedVerdictsIn({ projectRoot: root, mutantIds: [first] }),
        (stored) =>
          stored[first] !== undefined
            ? Effect.succeed(true)
            : attempts <= 0
            ? Effect.succeed(false)
            : Effect.andThen(Effect.sleep(25), waitForStored(attempts - 1)),
      )
    yield* waitForStored(2000)
    yield* Fiber.interrupt(fiber)
    const after = yield* Queue.takeAll(queue).pipe(Effect.orElseSucceed((): readonly RunEvent.RunEvent[] => []))
    const tested = [...before, ...after].filter(isTested)
    return {
      text: yield* fs.readFileString(path.join(root, 'reports', 'main.json')).pipe(Effect.orElseSucceed(() => '')),
      firstStoredId: first,
      tested,
      stored: yield* storedVerdictsIn({ projectRoot: root, mutantIds: tested.map((event) => event.id) }),
    }
  }).pipe(Effect.orDie, Effect.provide(filePorts))

interface Decoded {
  readonly decoded: boolean
  readonly error: string
  readonly carriesDryRunDigest: boolean
}

const decodedOf = (text: string): Decoded => {
  const result = S.decodeResult(S.fromJsonString(Engine.IncrementalReportSchema))(text)
  const document = S.decodeOption(
    S.fromJsonString(S.Struct({ dryRunCoverage: S.optional(S.Struct({ testClosureDigest: S.String })) })),
  )(text)
  return {
    decoded: Result.isSuccess(result),
    error: Result.isFailure(result) ? result.failure.message : '',
    carriesDryRunDigest: Option.exists(document, (present) => present.dryRunCoverage !== undefined),
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
                Effect.map(runToCompletion(root, 'true'), decodedOf),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the report decodes with a dry-run closure digest')((s, expect) =>
          expect(s.observed).toEqual({ decoded: true, error: '', carriesDryRunDigest: true })
        ),
      ),
    )

    scenario(
      'A run interrupted during mutation testing leaves a decodable report and the verdicts it streamed',
      Gherkin.Do.pipe(
        Given('a workspace whose incremental run is interrupted once its first verdict is stored')(
          'observed',
          () =>
            Effect.gen(function*() {
              const root = yield* writeFixture([['src/math.ts', SOURCE]])
              return yield* Effect.ensuring(interruptOnceAVerdictIsStored(root, 'sleep 0.2'), removeFixture(root))
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the report decodes and every stored verdict is the one the run streamed')((s, expect) => {
          const streamed: Readonly<Record<string, string>> = Object.fromEntries(
            s.observed.tested.map((event) => [event.id, event.status]),
          )
          const { decoded, error } = decodedOf(s.observed.text)
          return expect({
            decoded,
            error,
            storedTheFirst: s.observed.stored[s.observed.firstStoredId] !== undefined,
            storedMatchesStream: Object.entries(s.observed.stored).every(([id, verdict]) =>
              streamed[id] === verdict.status
            ),
          }).toEqual({ decoded: true, error: '', storedTheFirst: true, storedMatchesStream: true })
        }),
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
  })
