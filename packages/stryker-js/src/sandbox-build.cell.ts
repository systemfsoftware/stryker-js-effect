import { type Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Boolean from 'effect/Boolean'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import { judgeSandboxBuild } from './judge-sandbox-build.workflow.js'
import { StrykerError } from './stryker-error.schema.js'

export interface SandboxBuildInput {
  readonly command: string
  readonly workingDirectory: string
}

const directoryChain = (from: string, pathService: Path.Path): readonly string[] =>
  Boolean.match(pathService.dirname(from) === from, {
    onTrue: () => [from],
    onFalse: () => [from, ...directoryChain(pathService.dirname(from), pathService)],
  })

const binDirectoriesFrom = (from: string, pathService: Path.Path): string[] =>
  directoryChain(pathService.resolve(from), pathService).map((directory) =>
    pathService.join(directory, 'node_modules', '.bin')
  )

const inheritedPath = (): Effect.Effect<string> =>
  Config.String('PATH').pipe(
    Effect.option,
    Effect.map((value) => Option.getOrUndefined(value) ?? ''),
  )

const runBuild = Effect.fnUntraced(function*(input: SandboxBuildInput) {
  yield* Effect.logInfo(`Running build command "${input.command}" in "${input.workingDirectory}".`)
  const pathService = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const separator = Boolean.match(pathService.sep === '\\', { onTrue: () => ';', onFalse: () => ':' })
  const inherited = yield* inheritedPath()
  const binDirs = binDirectoriesFrom(input.workingDirectory, pathService)
  const newPath = [...binDirs, inherited].join(separator)

  const childCommand = ChildProcess.make(input.command, {
    shell: true,
    cwd: input.workingDirectory,
    env: { PATH: newPath },
    extendEnv: true,
  })
  const spawnFailed = (cause: PlatformError) =>
    StrykerError.make({ message: `Failed to spawn build command "${input.command}"`, cause })
  const handle = yield* spawner.spawn(childCommand).pipe(Effect.mapError(spawnFailed))
  const stderr = yield* handle.stderr.pipe(
    Stream.decodeText,
    Stream.runCollect,
    Effect.map((chunks) => [...chunks].join('')),
    Effect.orElseSucceed(() => ''),
  )
  const exitCode = yield* handle.exitCode.pipe(Effect.mapError(spawnFailed))
  return { _tag: 'SandboxBuildCommand' as const, command: input.command, exitCode: Number(exitCode), stderr }
})

export const sandboxBuildCell: Cell.Cell<
  SandboxBuildInput,
  void,
  StrykerError,
  Path.Path | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> = Sandwich.named(SpanTaxonomy.Spans.sandboxBuildRun.name)(runBuild)
  .decide(judgeSandboxBuild)
  .write({
    SandboxBuilt: () => Effect.void,
    StrykerError: ({ message }) => Effect.fail(StrykerError.make({ message })),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `Could not judge the sandbox build command: ${issue}` })),
  })
