import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Ref from 'effect/Ref'
import type * as Scope from 'effect/Scope'
import * as Stdio from 'effect/Stdio'

const Feature = makeFeature({ it })

const TEMP_DIR_NAME = '.stryker-tmp'

const RIVAL_REMOVALS_BELOW_ACQUISITION_RETRIES = 8

const RUNS_PER_SCENARIO = 4

const SENTINEL_RUNS_PER_SCENARIO = 5

const ENTRIES_RACED = 300

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

const RUN_PORTS = Layer.mergeAll(Stdio.layerTest({})).pipe(Layer.provideMerge(Engine.nodePlatformLayer))

const nodeFs = globalThis.process.getBuiltinModule('node:fs/promises')

type Ended = 'succeeded' | 'failed'

interface RemovalCounts {
  readonly beforeFirstEntry: number
  readonly total: number
}

interface RivalledRun {
  readonly ended: Ended
  readonly removals: RemovalCounts
}

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

const projectAsWorkingDirectory: Effect.Effect<
  string,
  PlatformError,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const root = yield* writeProject()
  const previous = yield* Effect.sync(() => {
    const cwd = globalThis.process.cwd()
    globalThis.process.chdir(root)
    return cwd
  })
  yield* Effect.addFinalizer(() => Effect.ignore(fs.remove(root, { recursive: true })))
  yield* Effect.addFinalizer(() => Effect.sync(() => globalThis.process.chdir(previous)))
  return root
})

const holdsEntries = (directory: string): Effect.Effect<boolean> =>
  Effect.promise(() => nodeFs.readdir(directory).then((entries) => entries.length > 0, () => false))

type RemovalAttempt = 'removed' | 'holding' | 'absent'

const attemptEmptyRemoval = (directory: string): Effect.Effect<RemovalAttempt> =>
  Effect.promise(() =>
    nodeFs.rmdir(directory).then(
      (): RemovalAttempt => 'removed',
      (error: { readonly code?: string }): RemovalAttempt => error.code === 'ENOENT' ? 'absent' : 'holding',
    )
  )

const rivalRemovesEmptySharedDirectory = (
  parent: string,
  counts: Ref.Ref<RemovalCounts>,
  heldEntries: Ref.Ref<boolean>,
): Effect.Effect<void> =>
  Effect.gen(function*() {
    const attempt = yield* attemptEmptyRemoval(parent)
    yield* Effect.when(Ref.set(heldEntries, true), Effect.succeed(attempt === 'holding'))
    const alreadyHeld = yield* Ref.get(heldEntries)
    yield* Effect.when(
      Ref.update(counts, (seen) => ({
        beforeFirstEntry: seen.beforeFirstEntry + (attempt === 'removed' && !alreadyHeld ? 1 : 0),
        total: seen.total + (attempt === 'removed' ? 1 : 0),
      })),
      Effect.succeed(attempt === 'removed'),
    )
    yield* Effect.yieldNow
    const spent = yield* Ref.get(counts)
    return yield* spent.total < RIVAL_REMOVALS_BELOW_ACQUISITION_RETRIES
      ? rivalRemovesEmptySharedDirectory(parent, counts, heldEntries)
      : Effect.void
  })

const untilHoldsEntries = (directory: string): Effect.Effect<void> =>
  Effect.flatMap(
    holdsEntries(directory),
    (holds) => holds ? Effect.void : Effect.andThen(Effect.yieldNow, untilHoldsEntries(directory)),
  )

type Rival = (
  parent: string,
  counts: Ref.Ref<RemovalCounts>,
  heldEntries: Ref.Ref<boolean>,
) => Effect.Effect<void>

const rivalFromTheStart: Rival = rivalRemovesEmptySharedDirectory

const rivalAfterAcquisition: Rival = (parent, counts, heldEntries) =>
  Effect.andThen(untilHoldsEntries(parent), rivalRemovesEmptySharedDirectory(parent, counts, heldEntries))

