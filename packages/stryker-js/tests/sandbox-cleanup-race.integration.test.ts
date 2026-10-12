import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Ref from 'effect/Ref'
import * as Stdio from 'effect/Stdio'

const Feature = makeFeature({ it })

const TEMP_DIR_NAME = '.stryker-tmp'

const MAX_BOUNDARIES = 16

const MARKER_FILE = 'still-here.txt'

type Phase = 'acquisition' | 'cleanup'

interface Hold {
  readonly phase: Phase
  readonly at: number
  readonly reached: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
}

interface Run {
  readonly hold: Option.Option<Hold>
  readonly acquired: Deferred.Deferred<string>
  readonly afterAcquired: Deferred.Deferred<void>
  readonly sandbox: Ref.Ref<Option.Option<string>>
  readonly steps: Ref.Ref<Readonly<Record<Phase, number>>>
}

type RunFiber = Fiber.Fiber<Exit.Exit<Engine.MutationTestDone, Engine.StageError | PlatformError>>

const makeHold = (phase: Phase, at: number): Effect.Effect<Hold> =>
  Effect.all({ reached: Deferred.make<void>(), release: Deferred.make<void>() }).pipe(
    Effect.map(({ reached, release }) => ({ phase, at, reached, release })),
  )

const makeRun = (hold: Option.Option<Hold>, gated: boolean): Effect.Effect<Run> =>
  Effect.gen(function*() {
    const afterAcquired = yield* Deferred.make<void>()
    yield* Effect.when(Deferred.succeed(afterAcquired, undefined), Effect.succeed(!gated))
    return {
      hold,
      acquired: yield* Deferred.make<string>(),
      afterAcquired,
      sandbox: yield* Ref.make(Option.none<string>()),
      steps: yield* Ref.make<Readonly<Record<Phase, number>>>({ acquisition: 0, cleanup: 0 }),
    }
  })

const releaseAll = (runs: ReadonlyArray<Run>): Effect.Effect<void> =>
  Effect.forEach(
    runs,
    (run) =>
      Effect.all([
        Deferred.succeed(run.afterAcquired, undefined),
        Option.match(run.hold, {
          onNone: () => Effect.void,
          onSome: (hold) => Deferred.succeed(hold.release, undefined),
        }),
      ]),
    { discard: true },
  )

const step = (run: Run, phase: Phase): Effect.Effect<void> =>
  Effect.gen(function*() {
    const before = yield* Ref.getAndUpdate(run.steps, (steps) => ({ ...steps, [phase]: steps[phase] + 1 }))
    yield* Option.match(Option.filter(run.hold, (hold) => hold.phase === phase && hold.at === before[phase]), {
      onNone: () => Effect.void,
      onSome: (hold) => Deferred.succeed(hold.reached, undefined).pipe(Effect.andThen(Deferred.await(hold.release))),
    })
  })

const stepWhen = (run: Run, phase: Phase, touchesParent: boolean): Effect.Effect<void> =>
  Effect.asVoid(Effect.when(step(run, phase), Effect.succeed(touchesParent)))

const interposedFileSystem = (real: FileSystem.FileSystem, parent: string, run: Run): FileSystem.FileSystem =>
  FileSystem.FileSystem.of({
    ...real,
    makeDirectory: (path, options) =>
      stepWhen(run, 'acquisition', path === parent).pipe(Effect.andThen(real.makeDirectory(path, options))),
    makeTempDirectory: (options) =>
      Effect.gen(function*() {
        const inParent = options?.directory === parent
        yield* stepWhen(run, 'acquisition', inParent)
        const made = yield* real.makeTempDirectory(options)
        yield* Effect.when(
          Ref.set(run.sandbox, Option.some(made)).pipe(
            Effect.andThen(Deferred.succeed(run.acquired, made)),
            Effect.andThen(Deferred.await(run.afterAcquired)),
          ),
          Effect.succeed(inParent),
        )
        return made
      }),
    remove: (path, options) =>
      Effect.gen(function*() {
        const own = Option.contains(yield* Ref.get(run.sandbox), path)
        yield* stepWhen(run, 'cleanup', own || path === parent)
        return yield* real.remove(path, options)
      }),
    // The released service reaches the parent only through EmptyDirectory. These two steps exist so this feature
    // still schedules a release that reads the parent before removing it, the shape that deleted rivals' sandboxes.
    exists: (path) => stepWhen(run, 'cleanup', path === parent).pipe(Effect.andThen(real.exists(path))),
    readDirectory: (path, options) =>
      stepWhen(run, 'cleanup', path === parent).pipe(Effect.andThen(real.readDirectory(path, options))),
  })

