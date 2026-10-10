import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import type * as FileSystem from 'effect/FileSystem'
import type * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'

export interface AtomicWritePorts {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
}

const TEMP_NAME_BYTES = 8

const textEncoder = new TextEncoder()

const tempFileOf = (ports: AtomicWritePorts, file: string): Effect.Effect<string> =>
  Effect.sync(() =>
    ports.path.join(
      ports.path.dirname(file),
      `.${ports.path.basename(file)}.${bytesToHex(randomBytes(TEMP_NAME_BYTES))}.tmp`,
    )
  )

const writeSynced = (ports: AtomicWritePorts, file: string, content: string): Effect.Effect<void, PlatformError> =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ports.fs.open(file, { flag: 'wx' })
      yield* handle.writeAll(textEncoder.encode(content))
      yield* handle.sync
    }),
  )

export const replaceFileAtomically = Effect.fnUntraced(function*(
  ports: AtomicWritePorts,
  file: string,
  content: string,
): Effect.fn.Return<void, PlatformError> {
  yield* ports.fs.makeDirectory(ports.path.dirname(file), { recursive: true })
  const temp = yield* tempFileOf(ports, file)
  yield* Effect.uninterruptible(
    writeSynced(ports, temp, content).pipe(
      Effect.andThen(ports.fs.rename(temp, file)),
      Effect.onExit((exit) => Exit.isSuccess(exit) ? Effect.void : ports.fs.remove(temp).pipe(Effect.ignore)),
    ),
  )
})