const runAgainst = (parent: string, rival: Rival): Effect.Effect<RivalledRun> =>
  Effect.gen(function*() {
    const counts = yield* Ref.make<RemovalCounts>({ beforeFirstEntry: 0, total: 0 })
    const heldEntries = yield* Ref.make(false)
    const rivalFiber = yield* Effect.forkChild(rival(parent, counts, heldEntries))
    const exit = yield* Engine.strykerCell(RUN_OPTIONS).pipe(Effect.provide(RUN_PORTS), Effect.exit)
    yield* Fiber.interrupt(rivalFiber)
    return { ended: Exit.isSuccess(exit) ? 'succeeded' : 'failed', removals: yield* Ref.get(counts) }
  })

interface RivalledRuns {
  readonly ended: ReadonlyArray<Ended>
  readonly rivalRemovalsBeforeFirstEntry: number
  readonly parentLeft: boolean
}

const runsAgainst = (rival: Rival): Effect.Effect<RivalledRuns, PlatformError, FileSystem.FileSystem | Path.Path> =>
  inProject((parent) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const runs = yield* Effect.forEach(Array.from({ length: RUNS_PER_SCENARIO }), () => runAgainst(parent, rival))
      return {
        ended: runs.map((run) => run.ended),
        rivalRemovalsBeforeFirstEntry: runs.reduce((total, run) => total + run.removals.beforeFirstEntry, 0),
        parentLeft: yield* fs.exists(parent),
      }
    })
  )

const EVERY_RUN_SUCCEEDED: ReadonlyArray<Ended> = Array.from({ length: RUNS_PER_SCENARIO }, () => 'succeeded')

const EVERY_SENTINEL_RUN_SUCCEEDED: ReadonlyArray<Ended> = Array.from(
  { length: SENTINEL_RUNS_PER_SCENARIO },
  () => 'succeeded',
)

interface EntryChurn {
  readonly held: number
  readonly lost: number
}

const rivalHoldsEntriesInSharedDirectory = (parent: string, churn: Ref.Ref<EntryChurn>): Effect.Effect<void> =>
  Effect.gen(function*() {
    const { held } = yield* Ref.get(churn)
    const entry = `${parent}/entry-${held}`
    const created = yield* Effect.promise(() =>
      nodeFs.mkdir(parent, { recursive: true }).then(() => nodeFs.writeFile(entry, 'held\n')).then(
        () => true,
        () => false,
      )
    )
    yield* Effect.yieldNow
    const survived = yield* Effect.promise(() => nodeFs.access(entry).then(() => true, () => false))
    yield* Effect.when(
      Ref.update(churn, (counts) => ({ held: counts.held + 1, lost: counts.lost + (survived ? 0 : 1) })),
      Effect.succeed(created),
    )
    yield* Effect.promise(() => nodeFs.rm(entry, { force: true }))
    return yield* rivalHoldsEntriesInSharedDirectory(parent, churn)
  })

const removeIfEmptyUntilRaced = (
  parent: string,
  churn: Ref.Ref<EntryChurn>,
): Effect.Effect<void, never, Engine.EmptyDirectory> =>
  Effect.gen(function*() {
    const emptyDirectory = yield* Engine.EmptyDirectory
    yield* Effect.ignore(emptyDirectory.removeIfEmpty(parent))
    yield* Effect.yieldNow
    const { held } = yield* Ref.get(churn)
    return yield* held < ENTRIES_RACED ? removeIfEmptyUntilRaced(parent, churn) : Effect.void
  })

const raceRemovalsAgainstChurn = (
  parent: string,
): Effect.Effect<EntryChurn, never, Engine.EmptyDirectory> =>
  Effect.gen(function*() {
    const churn = yield* Ref.make<EntryChurn>({ held: 0, lost: 0 })
    const churnFiber = yield* Effect.forkChild(rivalHoldsEntriesInSharedDirectory(parent, churn))
    yield* removeIfEmptyUntilRaced(parent, churn)
    yield* Fiber.interrupt(churnFiber)
    return yield* Ref.get(churn)
  })

interface SentinelledRuns {
  readonly ended: ReadonlyArray<Ended>
  readonly held: number
  readonly lost: number
}

