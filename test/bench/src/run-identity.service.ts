import { ReadRunIdentityCommand, type RunIdentity, runIdentityOf } from '@systemfsoftware/stryker-e2e-core'
import type * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'

export const runIdentity = (
  incrementalFile: string,
): Effect.Effect<RunIdentity, never, FileSystem.FileSystem | Crypto.Crypto> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(incrementalFile).pipe(
      Effect.matchEffect({
        onFailure: (cause) =>
          Effect.succeed<RunIdentity>({
            _tag: 'unread',
            file: incrementalFile,
            reason: `the incremental report could not be read: ${cause.message}`,
          }),
        onSuccess: (text) => runIdentityOf(ReadRunIdentityCommand.make({ file: incrementalFile, text })),
      }),
    )
  })
