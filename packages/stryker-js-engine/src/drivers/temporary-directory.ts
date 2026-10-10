import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Run } from '@systemfsoftware/stryker-js-contracts'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Sandbox } from '@systemfsoftware/stryker-js-sandbox'
import { Boolean } from 'effect'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import type * as Scope from 'effect/Scope'

const removesTempDir = <A = unknown, E = unknown>(exit: Exit.Exit<A, E>, cleanTempDir: 'always' | boolean): boolean =>
  Result.match(Sandbox.keepTempDir(Sandbox.KeepTempDirCommand.make({ cleanTempDir, failed: Exit.isFailure(exit) })), {
    onFailure: () => false,
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('TempDirRemoved', () => true),
        Match.tag('TempDirKept', () => false),
        Match.exhaustive,
      ),
  })

const removeEmptyParentDirectory = Effect.fn(SpanTaxonomy.Spans.sandboxRemoveEmptyParent.name)(function*(
  parent: string,
  fs: FileSystem.FileSystem,
): Effect.fn.Return<void, PlatformError> {
  const siblings = yield* fs.readDirectory(parent)
  yield* Boolean.match(siblings.length === 0, {
    onTrue: () => fs.remove(parent, { recursive: true, force: true }),
    onFalse: () => Effect.void,
  })
})

const removeTempDirectory = Effect.fn(SpanTaxonomy.Spans.sandboxRemoveTempDir.name)(function*(
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

const makeTemporaryDirectory = Effect.fn(SpanTaxonomy.Spans.sandboxMakeTempDir.name)(function*(
  options: Options.StrykerOptions,
): Effect.fn.Return<Run.TemporaryDirectoryShape, PlatformError, FileSystem.FileSystem | Path.Path | Scope.Scope> {
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
      onFalse: () => Effect.logDebug(`Keeping stryker temp directory ${tmp}`),
    }).pipe(Effect.orDie)
  )

  return { path: tmp }
})

export function layer(
  options: Options.StrykerOptions,
): Layer.Layer<Run.TemporaryDirectory, PlatformError, FileSystem.FileSystem | Path.Path> {
  return Layer.effect(Run.TemporaryDirectory, makeTemporaryDirectory(options))
}
