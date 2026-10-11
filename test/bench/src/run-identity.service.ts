import { type RunIdentity, RunIdentitySource } from '@systemfsoftware/stryker-e2e-core'
import * as Arr from 'effect/Array'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import { Hex } from 'effect/encoding'
import * as FileSystem from 'effect/FileSystem'
import * as Order from 'effect/Order'
import * as Record from 'effect/Record'
import * as S from 'effect/Schema'

const mutantIdsOf = (source: RunIdentitySource): ReadonlyArray<string> =>
  Arr.sort(
    Arr.flatMap(Record.values(source.files), (file) => Arr.map(file.mutants, (mutant) => mutant.id)),
    Order.String,
  )

export const runIdentity = (
  incrementalFile: string,
): Effect.Effect<RunIdentity, never, FileSystem.FileSystem | Crypto.Crypto> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const crypto = yield* Crypto.Crypto
    const text = yield* fs.readFileString(incrementalFile).pipe(
      Effect.mapError((cause) => `incremental report unreadable (${incrementalFile}): ${cause.message}`),
    )
    const source = yield* S.decodeEffect(S.fromJsonString(RunIdentitySource))(text).pipe(
      Effect.mapError((cause) => `incremental report has no identity fields (${incrementalFile}): ${cause.message}`),
    )
    const digest = yield* crypto.digest('SHA-256', new TextEncoder().encode(mutantIdsOf(source).join('\n'))).pipe(
      Effect.mapError(() => 'sha256 digest of the mutant ids failed'),
    )
    return {
      _tag: 'read',
      projectRoot: source.projectRoot,
      runInputsDigest: source.runInputsDigest,
      mutantIdsDigest: Hex.encode(digest),
    } satisfies RunIdentity
  }).pipe(
    Effect.catch((reason) => Effect.succeed<RunIdentity>({ _tag: 'unread', reason })),
  )
