import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'
import { type CliOutcome, runCli } from './__fixtures__/cli-project.fixture.js'
import {
  CONFIG,
  configOf,
  decodePlan,
  encodePlan,
  singleShardPlanOf,
  SOURCE,
} from './__fixtures__/shard-cli.fixture.js'

const Feature = makeFeature({ it })

const PROJECTS = ['first', 'second'] as const

const CONSUMER_PACKAGE = '{ "name": "shard-run-consumer", "type": "module", "private": true }\n'

const STREAM_FILE = 'mutation-stream.jsonl'
const INCREMENTAL_FILE = 'stryker-incremental.json'

interface Fixture {
  readonly root: string
}

const prepareFixture = (): Effect.Effect<
  Fixture,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-shard-run-' }))
    yield* Effect.forEach(
      PROJECTS,
      (project) =>
        Effect.gen(function*() {
          yield* fs.makeDirectory(path.join(root, project, 'src'), { recursive: true })
          yield* fs.writeFileString(path.join(root, project, 'package.json'), CONSUMER_PACKAGE)
          yield* fs.writeFileString(path.join(root, project, 'stryker.config.mjs'), CONFIG)
          yield* fs.writeFileString(path.join(root, project, 'src', 'math.js'), SOURCE)
        }),
      { discard: true },
    )
    const planned = yield* runCli({
      root,
      args: ['plan', '--target-seconds', '1', '--projects', PROJECTS.join(','), '--out', 'plan.json'],
      mode: 'machine',
    })
    yield* Effect.when(
      Effect.die(new Error(`planning exited ${planned.exitCode}: ${planned.stdout}${planned.stderr}`)),
      Effect.succeed(planned.exitCode !== 0),
    )
    const planText = yield* fs.readFileString(path.join(root, 'plan.json'))
    const plan = Option.getOrThrowWith(
      decodePlan(planText),
      () => new Error('the planner did not write a decodable ShardPlan'),
    )
    yield* fs.writeFileString(path.join(root, 'plan-single.json'), yield* encodePlan(singleShardPlanOf(plan)))
    return { root }
  }).pipe(Effect.orDie)

const prepareEmptyRoot = (): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-shard-run-' }))
  }).pipe(Effect.orDie)

const runSingleShard = (
  root: string,
  mode: 'human' | 'machine',
): Effect.Effect<CliOutcome, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem> =>
  runCli({ root, args: ['run', '--plan', 'plan-single.json', '--shard', '1/1', '--out', 'reports/shard-1'], mode })

interface ProjectOutputs {
  readonly stream: boolean
  readonly incremental: boolean
}

const outputsOf = (
  root: string,
  project: string,
): Effect.Effect<ProjectOutputs, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const projectOut = path.join(root, 'reports', 'shard-1', project)
    return {
      stream: yield* fs.exists(path.join(projectOut, STREAM_FILE)),
      incremental: yield* fs.exists(path.join(projectOut, INCREMENTAL_FILE)),
    }
  }).pipe(Effect.orDie)

const bothProjectsOutputs = (
  root: string,
): Effect.Effect<
  { readonly first: ProjectOutputs; readonly second: ProjectOutputs },
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const first = yield* outputsOf(root, 'first')
    const second = yield* outputsOf(root, 'second')
    return { first, second }
  }).pipe(Effect.orDie)

const writeConfig = (
  root: string,
  project: string,
  breakThreshold: number,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.writeFileString(path.join(root, project, 'stryker.config.mjs'), configOf(breakThreshold))
  }).pipe(Effect.orDie)

interface GateOutcome {
  readonly shardExitCode: number
  readonly gate: CliOutcome
}

const runMergeAndGate = (
  root: string,
): Effect.Effect<GateOutcome, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const shard = yield* runSingleShard(root, 'machine')
    const merged = yield* runCli({
      root,
      args: ['merge', '--plan', 'plan-single.json', 'reports/shard-1', '--out', 'reports/mutation'],
      mode: 'machine',
    })
    yield* Effect.when(
      Effect.die(new Error(`merge exited ${merged.exitCode}: ${merged.stdout}${merged.stderr}`)),
      Effect.succeed(merged.exitCode !== 0),
    )
    return { shardExitCode: shard.exitCode, gate: yield* runCli({ root, args: ['gate'], mode: 'human' }) }
  })