const runsWhileRivalHoldsSentinels: Effect.Effect<SentinelledRuns, never, Path.Path> = Effect.gen(function*() {
  const path = yield* Path.Path
  const parent = path.resolve(TEMP_DIR_NAME)
  const churn = yield* Ref.make<EntryChurn>({ held: 0, lost: 0 })
  const churnFiber = yield* Effect.forkChild(rivalHoldsEntriesInSharedDirectory(parent, churn))
  const ended = yield* Effect.forEach(
    Array.from({ length: SENTINEL_RUNS_PER_SCENARIO }),
    () =>
      Engine.strykerCell(RUN_OPTIONS).pipe(
        Effect.provide(RUN_PORTS),
        Effect.exit,
        Effect.map((exit): Ended => Exit.isSuccess(exit) ? 'succeeded' : 'failed'),
      ),
    { concurrency: 2 },
  )
  yield* Fiber.interrupt(churnFiber)
  const { held, lost } = yield* Ref.get(churn)
  return { ended, held, lost }
})

type Removal = 'succeeded' | 'failed'

const removalOf = (parent: string): Effect.Effect<Removal, never, Engine.EmptyDirectory> =>
  Effect.flatMap(Engine.EmptyDirectory, (emptyDirectory) =>
    emptyDirectory.removeIfEmpty(parent).pipe(
      Effect.as<Removal>('succeeded'),
      Effect.orElseSucceed((): Removal => 'failed'),
    ))

interface RemovalTargets {
  readonly empty: string
  readonly holding: string
  readonly absent: string
  readonly file: string
  readonly linked: string
  readonly symlink: string
}

interface RemovalOutcomes {
  readonly empty: { readonly removal: Removal; readonly left: boolean }
  readonly holding: { readonly removal: Removal; readonly left: boolean; readonly entry: string }
  readonly absent: { readonly removal: Removal }
  readonly file: { readonly removal: Removal; readonly left: boolean }
  readonly symlink: { readonly removal: Removal; readonly left: boolean; readonly targetLeft: boolean }
}

const scratchDirectory: Effect.Effect<string, PlatformError, FileSystem.FileSystem | Scope.Scope> = Effect.flatMap(
  FileSystem.FileSystem,
  (fs) => Effect.acquireRelease(fs.makeTempDirectory(), (root) => Effect.ignore(fs.remove(root, { recursive: true }))),
)

const removalTargets: Effect.Effect<RemovalTargets, PlatformError, FileSystem.FileSystem | Scope.Scope> = Effect.gen(
  function*() {
    const fs = yield* FileSystem.FileSystem
    const root = yield* scratchDirectory
    const targets = {
      empty: `${root}/empty`,
      holding: `${root}/holding`,
      absent: `${root}/absent`,
      file: `${root}/file`,
      linked: `${root}/linked`,
      symlink: `${root}/symlink`,
    }
    yield* fs.makeDirectory(targets.empty)
    yield* fs.makeDirectory(targets.holding)
    yield* fs.writeFileString(`${targets.holding}/sandbox-entry.txt`, 'held\n')
    yield* fs.writeFileString(targets.file, 'not a directory\n')
    yield* fs.makeDirectory(targets.linked)
    yield* Effect.promise(() => nodeFs.symlink(targets.linked, targets.symlink))
    return targets
  },
)

const removalOutcomes = (
  targets: RemovalTargets,
): Effect.Effect<RemovalOutcomes, PlatformError, Engine.EmptyDirectory | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const emptyRemoval = yield* removalOf(targets.empty)
    const holdingRemoval = yield* removalOf(targets.holding)
    const absentRemoval = yield* removalOf(targets.absent)
    const fileRemoval = yield* removalOf(targets.file)
    const symlinkRemoval = yield* removalOf(targets.symlink)
    return {
      empty: { removal: emptyRemoval, left: yield* fs.exists(targets.empty) },
      holding: {
        removal: holdingRemoval,
        left: yield* fs.exists(targets.holding),
        entry: yield* fs.readFileString(`${targets.holding}/sandbox-entry.txt`),
      },
      absent: { removal: absentRemoval },
      file: { removal: fileRemoval, left: yield* fs.exists(targets.file) },
      symlink: {
        removal: symlinkRemoval,
        left: yield* fs.exists(targets.symlink),
        targetLeft: yield* fs.exists(targets.linked),
      },
    }
  })

