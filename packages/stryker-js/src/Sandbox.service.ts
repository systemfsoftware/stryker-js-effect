import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
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
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import type * as Scope from 'effect/Scope'

import { EmptyDirectory } from './empty-directory.service.js'
import { keepTempDir, KeepTempDirCommand } from './keep-temp-dir.workflow.js'

export interface TemporaryDirectoryShape {
  readonly path: string
}

const removesTempDir = <A = unknown, E = unknown>(exit: Exit.Exit<A, E>, cleanTempDir: 'always' | boolean): boolean =>
  Result.match(keepTempDir(KeepTempDirCommand.make({ cleanTempDir, failed: Exit.isFailure(exit) })), {
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
  emptyDirectory: EmptyDirectory['Service'],
): Effect.fn.Return<void, PlatformError> {
  yield* emptyDirectory.removeIfEmpty(parent)
})

const removeTempDirectory = Effect.fn(SpanTaxonomy.Spans.sandboxRemoveTempDir.name)(function*(
  tmp: string,
  parent: string,
  fs: FileSystem.FileSystem,
  emptyDirectory: EmptyDirectory['Service'],
): Effect.fn.Return<void, PlatformError> {
  yield* Effect.logDebug(`Deleting stryker temp directory ${tmp}`)
  yield* fs.remove(tmp, { recursive: true, force: true })
  yield* removeEmptyParentDirectory(parent, emptyDirectory)
})

const RIVAL_PARENT_REMOVALS_SURVIVED = 15

const parentVanished = (error: PlatformError): boolean =>
  Predicate.isTagged(error.reason, 'NotFound') && error.reason.method === 'makeTempDirectory'

const makeTemporaryDirectory = Effect.fn(SpanTaxonomy.Spans.sandboxMakeTempDir.name)(function*(
  options: Options.StrykerOptions,
): Effect.fn.Return<
  TemporaryDirectoryShape,
  PlatformError,
  EmptyDirectory | FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const emptyDirectory = yield* EmptyDirectory

  const parent = path.resolve(options.tempDirName)
  const prefix = Boolean.match(options.inPlace, { onTrue: () => 'backup-', onFalse: () => 'sandbox-' })
  const tmp = yield* fs.makeDirectory(parent, { recursive: true }).pipe(
    Effect.andThen(fs.makeTempDirectory({ directory: parent, prefix })),
    Effect.retry({ times: RIVAL_PARENT_REMOVALS_SURVIVED, while: parentVanished }),
  )

  yield* Effect.logDebug(`Using temp directory "${tmp}"`)

  yield* Effect.addFinalizer((exit) =>
    Boolean.match(removesTempDir(exit, options.cleanTempDir), {
      onTrue: () => removeTempDirectory(tmp, parent, fs, emptyDirectory),
      onFalse: () => Effect.logDebug(`Keeping stryker temp directory ${tmp}`),
    }).pipe(Effect.orDie)
  )

  return { path: tmp }
})

export class TemporaryDirectory extends Context.Service<TemporaryDirectory, TemporaryDirectoryShape>()(
  '@systemfsoftware/stryker-js/Sandbox.service/TemporaryDirectory',
) {
  static layer(
    options: Options.StrykerOptions,
  ): Layer.Layer<TemporaryDirectory, PlatformError, EmptyDirectory | FileSystem.FileSystem | Path.Path> {
    return Layer.effect(TemporaryDirectory, makeTemporaryDirectory(options))
  }
}
