import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Boolean } from 'effect'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import type * as Scope from 'effect/Scope'

import { keepTempDir, KeepTempDirAlways, KeepTempDirCommand, KeepTempDirOnFailure } from './keep-temp-dir.workflow.js'

export interface TemporaryDirectoryShape {
  readonly path: string
}

const keepTempDirCommand = <A, E>(
  exit: Exit.Exit<A, E>,
  cleanTempDir: 'always' | boolean,
): KeepTempDirCommand =>
  KeepTempDirCommand.make({
    cleanTempDir: Match.value(cleanTempDir).pipe(
      Match.when('always', () => KeepTempDirAlways.make({})),
      Match.orElse((onFailure) => KeepTempDirOnFailure.make({ failed: onFailure })),
    ),
    failed: Exit.isFailure(exit),
  })

const removesTempDir = <A = unknown, E = unknown>(exit: Exit.Exit<A, E>, cleanTempDir: 'always' | boolean): boolean =>
  Result.match(keepTempDir(keepTempDirCommand(exit, cleanTempDir)), {
    onFailure: () => false,
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('TempDirRemoved', () => true),
        Match.tag('TempDirKept', () => false),
        Match.exhaustive,
      ),
  })

const removeEmptyParentDirectory = Effect.fn('stryker.sandbox.remove_empty_parent')(function*(
  parent: string,
  fs: FileSystem.FileSystem,
): Effect.fn.Return<void, PlatformError> {
  const siblings = yield* fs.readDirectory(parent)
  yield* Boolean.match(siblings.length === 0, {
    onTrue: () => fs.remove(parent, { recursive: true, force: true }),
    onFalse: () => Effect.void,
  })
})

const removeTempDirectory = Effect.fn('stryker.sandbox.remove_temp_dir')(function*(
  tmp: string,
  parent: string,
  fs: FileSystem.FileSystem,
): Effect.fn.Return<void, PlatformError> {
  yield* Effect.logDebug(`Deleting stryker temp directory ${tmp}`)
  yield* fs.remove(tmp, { recursive: true, force: true })
  const parentExists = yield* fs.exists(parent)
  yield* Boolean.match(parentExists, {
    onTrue: () => removeEmptyParentDirectory(parent, fs),
    onFalse: () => Effect.void,
  })
})

const makeTemporaryDirectory = Effect.fn('stryker.sandbox.make_temp_dir')(function*(
  options: Options.StrykerOptions,
): Effect.fn.Return<TemporaryDirectoryShape, PlatformError, FileSystem.FileSystem | Path.Path | Scope.Scope> {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const parent = path.resolve(options.tempDirName)
  yield* fs.makeDirectory(parent, { recursive: true })

  const prefix = Boolean.match(options.inPlace, { onTrue: () => 'backup-', onFalse: () => 'sandbox-' })
  const tmp = yield* fs.makeTempDirectory({
    directory: parent,
    prefix,
  })

  yield* Effect.logDebug(`Using temp directory "${tmp}"`)

  yield* Effect.addFinalizer((exit) =>
    Boolean.match(removesTempDir(exit, options.cleanTempDir), {
      onTrue: () => removeTempDirectory(tmp, parent, fs),
      onFalse: () => Effect.logDebug('Not removing the temp dir because an error occurred'),
    }).pipe(Effect.orDie)
  )

  return { path: tmp }
})

export class TemporaryDirectory extends Context.Service<TemporaryDirectory, TemporaryDirectoryShape>()(
  '@systemfsoftware/stryker-js/Sandbox.service/TemporaryDirectory',
) {
  static layer(
    options: Options.StrykerOptions,
  ): Layer.Layer<TemporaryDirectory, PlatformError, FileSystem.FileSystem | Path.Path> {
    return Layer.effect(TemporaryDirectory, makeTemporaryDirectory(options))
  }
}
