import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Console from 'effect/Console'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
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
    const ports = Engine.nodePlatformLayer
    const logs: string[] = []
    const layer = Layer.mergeAll(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(root), queue), ports),
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
  decidedPerRun: 0,
}

const copyReport = (
  from: string,
  to: string,
  file: string = INCREMENTAL_FILE,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.join(to, file)
    const text = yield* fs.readFileString(path.join(from, INCREMENTAL_FILE))
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* fs.writeFileString(target, text)
  }).pipe(Effect.orDie)

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

const INCREMENTAL_FILE = 'reports/main.json'

const PER_TEST_CONFIG = `export default {
  testRunner: 'vm',
  plugins: [],
  reporters: [],
  checkers: [],
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: '${INCREMENTAL_FILE}',
}
`

const PER_TEST_FILES: ReadonlyArray<readonly [string, string]> = [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['stryker.config.mjs', PER_TEST_CONFIG],
  [
    'src/math.js',
    ['function add(left, right) {', '  return left + right;', '}', '', 'module.exports = { add };', ''].join('\n'),
  ],
  [
    'src/other.js',
    ['function label() {', "  return 'left' + 'right';", '}', '', 'module.exports = { label };', ''].join('\n'),
  ],
  [
    'test/passing.test.mjs',
    [
      "import { test } from 'vitest'",
      "import math from '../src/math.js'",
      '',
      "test('executes add without asserting on its result', () => {",
      '  math.add(1, 2)',
      '})',
      '',
    ].join('\n'),
  ],
  [
    'test/killing.test.mjs',
    [
      "import { expect, test } from 'vitest'",
      "import math from '../src/math.js'",
      '',
      "test('adds two numbers', () => {",
      '  expect(math.add(1, 2)).toBe(3)',
      '})',
      '',
    ].join('\n'),
  ],
]

const writePerTestFixture: Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectory()
  yield* writeFiles(root, PER_TEST_FILES)
  yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(root, 'node_modules'))
  return root
}).pipe(Effect.orDie)

const withChdir = <A, E, R>(directory: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(directory)
      return previous
    }),
    () => effect,
    (previous) => Effect.sync(() => globalThis.process.chdir(previous)),
  )

interface PerTestRun {
  readonly statuses: Readonly<Record<string, number>>
  readonly logs: readonly string[]
}

const statusCountsOf = (events: ReadonlyArray<RunEvent.RunEvent>): Readonly<Record<string, number>> =>
  events.reduce<Readonly<Record<string, number>>>(
    (counts, event) =>
      S.is(RunEvent.RunMutantTested)(event)
        ? { ...counts, [event.status]: (counts[event.status] ?? 0) + 1 }
        : counts,
    {},
  )

type PlatformPorts = Layer.Layer<Layer.Success<typeof Engine.nodePlatformLayer>>

const perTestLayerOf = (root: string, logs: string[], ports: PlatformPorts = Engine.nodePlatformLayer) =>
  Effect.map(Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND), (queue) => ({
    queue,
    layer: Layer.mergeAll(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(root), queue), ports),
      ports,
      Logger.layer([
        Logger.make((entry) => {
          logs.push([entry.message].flat().map(String).join(' '))
        }),
      ]),
    ),
  }))

const runPerTest = (
  root: string,
  cliOptions: Options.PartialStrykerOptions = {},
): Effect.Effect<PerTestRun, never, never> =>
  withChdir(
    root,
    Effect.gen(function*() {
      const logs: string[] = []
      const { queue, layer } = yield* perTestLayerOf(root, logs)
      yield* Engine.mutationTestCell
        .run({ cliOptions, targetMutatePatterns: undefined })
        .pipe(Effect.provide(layer), Effect.scoped, Effect.orDie)
      const events = yield* Queue.end(queue).pipe(
        Effect.andThen(Queue.takeAll(queue)),
        Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
      )
      return { statuses: statusCountsOf(events), logs }
    }),
  )

const reusedCoverageIn = (run: PerTestRun): boolean =>
  run.logs.some((line) => line.includes('Reusing the persisted dry-run coverage'))

const refusedCoverageIn = (run: PerTestRun, reason: string): boolean =>
  run.logs.some((line) => line.includes(`dry-run coverage reuse refused (${reason})`))

const checkpointWithCoverage = (text: string): boolean =>
  Option.exists(
    S.decodeOption(S.fromJsonString(Engine.IncrementalReportSchema))(text),
    (report) =>
      report['framework'] === undefined &&
      report.dryRunCoverage !== undefined &&
      Object.values(report.files).some((file) => file.mutants.some((mutant) => mutant.status === 'Pending')),
  )

