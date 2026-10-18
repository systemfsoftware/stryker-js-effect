import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  checkers: [],
  reporters: [],
  cleanTempDir: 'always',
}
`

const SOURCE = [
  'export const add = (a, b) => a + b',
  'export const sub = (a, b) => a - b',
  'export const mul = (a, b) => a * b',
  '',
].join('\n')

const PROJECT_NAMES = ['proj-a', 'proj-b'] as const

interface PlanRun {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const prepareFixture = (): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-plan-' }))
    yield* Effect.forEach(
      PROJECT_NAMES,
      (name) =>
        Effect.gen(function*() {
          const project = path.join(root, name)
          yield* fs.makeDirectory(path.join(project, 'src'), { recursive: true })
          yield* fs.writeFileString(
            path.join(project, 'package.json'),
            '{ "name": "plan-consumer", "type": "module", "private": true }\n',
          )
          yield* fs.writeFileString(path.join(project, 'stryker.config.mjs'), CONFIG)
          yield* fs.writeFileString(path.join(project, 'src', 'math.js'), SOURCE)
        }),
      { discard: true },
    )
    return root
  }).pipe(Effect.orDie)

const runPlan = (
  root: string,
  out: string,
  projects: string = PROJECT_NAMES.join(','),
): Effect.Effect<PlanRun, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(
          globalThis.process.execPath,
          [
            STRYKER_BIN,
            'plan',
            '--target-seconds',
            '1',
            '--projects',
            projects,
            '--out',
            out,
          ],
          {
            cwd: root,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            env: { STRYKER_MODE: 'human', NO_COLOR: '1' },
            extendEnv: true,
          },
        ),
      )
      const printedOut = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const printedErr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      const [stdoutText, stderrText] = yield* Effect.all([Fiber.join(printedOut), Fiber.join(printedErr)])
      return { exitCode: Number(exitCode), stdout: stdoutText, stderr: stderrText }
    }),
  ).pipe(Effect.orDie)

const readPlanText = (
  root: string,
  out: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.flatMap(
    Effect.all([FileSystem.FileSystem, Path.Path]),
    ([fs, path]) => fs.readFileString(path.join(root, out)),
  )
    .pipe(Effect.orDie)

const readPlan = (
  root: string,
  out: string,
): Effect.Effect<ShardPlan, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(root, out))
    return Option.getOrThrowWith(
      S.decodeOption(S.fromJsonString(ShardPlan))(text),
      () => new Error(`the plan at ${out} is not a ShardPlan`),
    )
  }).pipe(Effect.orDie)

const projectLabelsOf = (plan: ShardPlan): ReadonlyArray<string> =>
  [...new Set(plan.shards.flatMap((shard) => shard.projects.map((entry) => entry.project)))].sort()

const scheduledTotalOf = (plan: ShardPlan): number =>
  plan.shards.flatMap((shard) => shard.projects.flatMap((entry) => entry.mutants)).length

const distinctScheduledOf = (plan: ShardPlan): number =>
  new Set(plan.shards.flatMap((shard) => shard.projects.flatMap((entry) => entry.mutants))).size

Feature('Planning mutation shards across projects', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary instruments both projects without running a test')
  .body(({ scenario }) => {
    scenario(
      'Two projects are planned into shards and the plan is byte-identical across invocations',
      Gherkin.Do.pipe(
        Given('a fixture whose two projects each hold one mutable source file')(
          'fixture',
          () => prepareFixture(),
        ),
        When('stryker plans both projects twice through the CLI')(
          'ran',
          (s) =>
            Effect.gen(function*() {
              const first = yield* runPlan(s.fixture, 'plan-a.json')
              const second = yield* runPlan(s.fixture, 'plan-b.json')
              const firstPlan = yield* readPlan(s.fixture, 'plan-a.json')
              const secondPlan = yield* readPlan(s.fixture, 'plan-b.json')
              const firstBytes = yield* Effect.orDie(
                Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(`${s.fixture}/plan-a.json`)),
              )
              const secondBytes = yield* Effect.orDie(
                Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(`${s.fixture}/plan-b.json`)),
              )
              return { first, second, firstPlan, secondPlan, firstBytes, secondBytes }
            }),
        ),
        Then('both exit 0 with one decodable, byte-identical plan covering every project')(
          (s, expect) => {
            const scheduled = scheduledTotalOf(s.ran.firstPlan)
            return expect({
              exitCodes: [s.ran.first.exitCode, s.ran.second.exitCode],
              version: s.ran.firstPlan.version,
              scope: s.ran.firstPlan.scope,
              targetSeconds: s.ran.firstPlan.targetSeconds,
              byteIdentical: s.ran.firstBytes === s.ran.secondBytes,
              projects: projectLabelsOf(s.ran.firstPlan),
              shardsMatchCount: s.ran.firstPlan.shards.every(
                (shard) => shard.count === s.ran.firstPlan.shards.length,
              ),
              matrixMatches: s.ran.firstPlan.matrix.include.every((entry, index) =>
                entry.shard === `${index + 1}/${s.ran.firstPlan.shards.length}`
              ),
              everyShardSchedulable: s.ran.firstPlan.shards.every((shard) =>
                shard.projects.every((entry) => entry.mutants.length > 0)
              ),
              partitioned: distinctScheduledOf(s.ran.firstPlan) === scheduled && scheduled > 0,
            }).toStrictEqual({
              exitCodes: [0, 0],
              version: 2,
              scope: { _tag: 'Unscoped' },
              targetSeconds: 1,
              byteIdentical: true,
              projects: ['proj-a', 'proj-b'],
              shardsMatchCount: true,
              matrixMatches: true,
              everyShardSchedulable: true,
              partitioned: true,
            })
          },
        ),
      ),
    )
    scenario(
      'Naming one project twice plans it once, exactly as naming it once does',
      Gherkin.Do.pipe(
        Given('a fixture whose two projects each hold one mutable source file')(
          'fixture',
          () => prepareFixture(),
        ),
        When('stryker plans the projects once by name and once with proj-a also named by a second path')(
          'ran',
          (s) =>
            Effect.gen(function*() {
              const once = yield* runPlan(s.fixture, 'plan-once.json')
              const twice = yield* runPlan(s.fixture, 'plan-twice.json', 'proj-a,./proj-a,proj-b')
              const onceText = yield* readPlanText(s.fixture, 'plan-once.json')
              const twiceText = yield* readPlanText(s.fixture, 'plan-twice.json')
              return { once, twice, onceText, twiceText }
            }),
        ),
        Then('both exit 0 and write the same plan bytes')(
          (s, expect) =>
            expect({
              exitCodes: [s.ran.once.exitCode, s.ran.twice.exitCode],
              samePlan: s.ran.onceText === s.ran.twiceText,
            }).toStrictEqual({ exitCodes: [0, 0], samePlan: true }),
        ),
      ),
    )
    scenario(
      'Naming one project through a symlink plans it once, exactly as naming it once does',
      Gherkin.Do.pipe(
        Given('a fixture whose project proj-a is also reachable through the symlink link-a')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* prepareFixture()
              yield* fs.symlink(path.join(root, 'proj-a'), path.join(root, 'link-a')).pipe(Effect.orDie)
              return root
            }),
        ),
        When('stryker plans proj-a alone and proj-a together with link-a')(
          'ran',
          (s) =>
            Effect.gen(function*() {
              const alone = yield* runPlan(s.fixture, 'plan-alone.json', 'proj-a')
              const aliased = yield* runPlan(s.fixture, 'plan-aliased.json', 'proj-a,link-a')
              const aloneText = yield* readPlanText(s.fixture, 'plan-alone.json')
              const aliasedText = yield* readPlanText(s.fixture, 'plan-aliased.json')
              return { alone, aliased, aloneText, aliasedText }
            }),
        ),
        Then('both exit 0 and write the same plan bytes')(
          (s, expect) =>
            expect({
              exitCodes: [s.ran.alone.exitCode, s.ran.aliased.exitCode],
              samePlan: s.ran.aloneText === s.ran.aliasedText,
            }).toStrictEqual({ exitCodes: [0, 0], samePlan: true }),
        ),
      ),
    )
  })
