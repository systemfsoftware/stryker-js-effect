import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import { selectShard, SelectShardCommand, type ShardUnknown } from './select-shard.workflow.js'
import { ShardChildFailed } from './shard-run.schema.js'

const SHARD_OUT_MARKER = 'reports/shards'
const STREAM_FILE = 'mutation-stream.jsonl'
const INCREMENTAL_FILE = 'stryker-incremental.json'
const STDERR_LIMIT = 4096

export interface ShardRunInput {
  readonly plan: ShardPlan
  readonly planFile: string
  readonly planDirectory: string
  readonly shard: string
  readonly out: string | undefined
  readonly basePath: string
}

const childArgsOf = (input: ShardRunInput, project: string, projectOut: string, path: Path.Path): readonly string[] => [
  globalThis.process.argv[1] ?? '',
  'run',
  '--plan',
  input.planFile,
  '--shard',
  input.shard,
  '--project',
  project,
  '--progressStreamFile',
  path.join(projectOut, STREAM_FILE),
  '--incremental',
  '--incrementalFile',
  path.join(projectOut, INCREMENTAL_FILE),
]

const DEFAULT_INCREMENTAL = 'reports/stryker-incremental.json'

const seedIncremental = (
  path: Path.Path,
  fs: FileSystem.FileSystem,
  projectDir: string,
  projectOut: string,
) =>
  Effect.gen(function*() {
    const cached = path.join(projectDir, DEFAULT_INCREMENTAL)
    const target = path.join(projectOut, INCREMENTAL_FILE)
    const hasCached = yield* fs.exists(cached)
    const hasTarget = yield* fs.exists(target)
    yield* Effect.when(fs.copyFile(cached, target), Effect.succeed(hasCached && !hasTarget))
  })

export const runShard = (
  input: ShardRunInput,
): Effect.Effect<
  void,
  ShardUnknown | ShardChildFailed,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function*() {
    const selected = yield* Effect.fromResult(
      selectShard(SelectShardCommand.make({ plan: input.plan, shard: input.shard })),
    )
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const outDir = path.resolve(
      input.basePath,
      input.out ?? path.join(input.planDirectory, SHARD_OUT_MARKER, String(selected.index)),
    )
    yield* Effect.forEach(
      selected.projects,
      (project) =>
        Effect.gen(function*() {
          const projectDir = path.resolve(input.planDirectory, project.project)
          const projectOut = path.join(outDir, project.project)
          yield* fs.makeDirectory(projectOut, { recursive: true })
          yield* seedIncremental(path, fs, projectDir, projectOut)
          const handle = yield* spawner.spawn(
            ChildProcess.make(globalThis.process.execPath, childArgsOf(input, project.project, projectOut, path), {
              cwd: projectDir,
              stdin: 'ignore',
              stdout: 'ignore',
              stderr: 'pipe',
              extendEnv: true,
            }),
          )
          const stderr = yield* handle.stderr.pipe(Stream.decodeText, Stream.mkString)
          const exitCode = Number(yield* handle.exitCode)
          yield* exitCode === 0
            ? Effect.void
            : Effect.fail(
              ShardChildFailed.make({
                project: project.project,
                exitCode,
                reason: stderr.slice(0, STDERR_LIMIT),
              }),
            )
        }).pipe(
          Effect.catchTag('PlatformError', (cause) =>
            Effect.fail(
              ShardChildFailed.make({
                project: project.project,
                exitCode: -1,
                reason: cause.message,
              }),
            )),
        ),
      { concurrency: 1, discard: true },
    )
  })