const holdAfterFirstCheckpoint = (
  base: FileSystem.FileSystem,
  to: string,
  landed: Deferred.Deferred<string>,
) =>
  base.readFileString(to).pipe(
    Effect.flatMap((text) => checkpointWithCoverage(text) ? Deferred.succeed(landed, text) : Effect.succeed(false)),
    Effect.flatMap((first) => first ? Effect.never : Effect.void),
  )

const holdingFileSystemLayer = (landed: Deferred.Deferred<string>): Layer.Layer<FileSystem.FileSystem> =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (base): FileSystem.FileSystem => ({
      ...base,
      rename: (from, to) =>
        base.rename(from, to).pipe(
          Effect.andThen(to === INCREMENTAL_FILE ? holdAfterFirstCheckpoint(base, to, landed) : Effect.void),
        ),
    })),
  ).pipe(Layer.provide(NodeFileSystem.layer))

const interruptAtFirstCheckpoint = (root: string): Effect.Effect<string, never, never> =>
  withChdir(
    root,
    Effect.gen(function*() {
      const landed = yield* Deferred.make<string>()
      const ports = Layer.merge(Engine.nodePlatformLayer, holdingFileSystemLayer(landed))
      const { layer } = yield* perTestLayerOf(root, [], ports)
      const fiber = yield* Engine.mutationTestCell
        .run({ cliOptions: {}, targetMutatePatterns: undefined })
        .pipe(Effect.provide(layer), Effect.scoped, Effect.exit, Effect.forkChild)
      const checkpoint = yield* Effect.race(Deferred.await(landed), Effect.as(Fiber.await(fiber), ''))
      yield* Fiber.interrupt(fiber)
      return checkpoint
    }).pipe(Effect.orDie),
  )

type Json = S.Schema.Type<typeof S.Json>

type JsonRecord = { readonly [key: string]: Json }

const isJsonRecord = (value: Json | undefined): value is JsonRecord => S.is(S.Record(S.String, S.Json))(value)

const isJsonArray = (value: Json | undefined): value is readonly Json[] => S.is(S.Array(S.Json))(value)

const merged = (record: JsonRecord, fields: JsonRecord): JsonRecord =>
  Object.fromEntries([...Object.entries(record), ...Object.entries(fields)])

const withCoverage = (change: (coverage: JsonRecord) => JsonRecord) => (report: Json): Json => {
  const coverage = isJsonRecord(report) ? report['dryRunCoverage'] : undefined
  return isJsonRecord(report) && isJsonRecord(coverage) ? merged(report, { dryRunCoverage: change(coverage) }) : report
}

const withoutKeys = (keys: readonly string[]) => (value: JsonRecord): JsonRecord =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))

const STALE_TEST_MILLIS = 600_000

const staleCoverage = (coverage: JsonRecord): JsonRecord => {
  const tests = coverage['tests']
  return merged(coverage, {
    runInputsDigest: 'stale',
    tests: isJsonArray(tests)
      ? tests.map((test) => isJsonRecord(test) ? merged(test, { timeSpentMs: STALE_TEST_MILLIS }) : test)
      : [],
  })
}

const withoutVerdicts = (report: Json): Json => isJsonRecord(report) ? merged(report, { files: {}, costs: {} }) : report

const withGlobalTestInput = (file: string) => (coverage: JsonRecord): JsonRecord =>
  merged(coverage, { globalTestInputs: [file] })

const rewriteReport = (
  root: string,
  file: string,
  change: (report: Json) => Json,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.join(root, file)
    const report = yield* S.decodeEffect(S.fromJsonString(S.Json))(yield* fs.readFileString(target))
    yield* fs.writeFileString(target, yield* S.encodeEffect(S.fromJsonString(S.Json))(change(report)))
  }).pipe(Effect.orDie)

const OTHER_ROOT_SOURCE = 'reports/other-root.json'

const STALE_SOURCE = 'reports/stale.json'

const OWN_SOURCE = 'reports/own.json'

const PLAN_OUT = 'plan.json'