const interposedEmptyDirectory = (
  real: Engine.EmptyDirectoryShape,
  parent: string,
  run: Run,
): Engine.EmptyDirectoryShape =>
  Engine.EmptyDirectory.of({
    removeIfEmpty: (path) => stepWhen(run, 'cleanup', path === parent).pipe(Effect.andThen(real.removeIfEmpty(path))),
  })

const portsFor = (parent: string, run: Run): Layer.Layer<Engine.EnginePorts> =>
  Layer.mergeAll(
    Layer.effect(
      FileSystem.FileSystem,
      Effect.map(FileSystem.FileSystem, (real) => interposedFileSystem(real, parent, run)),
    ),
    Layer.effect(
      Engine.EmptyDirectory,
      Effect.map(Engine.EmptyDirectory, (real) => interposedEmptyDirectory(real, parent, run)),
    ),
    Stdio.layerTest({}),
  ).pipe(Layer.provideMerge(Engine.nodePlatformLayer))

const RUN_OPTIONS: Options.PartialStrykerOptions = {
  testRunner: 'vm',
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.ts'],
  reporters: [],
  checkers: [],
  concurrency: 1,
  dryRunOnly: true,
  incremental: false,
  tempDirName: TEMP_DIR_NAME,
  cleanTempDir: 'always',
}

const startRun = (parent: string, run: Run): Effect.Effect<RunFiber> =>
  Engine.strykerCell(RUN_OPTIONS).pipe(Effect.provide(portsFor(parent, run)), Effect.exit, Effect.forkChild)

const untilEnded = <A>(signal: Effect.Effect<A>, fiber: RunFiber): Effect.Effect<Option.Option<A>> =>
  Effect.raceFirst(Effect.asSome(signal), Effect.as(Fiber.await(fiber), Option.none<A>()))

type Ended = 'succeeded' | 'failed'

const endedOf = (exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError | PlatformError>): Ended =>
  Exit.isSuccess(exit) ? 'succeeded' : 'failed'

const writeProject = (): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.makeDirectory(path.join(root, 'test'), { recursive: true })
    yield* fs.writeFileString(
      path.join(root, 'src/math.ts'),
      'export const add = (left: number, right: number): number => left + right\n',
    )
    yield* fs.writeFileString(
      path.join(root, 'test/math.test.mjs'),
      [
        "import { expect, test } from 'vitest'",
        "import { add } from '../src/math.ts'",
        '',
        "test('adds one and one', () => {",
        '  expect(add(1, 1)).toBe(2)',
        '})',
      ].join('\n'),
    )
    return root
  })

const inProject = <A, E, R>(
  body: (parent: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* writeProject()
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = globalThis.process.cwd()
        globalThis.process.chdir(root)
        return previous
      }),
      () => body(path.resolve(TEMP_DIR_NAME)),
      (previous) =>
        Effect.sync(() => {
          globalThis.process.chdir(previous)
        }),
    ).pipe(Effect.ensuring(Effect.ignore(fs.remove(root, { recursive: true }))))
  })

interface Boundary {
  readonly k: number
  readonly held: Ended
  readonly injected: Ended
  readonly sandboxIntact: boolean
  readonly parentLeft: boolean
}

type Interleave = (
  parent: string,
  k: number,
) => Effect.Effect<Option.Option<Boundary>, PlatformError, FileSystem.FileSystem>

const markerIn = (sandbox: string): string => `${sandbox}/${MARKER_FILE}`

