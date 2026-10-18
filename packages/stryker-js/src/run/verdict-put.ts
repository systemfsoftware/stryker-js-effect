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

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Logger = await import('effect/Logger')
  const References = await import('effect/References')
  const { RefusalCountsSchema } = await import('../IncrementalDiff.schema.js')
  const { VerdictEntrySchema } = await import('../verdict-store/VerdictEntry.schema.js')
  const { EntriesListed, EntryAbsent, PutSkipped } = await import('../verdict-store/VerdictStore.schema.js')

  const SKIP_REASON = 'the verdict store refused the write'

  const skippingStore: VerdictStoreShape = {
    get: () => Effect.succeed(EntryAbsent.make({})),
    put: () => Effect.succeed(PutSkipped.make({ reason: SKIP_REASON })),
    list: () => Effect.succeed(EntriesListed.make({ entries: [] })),
    killingTests: () => Effect.succeed([]),
  }

  const reuseOf = (refusalCounts: IncrementalReuse['refusalCounts']): IncrementalReuse => ({
    mutants: [],
    rememberedResults: [],
    refusalCounts,
    timeoutEvidenceByMutantId: {},
    priorKilledByByMutantId: {},
    currentByMutantId: {},
    priorEntries: [],
    programDigestOf: Effect.succeed('0'.repeat(64)),
  })

  interface Observation {
    readonly skipped: number
    readonly logged: ReadonlyArray<string>
  }

  const observationOf = (
    subject: typeof putEntry,
    entry: VerdictEntry,
    refusalCounts: IncrementalReuse['refusalCounts'],
  ): Observation => {
    const logged: Array<string> = []
    const capturing = Logger.make((log) => {
      logged.push([log.message].flat().map(String).join(' '))
    })
    const skipped = Effect.runSync(
      Effect.gen(function*() {
        const skippedPuts = yield* Ref.make(0)
        yield* subject({ store: skippingStore, reuse: reuseOf(refusalCounts), skippedPuts }, entry)
        return yield* Ref.get(skippedPuts)
      }).pipe(
        Effect.provideService(References.MinimumLogLevel, 'Debug'),
        Effect.provide(Logger.layer([capturing])),
      ),
    )
    return { skipped, logged }
  }

  it.prop(
    '∀ec_EntryAndRefusalCounts_≡ASkippedVerdictWriteIsCountedAndLogged',
    { of: [VerdictEntrySchema, RefusalCountsSchema], subject: putEntry },
    (subject, [entry, refusalCounts]) => {
      const observed = observationOf(subject, entry, refusalCounts)
      return observed.skipped === 1 &&
        Arr.contains(
          observed.logged,
          `The verdict of mutant ${entry.components.mutantId} was not stored: ${SKIP_REASON}`,
        )
    },
  )
}
