import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'

import { makeVerdictStore, type VerdictBlobs } from '../verdict-store/verdict-blobs.js'
import { VerdictBlobFailed, VerdictStoreUnavailable } from '../verdict-store/VerdictStore.schema.js'
import { VerdictStore } from '../verdict-store/VerdictStore.service.js'

const textEncoder = new TextEncoder()

const failedAt = (name: string) => (error: PlatformError): VerdictBlobFailed =>
  VerdictBlobFailed.make({ name, reason: error.message })

const recoverWhen =
  (tag: 'NotFound' | 'AlreadyExists') => <A>(recovered: A) => (error: PlatformError): Effect.Effect<A, PlatformError> =>
    Match.value(error.reason).pipe(
      Match.tag(tag, () => Effect.succeed(recovered)),
      Match.orElse(() => Effect.fail(error)),
    )

const absentWhenNotFound = recoverWhen('NotFound')

const existingWhenAlreadyExists = recoverWhen('AlreadyExists')

const writeSynced = (fs: FileSystem.FileSystem, file: string, text: string): Effect.Effect<void, PlatformError> =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* fs.open(file, { flag: 'w' })
      yield* handle.writeAll(textEncoder.encode(text))
      yield* handle.sync
    }),
  )

const replaceAtomically = Effect.fnUntraced(function*(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  file: string,
  text: string,
) {
  const directory = path.dirname(file)
  yield* fs.makeDirectory(directory, { recursive: true })
  const temp = yield* fs.makeTempFile({ directory, prefix: `.${path.basename(file)}.`, suffix: '.tmp' })
  yield* writeSynced(fs, temp, text).pipe(
    Effect.andThen(fs.rename(temp, file)),
    Effect.onExit((exit) => Exit.isSuccess(exit) ? Effect.void : fs.remove(temp).pipe(Effect.ignore)),
  )
})

const fsBlobsOf = (fs: FileSystem.FileSystem, path: Path.Path, root: string): VerdictBlobs => ({
  read: (name) =>
    fs.readFileString(path.join(root, name)).pipe(
      Effect.asSome,
      Effect.catchTag('PlatformError', absentWhenNotFound(Option.none<string>())),
      Effect.mapError(failedAt(name)),
    ),
  write: (name, text) => replaceAtomically(fs, path, path.join(root, name), text).pipe(Effect.mapError(failedAt(name))),
  list: (directory) =>
    fs.readDirectory(path.join(root, directory)).pipe(
      Effect.catchTag('PlatformError', absentWhenNotFound<ReadonlyArray<string>>([])),
      Effect.mapError(failedAt(directory)),
    ),
})

const unavailableAt = (root: string) => (reason: string): VerdictStoreUnavailable =>
  VerdictStoreUnavailable.make({ store: root, reason })

const usableRoot = (fs: FileSystem.FileSystem, root: string): Effect.Effect<void, VerdictStoreUnavailable> =>
  fs.makeDirectory(root, { recursive: true }).pipe(
    Effect.catchTag('PlatformError', existingWhenAlreadyExists<void>(undefined)),
    Effect.andThen(fs.stat(root)),
    Effect.mapError((error) => unavailableAt(root)(error.message)),
    Effect.flatMap((info) =>
      Match.value(info.type).pipe(
        Match.when('Directory', () => Effect.void),
        Match.orElse((type) => Effect.fail(unavailableAt(root)(`the store root is a ${type}, not a directory`))),
      )
    ),
  )

export const fsVerdictStoreLayer = (
  root: string,
): Layer.Layer<VerdictStore, VerdictStoreUnavailable, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    VerdictStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      yield* usableRoot(fs, root)
      return makeVerdictStore(fsBlobsOf(fs, path, root))
    }),
  )