const RIVALS = [
  {
    moment: 'its sandbox is being made',
    precondition: 'removes the shared directory each time it finds it empty',
    rival: rivalFromTheStart,
    expectsAcquisitionRace: true,
  },
  {
    moment: 'its cleanup has just emptied the shared directory',
    precondition: 'waits until the run holds a sandbox, then removes the shared directory each time it finds it empty',
    rival: rivalAfterAcquisition,
    expectsAcquisitionRace: false,
  },
] as const

Feature('Running several Stryker dry runs that share one temporary directory', { timeout: 600_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('real Stryker runs on a real project, raced by another run acting on the same directory on disk')
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'A run finishes with a working sandbox when another run removes the shared directory while <moment>',
      RIVALS,
      (row) =>
        Gherkin.Do.pipe(
          Given(`another run ${row.precondition}`)('rival', () => Effect.succeed(row.rival)),
          When('four runs of one project start one after the other')('runs', (s) => runsAgainst(s.rival)),
          Then(
            'every run succeeds, the other run does remove the directory while the sandbox is being made in the row that races acquisition, and no shared directory is left',
          )((s, expect) =>
            expect({
              ended: s.runs.ended,
              parentLeft: s.runs.parentLeft,
              ...(row.expectsAcquisitionRace
                ? { racedAcquisition: s.runs.rivalRemovalsBeforeFirstEntry > 0 }
                : {}),
            }).toEqual({
              ended: EVERY_RUN_SUCCEEDED,
              parentLeft: false,
              ...(row.expectsAcquisitionRace ? { racedAcquisition: true } : {}),
            })
          ),
        ),
    )

    scenario(
      'Removing the shared directory when it is empty never takes a file another run keeps in it',
      Gherkin.Do.pipe(
        Given('a shared temporary directory that another run keeps adding a file to and checking it is still there')(
          'shared',
          () => Effect.map(scratchDirectory, (root) => `${root}/${TEMP_DIR_NAME}`),
        ),
        When('the shared directory is removed-if-empty over and over until the other run has kept three hundred files')(
          'churn',
          (s) => raceRemovalsAgainstChurn(s.shared),
        ),
        Then('the other run kept files throughout and never lost one')((s, expect) =>
          expect({ held: s.churn.held >= ENTRIES_RACED, lost: s.churn.lost }).toEqual({ held: true, lost: 0 })
        ),
      ),
    )

    scenario(
      'Real runs sharing a temporary directory never take a file another run keeps in it',
      Gherkin.Do.pipe(
        Given('a real project whose runs share one temporary directory')('project', () => projectAsWorkingDirectory),
        When(
          'several of its runs run at once while another run keeps adding a file to that directory and checking it is still there',
        )('runs', () => runsWhileRivalHoldsSentinels),
        Then('every run succeeds and the other run never lost a file')((s, expect) =>
          expect({ ended: s.runs.ended, raced: s.runs.held > 0, lost: s.runs.lost }).toEqual({
            ended: EVERY_SENTINEL_RUN_SUCCEEDED,
            raced: true,
            lost: 0,
          })
        ),
      ),
    )

    scenario(
      'Removing a directory only when it is empty leaves anything else in place',
      Gherkin.Do.pipe(
        Given(
          'an empty directory, a directory holding a file, a path with nothing at it, a plain file, and a symlink to a directory',
        )('targets', () => removalTargets),
        When('each is removed-if-empty once')('outcomes', (s) => removalOutcomes(s.targets)),
        Then(
          'the empty directory is gone, the other directory stays with its file, the missing path is fine, and the plain file and the symlink are left in place',
        )((s, expect) =>
          expect(s.outcomes).toEqual({
            empty: { removal: 'succeeded', left: false },
            holding: { removal: 'succeeded', left: true, entry: 'held\n' },
            absent: { removal: 'succeeded' },
            file: { removal: 'succeeded', left: true },
            symlink: { removal: 'succeeded', left: true, targetLeft: true },
          })
        ),
      ),
    )
  })
