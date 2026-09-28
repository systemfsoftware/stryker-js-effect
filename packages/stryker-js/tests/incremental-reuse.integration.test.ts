import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
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
  allowConsoleColors: false,
})

interface RecordedMutant {
  readonly id: string
  readonly status: string
}

const mutantsOf = (text: string): readonly RecordedMutant[] =>
  Option.match(S.decodeOption(S.fromJsonString(Engine.IncrementalReportSchema))(text), {
    onNone: () => [],
    onSome: (value) => Object.values(value.files).flatMap((file) => file.mutants),
  })

interface RunObservation {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly reuse: RunEvent.ReuseReported | undefined
  readonly mutants: readonly RecordedMutant[]
  readonly incrementalText: string
}

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
    Effect.orDie(
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true })),
    ),
    filePorts,
  )

const runOnce = (root: string, options: Options.PartialStrykerOptions): Effect.Effect<RunObservation, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(root), queue), ports),
      ports,
    )
    const exit = yield* Engine.mutationTestCell
      .run({ cliOptions: options, targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events = [
      ...(yield* Queue.end(queue).pipe(
        Effect.andThen(Queue.takeAll(queue)),
        Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
      )),
    ]
    const incrementalText = yield* fs.readFileString(path.join(root, 'reports', 'main.json')).pipe(
      Effect.orElseSucceed(() => ''),
    )
    const reuse = events.find((event): event is RunEvent.ReuseReported => S.is(RunEvent.ReuseReported)(event))
    return { exit, reuse, mutants: mutantsOf(incrementalText), incrementalText }
  }).pipe(Effect.provide(filePorts))

const optionsOf = (
  root: string,
  extras: Partial<Options.PartialStrykerOptions> = {},
): Options.PartialStrykerOptions => ({
  testRunner: 'command',
  commandRunner: { command: 'true' },
  coverageAnalysis: 'off',
  reporters: [],
  mutate: ['src/**/*.ts'],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${root}/reports/main.json`,
  ...extras,
})

const ZERO_REFUSALS = {
  semanticsChanged: 0,
  policyChanged: 0,
  runInputsChanged: 0,
  closureChanged: 0,
  flakyDependency: 0,
  timeoutUnreproduced: 0,
  noPriorRecord: 0,
}

const statusesOf = (mutants: readonly RecordedMutant[]): readonly string[] =>
  [...mutants].sort((left, right) => left.id.localeCompare(right.id)).map((mutant) => `${mutant.id}:${mutant.status}`)

Feature('Content-keyed reuse across incremental reports')
  .withLayer(Layer.empty)
  .live('the scenarios drive the real engine over the host filesystem, so report I/O is the real one')
  .body(({ scenario }) => {
    scenario(
      'A second run with no change reuses every verdict and reports zero refusals',
      Gherkin.Do.pipe(
        Given('a workspace whose source file is mutated by a command runner')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const root = yield* writeFixture([['src/math.ts', SOURCE]])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = optionsOf(root)
                  const first = yield* runOnce(root, options)
                  const second = yield* runOnce(root, options)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.provide(filePorts)),
        ),
        Then('the first run runs everything and the second reuses everything with no refusal')((s, expect) => {
          const planned = s.fixture.first.mutants.length
          return expect({
            runSucceeded: Exit.isSuccess(s.fixture.second.exit),
            plannedNonZero: planned > 0,
            first: {
              reused: s.fixture.first.reuse?.reused,
              ran: s.fixture.first.reuse?.ran,
              refused: s.fixture.first.reuse?.refused,
            },
            second: {
              reused: s.fixture.second.reuse?.reused,
              ran: s.fixture.second.reuse?.ran,
              refused: s.fixture.second.reuse?.refused,
            },
            statusesStable: statusesOf(s.fixture.first.mutants).join(',') ===
              statusesOf(s.fixture.second.mutants).join(','),
            everyMutantCarriesAClosureDigest: s.fixture.first.incrementalText.split('"closureDigest"').length - 1 ===
              planned,
          }).toEqual({
            runSucceeded: true,
            plannedNonZero: true,
            first: { reused: 0, ran: planned, refused: { ...ZERO_REFUSALS, noPriorRecord: planned } },
            second: { reused: planned, ran: 0, refused: ZERO_REFUSALS },
            statusesStable: true,
            everyMutantCarriesAClosureDigest: true,
          })
        }),
      ),
    )

    scenario(
      'A verdict written under another report path is reused through the incrementalSources globs',
      Gherkin.Do.pipe(
        Given('a workspace whose incremental report has been relocated to a shard path')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeFixture([['src/math.ts', SOURCE]])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = optionsOf(root, { incrementalSources: ['reports/shard-*.json'] })
                  const first = yield* runOnce(root, options)
                  yield* fs.rename(
                    path.join(root, 'reports', 'main.json'),
                    path.join(root, 'reports', 'shard-1.json'),
                  )
                  const second = yield* runOnce(root, options)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the second run reuses the relocated shard report instead of running the mutants again')((s, expect) =>
          expect({
            second: {
              reused: s.fixture.second.reuse?.reused,
              ran: s.fixture.second.reuse?.ran,
              refused: s.fixture.second.reuse?.refused,
            },
            relocatedReportReused: (s.fixture.second.reuse?.reused ?? 0) > 0,
            firstRanEverything: s.fixture.first.reuse?.reused === 0,
          }).toEqual({
            second: { reused: s.fixture.second.mutants.length, ran: 0, refused: ZERO_REFUSALS },
            relocatedReportReused: true,
            firstRanEverything: true,
          })
        ),
      ),
    )

    scenario(
      'A whole-suite mutant is refused when a project file outside its covering set changes',
      Gherkin.Do.pipe(
        Given('a workspace whose mutants run the whole suite and a type-only project file changes in place')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* writeFixture([
                ['src/math.ts', SOURCE],
                ['src/types.ts', 'export type Thing = { readonly name: string }\n'],
              ])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const options = optionsOf(root)
                  const first = yield* runOnce(root, options)
                  yield* fs.writeFileString(
                    path.join(root, 'src', 'types.ts'),
                    'export type Thing = { readonly label: string }\n',
                  )
                  const second = yield* runOnce(root, options)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the second run refuses every prior verdict with closureChanged instead of reusing it')((s, expect) => {
          const planned = s.fixture.first.mutants.length
          return expect({
            plannedNonZero: planned > 0,
            mutantSetUnchanged: statusesOf(s.fixture.first.mutants).join(',') ===
              statusesOf(s.fixture.second.mutants).join(','),
            second: {
              reused: s.fixture.second.reuse?.reused,
              ran: s.fixture.second.reuse?.ran,
              refused: s.fixture.second.reuse?.refused,
            },
          }).toEqual({
            plannedNonZero: true,
            mutantSetUnchanged: true,
            second: { reused: 0, ran: planned, refused: { ...ZERO_REFUSALS, closureChanged: planned } },
          })
        }),
      ),
    )
  })