Feature('Running one shard of a shard plan', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs a shard project by project in a real Node process')
  .body(({ scenario }) => {
    scenario(
      'A shard whose children all fail the break threshold exits 0 and leaves each project its stream and incremental file',
      Gherkin.Do.pipe(
        Given('a fixture whose two projects are planned into one shard')('fixture', () => prepareFixture()),
        When('the shard runs')('ran', (s) => runSingleShard(s.fixture.root, 'machine')),
        When("both projects' output directories are inspected")('outputs', (s) => bothProjectsOutputs(s.fixture.root)),
        Then('the shard exits 0 with every project carrying a progress stream and an incremental file')(
          (s, expect) =>
            expect({
              exitCode: s.ran.exitCode,
              firstStream: s.outputs.first.stream,
              firstIncremental: s.outputs.first.incremental,
              secondStream: s.outputs.second.stream,
              secondIncremental: s.outputs.second.incremental,
            }).toStrictEqual({
              exitCode: 0,
              firstStream: true,
              firstIncremental: true,
              secondStream: true,
              secondIncremental: true,
            }),
        ),
      ),
    )

    scenario(
      "A shard whose child fails a real reason exits non-zero and names the project and the child's reason",
      Gherkin.Do.pipe(
        Given('a fixture whose two projects are planned into one shard')('fixture', () => prepareFixture()),
        When("the second project's stryker config throws when loaded and the shard runs for a person")(
          'ran',
          (s) =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              yield* fs.writeFileString(
                path.join(s.fixture.root, 'second', 'stryker.config.mjs'),
                "throw new Error('the second fixture config is broken')\n",
              )
              return yield* runSingleShard(s.fixture.root, 'human')
            }).pipe(Effect.orDie),
        ),
        Then('the run fails with the configuration class, naming the second project, its exit class and its error')(
          (s, expect) =>
            expect({
              exitCode: s.ran.exitCode,
              namesTheProject: s.ran.stderr.includes('shard child for second failed with exit code 2'),
              namesTheChildReason: s.ran.stderr.includes('the second fixture config is broken'),
              namesTheChildClass: s.ran.stderr.includes('exit 2 (ConfigError)'),
            }).toStrictEqual({
              exitCode: 2,
              namesTheProject: true,
              namesTheChildReason: true,
              namesTheChildClass: true,
            }),
        ),
      ),
    )

    scenario(
      'A shard run whose plan cannot be read fails for a person naming the reason and the class',
      Gherkin.Do.pipe(
        Given('a directory that holds no plan')('root', () => prepareEmptyRoot()),
        When('stryker runs a shard of a plan file that is not there')(
          'ran',
          (s) =>
            runCli({ root: s.root, args: ['run', '--plan', 'missing-plan.json', '--shard', '1/1'], mode: 'human' }),
        ),
        Then('the run fails with the configuration class and names the reason, its code and the next step')((
          s,
          expect,
        ) =>
          expect({
            exitCode: s.ran.exitCode,
            namesTheReason: s.ran.stderr.includes('cannot read the plan file'),
            namesTheCode: s.ran.stderr.includes('plan-unreadable'),
            namesTheNext: s.ran.stderr.includes('next: check the --plan path'),
            namesTheClass: s.ran.stderr.includes('exit 2 (ConfigError)'),
          }).toStrictEqual({
            exitCode: 2,
            namesTheReason: true,
            namesTheCode: true,
            namesTheNext: true,
            namesTheClass: true,
          })
        ),
      ),
    )

    scenario(
      "A merged report judges each project against its own break, so the second project's break fails the gate",
      Gherkin.Do.pipe(
        Given('a fixture whose two projects are planned into one shard')('fixture', () => prepareFixture()),
        Given('every mutant survives, the first project breaks at 0 and the second at 50')(
          'configured',
          (s) =>
            Effect.gen(function*() {
              yield* writeConfig(s.fixture.root, 'first', 0)
              yield* writeConfig(s.fixture.root, 'second', 50)
            }),
        ),
        When('the shard runs, merges and stryker gates the merged report')(
          'outcome',
          (s) => runMergeAndGate(s.fixture.root),
        ),
        Then('the gate fails naming only the second project below its break')((s, expect) =>
          expect({
            shardExitCode: s.outcome.shardExitCode,
            gateExitCode: s.outcome.gate.exitCode,
            namesSecond: s.outcome.gate.stderr.includes('score-below-break: second scored 0.00 < break 50'),
            namesFirst: s.outcome.gate.stderr.includes('score-below-break: first'),
            countsProjects: s.outcome.gate.stderr.includes('1 of 2 project(s) scored below thresholds.break'),
          }).toStrictEqual({
            shardExitCode: 0,
            gateExitCode: 1,
            namesSecond: true,
            namesFirst: false,
            countsProjects: true,
          })
        ),
      ),
    )
  })
