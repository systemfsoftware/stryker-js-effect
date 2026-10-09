import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent, ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const REPORT_FILE = 'reports/stryker-incremental.json'
const PLAN_FILE = 'plan.json'

const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  checkers: [],
  reporters: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: '${REPORT_FILE}',
}
`

const FILES: Readonly<Record<string, string>> = {
  'package.json': '{ "name": "fixed-cost-consumer", "type": "module", "private": true }\n',
  'stryker.config.mjs': CONFIG,
  'src/math.js': 'export const add = (a, b) => a + b\nexport const sub = (a, b) => a - b\n',
}

const OVERLAPPING_CONFIG = CONFIG
  .replace(`command: 'true'`, `command: 'sleep 0.4'`)
  .replace(`checkers: [],`, `checkers: [],\n  concurrency: 4,`)

const OVERLAPPING_FILES: Readonly<Record<string, string>> = {
  ...FILES,
  'stryker.config.mjs': OVERLAPPING_CONFIG,
  'src/math.js': [
    'export const add = (a, b) => a + b',
    'export const sub = (a, b) => a - b',
    'export const mul = (a, b) => a * b',
    'export const div = (a, b) => a / b',
    'export const gt = (a, b) => a > b',
    'export const lt = (a, b) => a < b',
    '',
  ].join('\n'),
}

interface Observation {
  readonly fixedSeconds: number | undefined
  readonly plan: ShardPlan
  readonly reused: number
  readonly total: number
}

const writeWorkspace = (files: Readonly<Record<string, string>>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-fixed-cost-' }))
    yield* Effect.forEach(
      Object.entries(files),
      ([name, content]) =>
        Effect.gen(function*() {
          const target = path.join(directory, name)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    return directory
  }).pipe(Effect.orDie)

const environmentFor = (directory: string, runStartedAt: number): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

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

const runOnce = (directory: string) =>
  withChdir(
    directory,
    Effect.gen(function*() {
      const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
      const runLayer = Layer.merge(
        Layer.provide(
          Engine.RunEnvironment.stage(environmentFor(directory, yield* Clock.currentTimeMillis), queue),
          Engine.nodePlatformLayer,
        ),
        Engine.nodePlatformLayer,
      )
      yield* Engine.mutationTestCell
        .run({ cliOptions: {}, targetMutatePatterns: undefined })
        .pipe(Effect.provide(runLayer), Effect.scoped, Effect.orDie)
    }),
  )

const planOnce = (directory: string) =>
  withChdir(
    directory,
    Effect.gen(function*() {
      const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
      yield* Engine.planRequest({
        request: { targetSeconds: 300, maxShards: 4, projects: ['.'], out: PLAN_FILE, full: false },
        channel: {
          environment: {
            basePath: directory,
            host: { env: environmentFor(directory, yield* Clock.currentTimeMillis), events: queue },
            console: yield* Console.Console,
          },
        },
      }).pipe(Effect.provide(Engine.nodePlatformLayer))
      return yield* Queue.takeAll(queue).pipe(Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []))
    }),
  )

interface RecordedRun {
  readonly directory: string
  readonly fixedSeconds: number | undefined
  readonly actualSeconds: number
  readonly summedCostSeconds: number
}

const runIn = (directory: string): Effect.Effect<RecordedRun> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* runOnce(directory)
    const record = yield* S.decodeEffect(
      S.fromJsonString(
        S.Struct({
          fixedSeconds: S.optional(S.Finite),
          budget: S.Struct({ actualSeconds: S.Finite }),
          costs: S.Record(S.String, S.Struct({ actualMs: S.NullOr(S.Finite) })),
        }),
      ),
    )(yield* fs.readFileString(path.join(directory, REPORT_FILE)))
    return {
      directory,
      fixedSeconds: record.fixedSeconds,
      actualSeconds: record.budget.actualSeconds,
      summedCostSeconds: Object.values(record.costs).reduce((total, cost) => total + (cost.actualMs ?? 0), 0) / 1000,
    }
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const removeWorkspace = (directory: string): Effect.Effect<void> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })).pipe(
    Effect.ignore,
    Effect.provide(filePorts),
  )

const recordRun = (files: Readonly<Record<string, string>>): Effect.Effect<RecordedRun> =>
  Effect.flatMap(writeWorkspace(files).pipe(Effect.provide(filePorts)), runIn)

const planRecorded = (recorded: RecordedRun): Effect.Effect<Observation> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const events = yield* planOnce(recorded.directory)
    const known = Option.getOrThrowWith(
      Arr.findFirst(events, S.is(RunEvent.PlanKnown)),
      () => new Error('the plan emitted no PlanKnown event'),
    )
    const plan = Option.getOrThrowWith(
      S.decodeOption(S.fromJsonString(ShardPlan))(yield* fs.readFileString(path.join(recorded.directory, PLAN_FILE))),
      () => new Error('the plan file is not a ShardPlan'),
    )
    return {
      fixedSeconds: recorded.fixedSeconds,
      plan,
      reused: (known.projects ?? []).reduce((sum, project) => sum + project.reused, 0),
      total: known.total,
    }
  }).pipe(
    Effect.ensuring(removeWorkspace(recorded.directory)),
    Effect.orDie,
    Effect.provide(filePorts),
  )

Feature('Pricing the fixed cost of a shard from the incremental record', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('a real run writes the record that the planner then reads')
  .body(({ scenario }) => {
    scenario(
      'A shard holding only remembered mutants is predicted at the fixed cost the last run recorded',
      Gherkin.Do.pipe(
        Given('a project whose mutation run wrote its incremental record')('recorded', () => recordRun(FILES)),
        When('the planner plans the project again with every mutant remembered')(
          'planned',
          (s) => planRecorded(s.recorded),
        ),
        Then('the one shard is predicted at the recorded fixed seconds, which are positive')((s, expect) =>
          expect({
            everyMutantRemembered: s.planned.reused === s.planned.total && s.planned.total > 0,
            recordedFixedCostIsPositive: (s.planned.fixedSeconds ?? 0) > 0,
            shardPredictions: s.planned.plan.shards.map((shard) => shard.predictedSeconds),
          }).toStrictEqual({
            everyMutantRemembered: true,
            recordedFixedCostIsPositive: true,
            shardPredictions: [s.planned.fixedSeconds],
          })
        ),
      ),
    )

    scenario(
      'A run whose mutants overlap records the time spent before its first mutant was scored',
      Gherkin.Do.pipe(
        Given('a project whose mutants run four at a time and each take 0.4 s of test command')(
          'directory',
          () => writeWorkspace(OVERLAPPING_FILES).pipe(Effect.provide(filePorts)),
        ),
        When('its mutation run finishes')(
          'recorded',
          (s) => runIn(s.directory).pipe(Effect.ensuring(removeWorkspace(s.directory))),
        ),
        Then('the mutants overlapped, and the recorded fixed seconds are positive and inside the run')((s, expect) =>
          expect({
            mutantsOverlapped: s.recorded.summedCostSeconds > s.recorded.actualSeconds,
            recordedFixedCostIsPositive: (s.recorded.fixedSeconds ?? 0) > 0,
            fixedCostInsideTheRun: (s.recorded.fixedSeconds ?? Number.POSITIVE_INFINITY) < s.recorded.actualSeconds,
          }).toStrictEqual({
            mutantsOverlapped: true,
            recordedFixedCostIsPositive: true,
            fixedCostInsideTheRun: true,
          })
        ),
      ),
    )
  })
