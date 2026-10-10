import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const STRYKER_BIN = decodeURIComponent(new URL('../../dist/main.mjs', import.meta.url).pathname)

export const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  concurrency: 1,
  reporters: [],
  thresholds: { high: 80, low: 60, break: 100 },
}
`

export const SOURCE = 'export const add = (a, b) => a + b\nexport const sub = (a, b) => a - b\n'

export interface CliOutcome {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const spawnCliWith = (
  root: string,
  args: ReadonlyArray<string>,
  mode: 'human' | 'machine',
): Effect.Effect<CliOutcome, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, ...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: mode, NO_COLOR: '1', GITHUB_ACTIONS: '', ALLOW_LOCAL_MUTATION: '1' },
          extendEnv: true,
        }),
      )
      const stdout = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const stderr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      return {
        exitCode: Number(exitCode),
        stdout: yield* Fiber.join(stdout),
        stderr: yield* Fiber.join(stderr),
      }
    }),
  ).pipe(Effect.orDie)

export const spawnCli: {
  (
    root: string,
    args: ReadonlyArray<string>,
    mode: 'human' | 'machine',
  ): Effect.Effect<CliOutcome, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope>
  (
    args: ReadonlyArray<string>,
    mode: 'human' | 'machine',
  ): (root: string) => Effect.Effect<CliOutcome, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope>
} = dual(3, spawnCliWith)

export const decodePlan = (text: string): Option.Option<ShardPlan> => S.decodeOption(S.fromJsonString(ShardPlan))(text)

export const encodePlan = (plan: ShardPlan): Effect.Effect<string> =>
  Effect.orDie(S.encodeEffect(S.fromJsonString(ShardPlan, { space: 2 }))(plan))

const projectLabelsOf = (plan: ShardPlan): ReadonlyArray<string> =>
  Arr.dedupe(plan.shards.flatMap((shard) => shard.projects.map((entry) => entry.project)))

const mutantsOf = (plan: ShardPlan, project: string): ReadonlyArray<string> =>
  plan.shards.flatMap((shard) =>
    shard.projects.filter((entry) => entry.project === project).flatMap((entry) => entry.mutants)
  )

export const singleShardPlanOf = (plan: ShardPlan): ShardPlan => ({
  version: 2,
  scope: plan.scope,
  targetSeconds: 1,
  shards: [{
    index: 1,
    count: 1,
    predictedSeconds: 1,
    projects: projectLabelsOf(plan).map((project) => ({ project, mutants: mutantsOf(plan, project) })),
  }],
  matrix: { include: [{ shard: '1/1', predictedSeconds: 1 }] },
})

export const requireBinary: Effect.Effect<void, never, FileSystem.FileSystem> = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const binaryPresent = yield* fs.exists(STRYKER_BIN)
  yield* Effect.when(
    Effect.die(new Error('dist/main.mjs is missing — build the package first')),
    Effect.succeed(!binaryPresent),
  )
}).pipe(Effect.orDie)