const writeSourcesConfig = (
  root: string,
  sources: readonly string[],
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  writeFiles(root, [[
    'stryker.config.mjs',
    PER_TEST_CONFIG.replace(
      '  incremental: true,',
      `  incremental: true,\n  incrementalSources: ${JSON.stringify(sources)},\n  ignorePatterns: ${
        JSON.stringify([...sources, PLAN_OUT])
      },`,
    ),
  ]])

const refusalNaming = (run: PerTestRun, fragment: string): boolean =>
  run.logs.some((line) => line.includes('(rootChanged)') && line.includes(fragment))

const PLAN_REQUEST = {
  targetSeconds: 1,
  maxShards: 4,
  projects: ['.'],
  out: PLAN_OUT,
  full: false,
} satisfies Engine.PlanRequestInput['request']

const shardPlanOf = (root: string): Effect.Effect<RunEvent.PlanKnown['shardPlan'], never, never> =>
  withChdir(
    root,
    Effect.gen(function*() {
      const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
      const consoleService = yield* Console.Console
      yield* Engine.planRequest({
        request: PLAN_REQUEST,
        channel: {
          environment: {
            basePath: root,
            host: { env: environmentFor(root), events: queue },
            console: consoleService,
          },
        },
      }).pipe(Effect.provide(Engine.nodePlatformLayer))
      const events = [
        ...(yield* Queue.takeAll(queue).pipe(
          Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
        )),
      ]
      const plan = events.find((event): event is RunEvent.PlanKnown => S.is(RunEvent.PlanKnown)(event))
      return plan === undefined ? null : plan.shardPlan
    }).pipe(Effect.orDie),
  )

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
      "A project moved to another root does not score its mutants from the first root's coverage",
      Gherkin.Do.pipe(
        Given('the reports of roots A and C copied into root B after A and C are deleted')(
          'observed',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const rootA = yield* writePerTestFixture
              const rootB = yield* writePerTestFixture
              const rootC = yield* writePerTestFixture
              const realA = yield* fs.realPath(rootA)
              const realB = yield* fs.realPath(rootB)
              const realC = yield* fs.realPath(rootC)
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const first = yield* runPerTest(rootA)
                  yield* runPerTest(rootC)
                  yield* copyReport(rootC, rootB)
                  yield* copyReport(rootA, rootB, OTHER_ROOT_SOURCE)
                  yield* removeFixture(rootA)
                  yield* removeFixture(rootC)
                  const second = yield* runPerTest(rootB, { incrementalSources: [OTHER_ROOT_SOURCE] })
                  return { recordedRoots: [realA, realC].sort().join(', '), realB, first, second }
                }),
                Effect.andThen(Effect.andThen(removeFixture(rootA), removeFixture(rootB)), removeFixture(rootC)),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then(
          'root B refuses the coverage naming both recorded roots sorted, runs its own dry run, and scores its mutants as root A did',
        )(
          (s, expect) =>
            expect({
              firstKilled: (s.observed.first.statuses['Killed'] ?? 0) > 0,
              firstNoCoverage: (s.observed.first.statuses['NoCoverage'] ?? 0) > 0,
              secondStatuses: s.observed.second.statuses,
              secondReusedCoverage: reusedCoverageIn(s.observed.second),
              namedCurrentRoot: refusalNaming(s.observed.second, `current project root:   ${s.observed.realB}`),
              namedRecordedRoots: refusalNaming(
                s.observed.second,
                `recorded project roots: ${s.observed.recordedRoots}\n`,
              ),
              namedOwnRecording: refusalNaming(s.observed.second, `records its coverage under ${s.observed.realB}.`),
              namedCrossMachineRule: refusalNaming(
                s.observed.second,
                'Coverage is shared across machines only when they run from the same absolute workspace path.',
              ),
            }).toEqual({
              firstKilled: true,
              firstNoCoverage: true,
              secondStatuses: s.observed.first.statuses,
              secondReusedCoverage: false,
              namedCurrentRoot: true,
              namedRecordedRoots: true,
              namedOwnRecording: true,
              namedCrossMachineRule: true,
            }),
        ),
      ),
    )

    scenario(
      "Shard planning under another root does not price the plan from the first root's coverage",
      Gherkin.Do.pipe(
        Given("root B planned with root A's copied report and again once the report is removed")(
          'observed',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const rootA = yield* writePerTestFixture
              const rootB = yield* writePerTestFixture
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  yield* runPerTest(rootA)
                  yield* copyReport(rootA, rootB)
                  yield* removeFixture(rootA)
                  const withReport = yield* shardPlanOf(rootB)
                  yield* fs.remove(path.join(rootB, 'reports'), { recursive: true })
                  const withoutReport = yield* shardPlanOf(rootB)
                  return { withReport, withoutReport }
                }),
                Effect.andThen(removeFixture(rootA), removeFixture(rootB)),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('both plans are the same whole shard plan')((s, expect) =>
          expect({
            planned: s.observed.withoutReport !== null,
            withReport: s.observed.withReport,
          }).toEqual({
            planned: true,
            withReport: s.observed.withoutReport,
          })
        ),
      ),
    )

    scenario(
      'Among reports restored from several roots, the run and the plan both use the current-root coverage that still matches',
      Gherkin.Do.pipe(
        Given(
          "root B holding, in order, root A's report naming a global test input under A, its own report made stale, and its own report, none carrying verdicts",
        )(
          'observed',
          () =>
            Effect.gen(function*() {
              const rootA = yield* writePerTestFixture
              const rootB = yield* writePerTestFixture
              yield* writeSourcesConfig(rootB, [STALE_SOURCE, OWN_SOURCE])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  yield* runPerTest(rootA)
                  yield* runPerTest(rootB)
                  yield* rewriteReport(
                    rootA,
                    INCREMENTAL_FILE,
                    (report) =>
                      withCoverage(withGlobalTestInput(`${rootA}/stryker.config.mjs`))(withoutVerdicts(report)),
                  )
                  yield* rewriteReport(rootB, INCREMENTAL_FILE, withoutVerdicts)
                  const ownOnly = yield* shardPlanOf(rootB)
                  yield* copyReport(rootB, rootB, OWN_SOURCE)
                  yield* copyReport(rootB, rootB, STALE_SOURCE)
                  yield* rewriteReport(rootB, STALE_SOURCE, withCoverage(staleCoverage))
                  yield* copyReport(rootA, rootB)
                  const restored = yield* shardPlanOf(rootB)
                  const run = yield* runPerTest(rootB)
                  return { ownOnly, restored, run }
                }),
                Effect.andThen(removeFixture(rootA), removeFixture(rootB)),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then(
          "the run reuses B's matching coverage and counts A's report as skipped, and the plan prices from that same coverage",
        )((s, expect) =>
          expect({
            reused: reusedCoverageIn(s.observed.run),
            skippedOtherRoot: s.observed.run.logs.some((line) =>
              line.includes(
                'Skipped saved dry-run coverage: 1 recorded under another project root, 0 with no recorded root',
              )
            ),
            planned: s.observed.ownOnly !== null,
            restoredPlan: s.observed.restored,
          }).toEqual({
            reused: true,
            skippedOtherRoot: true,
            planned: true,
            restoredPlan: s.observed.ownOnly,
          })
        ),
      ),
    )

    scenario(
      'A run interrupted after its first checkpoint leaves coverage the next run under the same root reuses',
      Gherkin.Do.pipe(
        Given('a run under root A held and interrupted once its first checkpoint with coverage lands')(
          'observed',
          () =>
            Effect.gen(function*() {
              const root = yield* writePerTestFixture
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const checkpoint = yield* interruptAtFirstCheckpoint(root)
                  const next = yield* runPerTest(root)
                  return { checkpoint, next }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then("the next run under A reuses the interrupted run's coverage")((s, expect) =>
          expect({
            interruptedAtCheckpoint: s.observed.checkpoint.length > 0,
            reused: reusedCoverageIn(s.observed.next),
          }).toEqual({ interruptedAtCheckpoint: true, reused: true })
        ),
      ),
    )

    scenario(
      'A dry-run-only run leaves coverage the next run under the same root reuses',
      Gherkin.Do.pipe(
        Given('a dry-run-only run under root A followed by a full run under A')(
          'observed',
          () =>
            Effect.gen(function*() {
              const root = yield* writePerTestFixture
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  yield* runPerTest(root, { dryRunOnly: true })
                  return yield* runPerTest(root)
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then("the full run reuses the dry-run-only run's coverage")((s, expect) =>
          expect({ reused: reusedCoverageIn(s.observed) }).toEqual({ reused: true })
        ),
      ),
    )

    scenario(
      'A legacy report whose coverage records no root costs exactly one dry run, even under the root its header names',
      Gherkin.Do.pipe(
        Given("root A's report with the root removed from its coverage record only, then two runs under A")(
          'observed',
          () =>
            Effect.gen(function*() {
              const root = yield* writePerTestFixture
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  yield* runPerTest(root)
                  yield* rewriteReport(root, INCREMENTAL_FILE, withCoverage(withoutKeys(['projectRoot'])))
                  const first = yield* runPerTest(root)
                  const second = yield* runPerTest(root)
                  return { first, second }
                }),
                removeFixture(root),
              )
            }).pipe(Effect.orDie, Effect.provide(filePorts)),
        ),
        Then('the first run refuses with rootUnrecorded and runs its dry run, and the second run reuses')(
          (s, expect) =>
            expect({
              first: {
                refusedUnrecorded: refusedCoverageIn(s.observed.first, 'rootUnrecorded'),
                namedOlderVersion: s.observed.first.logs.some((line) => line.includes('recorded no project root')),
                reused: reusedCoverageIn(s.observed.first),
              },
              secondReused: reusedCoverageIn(s.observed.second),
            }).toEqual({
              first: { refusedUnrecorded: true, namedOlderVersion: true, reused: false },
              secondReused: true,
            }),
        ),
      ),
    )
  })
