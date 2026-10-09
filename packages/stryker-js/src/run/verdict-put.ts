import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Ref from 'effect/Ref'

import type { CurrentVerdict } from '../IncrementalDiff.schema.js'
import type { VerdictEntry } from '../verdict-store/VerdictEntry.schema.js'
import type { VerdictStoreShape } from '../verdict-store/VerdictStore.service.js'
import type { IncrementalReuse } from './incremental-reuse.cell.js'
import { settledEntryOf } from './settled-verdict.js'

export interface VerdictPut {
  readonly store: VerdictStoreShape
  readonly reuse: IncrementalReuse
  readonly skippedPuts: Ref.Ref<number>
}

const withProgramDigestFor = (
  reuse: IncrementalReuse,
  result: Mutant.RunMutantResult,
  current: CurrentVerdict,
): Effect.Effect<CurrentVerdict> =>
  Boolean.match(Boolean.and(result.status === 'CompileError', current.programDigest === undefined), {
    onTrue: () => Effect.map(reuse.programDigestOf, (programDigest) => ({ ...current, programDigest })),
    onFalse: () => Effect.succeed(current),
  })

const putEntry = (put: VerdictPut, entry: VerdictEntry): Effect.Effect<void> =>
  Effect.flatMap(put.store.put(entry), (outcome) =>
    Match.valueTags(outcome, {
      EntryWritten: () => Effect.void,
      PutSkipped: ({ reason }) =>
        Effect.logDebug(`The verdict of mutant ${entry.components.mutantId} was not stored: ${reason}`).pipe(
          Effect.andThen(Ref.update(put.skippedPuts, (count) => count + 1)),
        ),
    }))

export const putSettledVerdict = (put: VerdictPut) => (result: Mutant.RunMutantResult): Effect.Effect<void> =>
  Option.match(Record.get(put.reuse.currentByMutantId, result.id), {
    onNone: () => Effect.void,
    onSome: (current) =>
      Effect.gen(function*() {
        const entry = settledEntryOf({
          result,
          current: yield* withProgramDigestFor(put.reuse, result, current),
          evidence: put.reuse.timeoutEvidenceByMutantId[result.id],
          settledAt: yield* Clock.currentTimeMillis,
        })
        yield* Option.match(entry, {
          onNone: () => Effect.void,
          onSome: (present) => putEntry(put, present),
        })
      }),
  })
