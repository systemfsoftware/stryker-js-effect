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

interface Observation {
  readonly fixedSeconds: number | undefined
  readonly plan: ShardPlan
  readonly reused: number
  readonly total: number
}

const writeWorkspace = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-fixed-cost-' }))
  yield* Effect.forEach(
    Object.entries(FILES),
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
}

const recordRun: Effect.Effect<RecordedRun> = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* writeWorkspace
  yield* runOnce(directory)
  const record = yield* fs.readFileString(path.join(directory, REPORT_FILE))
  return {
    directory,
    fixedSeconds: Option.getOrUndefined(
      Option.flatMap(
        S.decodeOption(S.fromJsonString(S.Struct({ fixedSeconds: S.optional(S.Finite) })))(record),
        (decoded) => Option.fromUndefinedOr(decoded.fixedSeconds),
      ),
    ),
  }
}).pipe(Effect.orDie, Effect.provide(filePorts))

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
    Effect.ensuring(
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(recorded.directory, { recursive: true, force: true }))
        .pipe(Effect.ignore),
    ),
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
        Given('a project whose mutation run wrote its incremental record')('recorded', () => recordRun),
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
  })
