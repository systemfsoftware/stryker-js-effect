import { readRunIdentity, ReadRunIdentityCommand, type RunIdentity } from '@systemfsoftware/stryker-e2e-core'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import { Hex } from 'effect/encoding'
import * as FileSystem from 'effect/FileSystem'

export const runIdentity = (
  incrementalFile: string,
): Effect.Effect<RunIdentity, never, FileSystem.FileSystem | Crypto.Crypto> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const crypto = yield* Crypto.Crypto
    const text = yield* fs.readFileString(incrementalFile).pipe(
      Effect.mapError((cause) => `the incremental report could not be read: ${cause.message}`),
    )
    const read = yield* Effect.fromResult(
      readRunIdentity(ReadRunIdentityCommand.make({ file: incrementalFile, text })),
    ).pipe(Effect.mapError((undecodable) => undecodable.reason))
    const digest = yield* crypto.digest('SHA-256', new TextEncoder().encode(read.mutantIds.join('\n'))).pipe(
      Effect.mapError(() => 'the sha256 digest of the mutant ids failed'),
    )
    return {
      _tag: 'read',
      projectRoot: read.projectRoot,
      runInputsDigest: read.runInputsDigest,
      mutantIdsDigest: Hex.encode(digest),
    } satisfies RunIdentity
  }).pipe(
    Effect.catch((reason) => Effect.succeed<RunIdentity>({ _tag: 'unread', file: incrementalFile, reason })),
  )
