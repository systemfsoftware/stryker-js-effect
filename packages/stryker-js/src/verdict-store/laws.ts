import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'

import { entryDirectoryOf, entryNameOf } from './verdict-blobs.js'
import {
  type CheckerEntry,
  CheckerEntrySchema,
  type TestedEntry,
  TestedEntrySchema,
  type VerdictEntry,
  VerdictEntryJson,
} from './VerdictEntry.schema.js'
import { verdictKeyOf } from './VerdictKey.js'
import type { GetOutcome, ListedEntry, ListOutcome, PutOutcome } from './VerdictStore.schema.js'
import { VerdictStore } from './VerdictStore.service.js'

export interface VerdictStoreHarnessShape {
  readonly plant: (name: string, text: string) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

export class VerdictStoreHarness extends Context.Service<VerdictStoreHarness, VerdictStoreHarnessShape>()(
  '@systemfsoftware/stryker-js/verdict-store/laws/VerdictStoreHarness',
) {}

export interface LawObservation {
  readonly observed: ReadonlyArray<string>
  readonly expected: ReadonlyArray<string>
}

export interface VerdictStoreLaw {
  readonly law: string
  readonly history: Effect.Effect<LawObservation, never, VerdictStore | VerdictStoreHarness>
}

type LawEffect = Effect.Effect<LawObservation, never, VerdictStore | VerdictStoreHarness>

interface FixtureLaw {
  readonly law: string
  readonly history: (fixtures: Fixtures) => LawEffect
}

const decodeTested = S.decodeUnknownEffect(TestedEntrySchema)
const decodeChecker = S.decodeUnknownEffect(CheckerEntrySchema)
const encodeEntry = S.encodeUnknownOption(VerdictEntryJson)

const digestOf = (seed: string): string => seed.repeat(64)

const testedFixtureEncoded = {
  components: {
    _tag: 'tested',
    engineDigest: digestOf('e'),
    runInputsDigest: digestOf('1'),
    mutantSetPolicy: 'default',
    mutantId: '0123456789abcdef',
    fileName: 'src/math.ts',
    mutatorName: 'ArithmeticOperator',
    replacementDigest: digestOf('2'),
    location: { start: { line: 3, column: 10 }, end: { line: 3, column: 15 } },
    fileContentDigest: digestOf('3'),
    coveringTestIds: ['adds two numbers'],
    closureDigest: digestOf('4'),
    checkerConfigDigest: digestOf('5'),
  },
  status: 'Survived',
  coveredBy: ['adds two numbers'],
  costMs: 12,
  settledAt: 1_000,
}

const checkerFixtureEncoded = {
  components: {
    _tag: 'checker',
    engineDigest: digestOf('e'),
    runInputsDigest: digestOf('1'),
    mutantSetPolicy: 'default',
    mutantId: '0123456789abcdef',
    fileName: 'src/math.ts',
    mutatorName: 'ArithmeticOperator',
    replacementDigest: digestOf('2'),
    location: { start: { line: 3, column: 10 }, end: { line: 3, column: 15 } },
    fileContentDigest: digestOf('3'),
    programDigest: digestOf('6'),
  },
  status: 'CompileError',
  costMs: 40,
  settledAt: 1_100,
}

const otherMutantFixtureEncoded = {
  components: {
    _tag: 'tested',
    engineDigest: digestOf('e'),
    runInputsDigest: digestOf('1'),
    mutantSetPolicy: 'default',
    mutantId: 'fedcba9876543210',
    fileName: 'src/math.ts',
    mutatorName: 'EqualityOperator',
    replacementDigest: digestOf('7'),
    location: { start: { line: 8, column: 7 }, end: { line: 8, column: 14 } },
    fileContentDigest: digestOf('3'),
    coveringTestIds: ['compares two numbers'],
    closureDigest: digestOf('4'),
    checkerConfigDigest: digestOf('5'),
  },
  status: 'Killed',
  killedBy: ['compares two numbers'],
  costMs: 9,
  settledAt: 1_200,
}

interface Fixtures {
  readonly tested: TestedEntry
  readonly checker: CheckerEntry
  readonly otherMutant: TestedEntry
}

const fixtures: Effect.Effect<Fixtures> = Effect.all({
  tested: decodeTested(testedFixtureEncoded),
  checker: decodeChecker(checkerFixtureEncoded),
  otherMutant: decodeTested(otherMutantFixtureEncoded),
}).pipe(Effect.orDie)

const unreproducedTimeoutOf = (f: Fixtures): TestedEntry => ({
  ...f.tested,
  status: 'Timeout',
  timeoutKind: 'wallClock',
  reproductions: 0,
})

const reproducedTimeoutOf = (f: Fixtures): TestedEntry => ({
  ...unreproducedTimeoutOf(f),
  reproductions: 1,
  settledAt: 2_000,
})

const CONCURRENT_WRITERS = 16

const textOf = (entry: VerdictEntry): string => Option.getOrElse(encodeEntry(entry), () => '')

const keyOf = (entry: VerdictEntry): string => verdictKeyOf(entry.components)

const describeGet = (outcome: GetOutcome): string =>
  Match.valueTags(outcome, {
    EntryFound: (found) => `found ${textOf(found.entry)}`,
    EntryAbsent: () => 'absent',
    EntryUnreadable: (unreadable) => `unreadable ${unreadable.key}`,
    StoreUnavailable: (unavailable) => `unavailable ${unavailable.reason}`,
  })

const describePut = (outcome: PutOutcome): string =>
  Match.valueTags(outcome, {
    EntryWritten: (written) => `written ${written.key}`,
    PutSkipped: (skipped) => `skipped ${skipped.reason}`,
  })

const describeListed = (listed: ListedEntry): string => `${listed._tag} ${listed.kind} ${listed.key}`

const describeList = (outcome: ListOutcome): ReadonlyArray<string> =>
  Match.valueTags(outcome, {
    EntriesListed: (listed) => Arr.sort(listed.entries.map(describeListed), Order.String),
    StoreUnavailable: (unavailable) => [`unavailable ${unavailable.reason}`],
  })

const readable = (entry: VerdictEntry): string => `Readable ${entry.components._tag} ${keyOf(entry)}`

const listedLines = (entries: ReadonlyArray<string>): ReadonlyArray<string> => Arr.sort(entries, Order.String)

const get = (entry: VerdictEntry) =>
  VerdictStore.use((store) => store.get(entry.components)).pipe(Effect.map(describeGet))

const put = (entry: VerdictEntry) => VerdictStore.use((store) => store.put(entry)).pipe(Effect.map(describePut))

const list = (mutantId: Mutant.MutantId) =>
  VerdictStore.use((store) => store.list(mutantId)).pipe(Effect.map(describeList))

const plant = (name: string, text: string) => VerdictStoreHarness.use((harness) => harness.plant(name, text))

const reset = VerdictStoreHarness.use((harness) => harness.reset)

const readAfterWrite: FixtureLaw = {
  law: 'a verdict read back after it is written is the verdict that was written, every time',
  history: (f) =>
    Effect.gen(function*() {
      const written = yield* put(f.tested)
      const first = yield* get(f.tested)
      const second = yield* get(f.tested)
      return {
        observed: [written, first, second],
        expected: [
          `written ${keyOf(f.tested)}`,
          `found ${textOf(f.tested)}`,
          `found ${textOf(f.tested)}`,
        ],
      }
    }),
}

const emptyStoreMisses: FixtureLaw = {
  law: 'an empty store has no verdict and lists nothing for a mutant',
  history: (f) =>
    Effect.gen(function*() {
      const read = yield* get(f.tested)
      const listed = yield* list(f.tested.components.mutantId)
      return { observed: [read, ...listed], expected: ['absent'] }
    }),
}

const snapshotAfter = (f: Fixtures, first: VerdictEntry, second: VerdictEntry) =>
  Effect.gen(function*() {
    yield* reset
    yield* put(first)
    yield* put(second)
    const reads = [yield* get(f.tested), yield* get(f.checker)]
    return [...reads, ...(yield* list(f.tested.components.mutantId))]
  })

const differentKeysCommute: FixtureLaw = {
  law: 'writing two verdicts for one mutant in either order leaves the same store',
  history: (f) =>
    Effect.gen(function*() {
      const forward = yield* snapshotAfter(f, f.tested, f.checker)
      const backward = yield* snapshotAfter(f, f.checker, f.tested)
      const expected = [
        `found ${textOf(f.tested)}`,
        `found ${textOf(f.checker)}`,
        ...listedLines([readable(f.tested), readable(f.checker)]),
      ]
      return { observed: [...forward, ...backward], expected: [...expected, ...expected] }
    }),
}

const lastWriteWins: FixtureLaw = {
  law: 'a reproduced timeout replaces the unreproduced one under the same key',
  history: (f) =>
    Effect.gen(function*() {
      const unreproducedTimeout = unreproducedTimeoutOf(f)
      const reproducedTimeout = reproducedTimeoutOf(f)
      yield* put(unreproducedTimeout)
      yield* put(reproducedTimeout)
      const read = yield* get(reproducedTimeout)
      const listed = yield* list(reproducedTimeout.components.mutantId)
      return {
        observed: [read, ...listed],
        expected: [`found ${textOf(reproducedTimeout)}`, readable(reproducedTimeout)],
      }
    }),
}

const writerEntriesOf = (f: Fixtures): ReadonlyArray<VerdictEntry> =>
  Arr.makeBy(
    CONCURRENT_WRITERS,
    (writer): VerdictEntry => ({ ...f.tested, costMs: writer + 1, settledAt: 3_000 + writer }),
  )

const isOneWritten = (written: ReadonlyArray<VerdictEntry>, line: string): string =>
  Arr.contains(written.map((entry) => `found ${textOf(entry)}`), line)
    ? 'found one of the written verdicts whole'
    : line

const concurrentWritersSettleOnOne: FixtureLaw = {
  law: 'parallel shards writing one verdict at the same time leave exactly one whole verdict',
  history: (f) =>
    Effect.gen(function*() {
      const writerEntries = writerEntriesOf(f)
      yield* Effect.forEach(writerEntries, put, { concurrency: 'unbounded', discard: true })
      const read = yield* get(f.tested)
      const listed = yield* list(f.tested.components.mutantId)
      return {
        observed: [isOneWritten(writerEntries, read), ...listed],
        expected: ['found one of the written verdicts whole', readable(f.tested)],
      }
    }),
}

const TORN_LENGTH = 12

const tornEntryMisses: FixtureLaw = {
  law: 'a verdict cut off mid-write reads as unreadable instead of failing the run',
  history: (f) =>
    Effect.gen(function*() {
      yield* plant(entryNameOf(f.tested.components), textOf(f.tested).slice(0, TORN_LENGTH))
      const read = yield* get(f.tested)
      const listed = yield* list(f.tested.components.mutantId)
      return {
        observed: [read, ...listed],
        expected: [`unreadable ${keyOf(f.tested)}`, `Unreadable tested ${keyOf(f.tested)}`],
      }
    }),
}

const misplacedEntryMisses: FixtureLaw = {
  law: "a verdict stored under another verdict's name is never reused",
  history: (f) =>
    Effect.gen(function*() {
      yield* plant(entryNameOf(f.tested.components), textOf(f.otherMutant))
      const read = yield* get(f.tested)
      return { observed: [read], expected: [`unreadable ${keyOf(f.tested)}`] }
    }),
}

const strayFilesIgnored: FixtureLaw = {
  law: 'a half-written temporary file beside the verdicts is invisible',
  history: (f) =>
    Effect.gen(function*() {
      const directory = entryDirectoryOf(f.tested.components.mutantId)
      yield* plant(`${directory}/.tested-${keyOf(f.tested)}.json.4fz1.tmp`, textOf(f.tested))
      const read = yield* get(f.tested)
      const listed = yield* list(f.tested.components.mutantId)
      return { observed: [read, ...listed], expected: ['absent'] }
    }),
}

const listingStaysWithItsMutant: FixtureLaw = {
  law: "listing a mutant names only that mutant's verdicts",
  history: (f) =>
    Effect.gen(function*() {
      yield* put(f.tested)
      yield* put(f.checker)
      yield* put(f.otherMutant)
      const own = yield* list(f.tested.components.mutantId)
      const other = yield* list(f.otherMutant.components.mutantId)
      return {
        observed: [...own, ...other],
        expected: [...listedLines([readable(f.tested), readable(f.checker)]), readable(f.otherMutant)],
      }
    }),
}

const laws: ReadonlyArray<FixtureLaw> = [
  readAfterWrite,
  emptyStoreMisses,
  differentKeysCommute,
  lastWriteWins,
  concurrentWritersSettleOnOne,
  tornEntryMisses,
  misplacedEntryMisses,
  strayFilesIgnored,
  listingStaysWithItsMutant,
]

export const verdictStoreLaws: ReadonlyArray<VerdictStoreLaw> = laws.map((fixtureLaw) => ({
  law: fixtureLaw.law,
  history: Effect.flatMap(fixtures, fixtureLaw.history),
}))
