import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import { Hex } from 'effect/encoding'

import type { RunIdentity } from './bench-run.schema.js'
import { readRunIdentity, type ReadRunIdentityCommand } from './read-run-identity.workflow.js'

export const runIdentityOf = (command: ReadRunIdentityCommand): Effect.Effect<RunIdentity, never, Crypto.Crypto> =>
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    const read = yield* Effect.fromResult(readRunIdentity(command)).pipe(
      Effect.mapError((undecodable) => undecodable.reason),
    )
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
    Effect.catch((reason) => Effect.succeed<RunIdentity>({ _tag: 'unread', file: command.file, reason })),
  )