const markSandbox = (sandbox: Option.Option<string>): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Option.match(sandbox, {
    onNone: () => Effect.succeed(false),
    onSome: (directory) =>
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.writeFileString(markerIn(directory), 'mine\n')).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      ),
  })

const markerSurvives = (sandbox: Option.Option<string>): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Option.match(sandbox, {
    onNone: () => Effect.succeed(false),
    onSome: (directory) =>
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(markerIn(directory))).pipe(
        Effect.orElseSucceed(() => false),
      ),
  })

const boundaryOf = (
  parent: string,
  k: number,
  ends: { readonly held: RunFiber; readonly injected: RunFiber },
  sandboxIntact: boolean,
): Effect.Effect<Boundary, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const held = endedOf(yield* Fiber.join(ends.held))
    const injected = endedOf(yield* Fiber.join(ends.injected))
    const fs = yield* FileSystem.FileSystem
    return { k, held, injected, sandboxIntact, parentLeft: yield* fs.exists(parent) }
  })

const onlyWhenReached = (reached: Option.Option<void>, boundary: Boundary): Option.Option<Boundary> =>
  Option.map(reached, () => boundary)

const withReleased = <A, E, R>(runs: ReadonlyArray<Run>, body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  body.pipe(Effect.ensuring(releaseAll(runs)))

const cleanupHeldAcquisitionInjected: Interleave = (parent, k) =>
  Effect.gen(function*() {
    const hold = yield* makeHold('cleanup', k)
    const heldRun = yield* makeRun(Option.some(hold), false)
    const injectedRun = yield* makeRun(Option.none(), true)
    return yield* withReleased(
      [heldRun, injectedRun],
      Effect.gen(function*() {
        const held = yield* startRun(parent, heldRun)
        const reached = yield* untilEnded(Deferred.await(hold.reached), held)
        const injected = yield* startRun(parent, injectedRun)
        const sandbox = yield* untilEnded(Deferred.await(injectedRun.acquired), injected)
        yield* markSandbox(sandbox)
        yield* Deferred.succeed(hold.release, undefined)
        yield* Fiber.await(held)
        const intact = yield* markerSurvives(sandbox)
        yield* Deferred.succeed(injectedRun.afterAcquired, undefined)
        return onlyWhenReached(reached, yield* boundaryOf(parent, k, { held, injected }, intact))
      }),
    )
  })

const acquisitionHeldCleanupInjected: Interleave = (parent, k) =>
  Effect.gen(function*() {
    const injectedHold = yield* makeHold('cleanup', 0)
    const hold = yield* makeHold('acquisition', k)
    const injectedRun = yield* makeRun(Option.some(injectedHold), false)
    const heldRun = yield* makeRun(Option.some(hold), true)
    return yield* withReleased(
      [heldRun, injectedRun],
      Effect.gen(function*() {
        const injected = yield* startRun(parent, injectedRun)
        yield* untilEnded(Deferred.await(injectedHold.reached), injected)
        const held = yield* startRun(parent, heldRun)
        const reached = yield* untilEnded(Deferred.await(hold.reached), held).pipe(
          Effect.raceFirst(Effect.as(Deferred.await(heldRun.acquired), Option.none<void>())),
        )
        yield* Deferred.succeed(injectedHold.release, undefined)
        yield* Fiber.await(injected)
        yield* Deferred.succeed(hold.release, undefined)
        const sandbox = yield* untilEnded(Deferred.await(heldRun.acquired), held)
        const writable = yield* markSandbox(sandbox)
        yield* Deferred.succeed(heldRun.afterAcquired, undefined)
        return onlyWhenReached(reached, yield* boundaryOf(parent, k, { held, injected }, writable))
      }),
    )
  })

const cleanupHeldCleanupInjected: Interleave = (parent, k) =>
  Effect.gen(function*() {
    const injectedHold = yield* makeHold('cleanup', 0)
    const hold = yield* makeHold('cleanup', k)
    const injectedRun = yield* makeRun(Option.some(injectedHold), false)
    const heldRun = yield* makeRun(Option.some(hold), false)
    return yield* withReleased(
      [heldRun, injectedRun],
      Effect.gen(function*() {
        const injected = yield* startRun(parent, injectedRun)
        yield* untilEnded(Deferred.await(injectedHold.reached), injected)
        const held = yield* startRun(parent, heldRun)
        const reached = yield* untilEnded(Deferred.await(hold.reached), held)
        yield* Deferred.succeed(injectedHold.release, undefined)
        yield* Fiber.await(injected)
        yield* Deferred.succeed(hold.release, undefined)
        return onlyWhenReached(reached, yield* boundaryOf(parent, k, { held, injected }, true))
      }),
    )
  })

const acquisitionHeldAcquisitionInjected: Interleave = (parent, k) =>
  Effect.gen(function*() {
    const hold = yield* makeHold('acquisition', k)
    const heldRun = yield* makeRun(Option.some(hold), false)
    const injectedRun = yield* makeRun(Option.none(), true)
    return yield* withReleased(
      [heldRun, injectedRun],
      Effect.gen(function*() {
        const held = yield* startRun(parent, heldRun)
        const reached = yield* untilEnded(Deferred.await(hold.reached), held).pipe(
          Effect.raceFirst(Effect.as(Deferred.await(heldRun.acquired), Option.none<void>())),
        )
        const injected = yield* startRun(parent, injectedRun)
        const sandbox = yield* untilEnded(Deferred.await(injectedRun.acquired), injected)
        yield* markSandbox(sandbox)
        yield* Deferred.succeed(hold.release, undefined)
        yield* untilEnded(Deferred.await(heldRun.acquired), held)
        const intact = yield* markerSurvives(sandbox)
        yield* Deferred.succeed(injectedRun.afterAcquired, undefined)
        return onlyWhenReached(reached, yield* boundaryOf(parent, k, { held, injected }, intact))
      }),
    )
  })

interface Walk {
  readonly boundaries: ReadonlyArray<Boundary>
  readonly exhausted: boolean
}

const walkFrom = (
  interleave: Interleave,
  k: number,
  walked: ReadonlyArray<Boundary>,
): Effect.Effect<Walk, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.flatMap(inProject((parent) => interleave(parent, k)), (next) =>
    Option.match(next, {
      onNone: () => Effect.succeed({ boundaries: walked, exhausted: true }),
      onSome: (boundary) =>
        k + 1 < MAX_BOUNDARIES
          ? walkFrom(interleave, k + 1, [...walked, boundary])
          : Effect.succeed({ boundaries: [...walked, boundary], exhausted: false }),
    }))

const sound = (boundary: Boundary): Boundary => ({
  k: boundary.k,
  held: 'succeeded',
  injected: 'succeeded',
  sandboxIntact: true,
  parentLeft: false,
})

const PAIRS = [
  { pair: 'one run cleans up while another acquires its sandbox', interleave: cleanupHeldAcquisitionInjected },
  { pair: 'one run acquires its sandbox while another cleans up', interleave: acquisitionHeldCleanupInjected },
  { pair: 'two runs clean up at once', interleave: cleanupHeldCleanupInjected },
  { pair: 'two runs acquire their sandboxes at once', interleave: acquisitionHeldAcquisitionInjected },
] as const

Feature('Concurrent runs that share one sandbox directory', { timeout: 600_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the scenario runs two real Stryker runs in one project and schedules their real filesystem calls')
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'When <pair>, at every step the held run takes, both runs keep a working sandbox and leave no sandbox directory',
      PAIRS,
      (row) =>
        Gherkin.Do.pipe(
          Given(`${row.pair}, placed before each filesystem step of the held run in turn`)(
            'walk',
            () => walkFrom(row.interleave, 0, []),
          ),
          Then('both runs succeed with their sandboxes intact at every step, and the shared directory is gone')((
            s,
            expect,
          ) =>
            Effect.sync(() =>
              expect({
                exhausted: s.walk.exhausted,
                stepsWalked: s.walk.boundaries.length > 0,
                boundaries: s.walk.boundaries,
              }).toEqual({
                exhausted: true,
                stepsWalked: true,
                boundaries: s.walk.boundaries.map(sound),
              })
            )
          ),
        ),
    )
  })
