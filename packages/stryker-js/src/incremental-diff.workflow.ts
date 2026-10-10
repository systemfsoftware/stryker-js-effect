import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type CurrentVerdict,
  type ReuseRefusalReason,
  ReuseRefusalReasonSchema,
  type TimeoutEvidence,
  TimeoutEvidenceSchema,
  type VerdictLookup,
  VerdictLookupSchema,
} from './IncrementalDiff.schema.js'
import {
  type CheckerEntry,
  CheckerEntrySchema,
  type SharedComponents,
  type TestedEntry,
  TestedEntrySchema,
  TimeoutKindSchema,
  type VerdictEntry,
  type VerdictKey,
} from './verdict-store/VerdictEntry.schema.js'
import type { ListedEntry } from './verdict-store/VerdictStore.schema.js'

const IncrementalDiffTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/IncrementalDiff')
type IncrementalDiffTypeId = typeof IncrementalDiffTypeId

export class IncrementalDiffCommand extends S.TaggedClass<IncrementalDiffCommand>()('IncrementalDiffCommand', {
  lookups: S.Array(VerdictLookupSchema),
  closureAnalysisFailed: S.Boolean,
  force: S.Boolean,
  flakyMutantIds: S.String.pipe(S.Array, S.optional),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    force: 'stryker.incremental_diff.force',
  } as const
}

export class MutantRemembered extends S.TaggedClass<MutantRemembered>()('MutantRemembered', {
  mutantId: Mutant.MutantId,
  status: Mutant.RememberedStatusSchema,
  timeoutKind: S.optional(TimeoutKindSchema),
  reproductions: S.optional(S.Natural),
  testsCompleted: S.optional(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
}) {
  readonly [IncrementalDiffTypeId] = IncrementalDiffTypeId
}

export class MutantToRun extends S.TaggedClass<MutantToRun>()('MutantToRun', {
  mutant: Mutant.Mutant,
  refusal: ReuseRefusalReasonSchema,
  priorTimeout: S.optional(TimeoutEvidenceSchema),
  priorKilledBy: S.String.pipe(S.Array, S.optional),
}) {
  readonly [IncrementalDiffTypeId] = IncrementalDiffTypeId
}

export type IncrementalDiffDecision = MutantRemembered | MutantToRun

const testedOf = (entry: VerdictEntry): Option.Option<TestedEntry> =>
  Option.liftPredicate(entry, S.is(TestedEntrySchema))

const checkerOf = (entry: VerdictEntry): Option.Option<CheckerEntry> =>
  Option.liftPredicate(entry, S.is(CheckerEntrySchema))

interface KeyedEntry {
  readonly key: VerdictKey
  readonly entry: VerdictEntry
}

const newestFirst: Order.Order<KeyedEntry> = Order.mapInput(Order.flip(Order.Number), ({ entry }) => entry.settledAt)

const readableOf = (listed: ListedEntry): ReadonlyArray<KeyedEntry> =>
  Match.valueTags(listed, {
    Readable: ({ key, entry }): ReadonlyArray<KeyedEntry> => [{ key, entry }],
    Unreadable: (): ReadonlyArray<KeyedEntry> => [],
  })

const readableKeyedOf = (lookup: VerdictLookup): ReadonlyArray<KeyedEntry> =>
  Arr.sort(lookup.entries.flatMap(readableOf), newestFirst)

const readableEntriesOf = (lookup: VerdictLookup): ReadonlyArray<VerdictEntry> =>
  readableKeyedOf(lookup).map(({ entry }) => entry)

const unreadableKeyOf = (listed: ListedEntry): ReadonlyArray<VerdictKey> =>
  Match.valueTags(listed, {
    Readable: (): ReadonlyArray<VerdictKey> => [],
    Unreadable: ({ key }): ReadonlyArray<VerdictKey> => [key],
  })

const currentEntryUnreadable = (lookup: VerdictLookup): boolean =>
  lookup.entries.flatMap(unreadableKeyOf).some((key) => lookup.currentKeys.includes(key))

const reproductionsOf = (entry: TestedEntry): number =>
  Option.getOrElse(Option.fromUndefinedOr(entry.reproductions), () => 0)

const isUnreproducedWallClock = (entry: TestedEntry): boolean =>
  Boolean.and(entry.status === 'Timeout', Boolean.and(entry.timeoutKind !== 'hitLimit', reproductionsOf(entry) < 1))

const unreproducedTimeout = (entry: VerdictEntry): boolean => Option.exists(testedOf(entry), isUnreproducedWallClock)

const matchingEntryOf = (lookup: VerdictLookup): Option.Option<VerdictEntry> =>
  Option.map(
    Arr.findFirst(
      readableKeyedOf(lookup),
      ({ key, entry }) => Boolean.and(lookup.currentKeys.includes(key), Boolean.not(unreproducedTimeout(entry))),
    ),
    ({ entry }) => entry,
  )

const rememberedOf = (mutant: Mutant.Mutant, entry: VerdictEntry): MutantRemembered =>
  Option.match(testedOf(entry), {
    onNone: () => MutantRemembered.make({ mutantId: mutant.id, status: entry.status }),
    onSome: (tested) =>
      MutantRemembered.make({
        mutantId: mutant.id,
        status: tested.status,
        timeoutKind: tested.timeoutKind,
        reproductions: tested.reproductions,
        testsCompleted: tested.testsCompleted,
        coveredBy: tested.coveredBy,
        killedBy: tested.killedBy,
      }),
  })

interface Naming {
  readonly entry: VerdictEntry
  readonly current: CurrentVerdict
  readonly closureAnalysisFailed: boolean
}

const locationTextOf = (location: Mutant.Location): string =>
  `${location.start.line}.${location.start.column}-${location.end.line}.${location.end.column}`

const identityTextOf = (shared: SharedComponents): string =>
  [
    shared.fileName,
    shared.mutatorName,
    shared.replacementDigest,
    shared.fileContentDigest,
    locationTextOf(shared.location),
  ]
    .join('\u0000')

const coveringTextOf = (ids: ReadonlyArray<string> | undefined): string | undefined =>
  Option.getOrUndefined(
    Option.map(Option.fromUndefinedOr(ids), (present) => Arr.sort(Arr.dedupe(present), Order.String).join('\u0000')),
  )

const testedClosureChanged = (entry: TestedEntry, current: CurrentVerdict): boolean =>
  Boolean.or(
    entry.components.closureDigest !== current.closureDigest,
    coveringTextOf(entry.components.coveringTestIds) !== coveringTextOf(current.coveringTestIds),
  )

const closureChanged = ({ entry, current }: Naming): boolean =>
  Boolean.or(
    identityTextOf(entry.components) !== identityTextOf(current.shared),
    Option.exists(testedOf(entry), (tested) => testedClosureChanged(tested, current)),
  )

const refusalPrecedence: ReadonlyArray<readonly [ReuseRefusalReason, (naming: Naming) => boolean]> = [
  ['semanticsChanged', ({ entry, current }) => entry.components.engineDigest !== current.shared.engineDigest],
  ['policyChanged', ({ entry, current }) => entry.components.mutantSetPolicy !== current.shared.mutantSetPolicy],
  ['runInputsChanged', ({ entry, current }) => entry.components.runInputsDigest !== current.shared.runInputsDigest],
  [
    'checkerConfigChanged',
    ({ entry, current }) =>
      Option.exists(testedOf(entry), (tested) => tested.components.checkerConfigDigest !== current.checkerConfigDigest),
  ],
  [
    'programChanged',
    ({ entry, current }) =>
      Option.exists(checkerOf(entry), (checker) => checker.components.programDigest !== current.programDigest),
  ],
  ['closureAnalysisFailed', ({ closureAnalysisFailed }) => closureAnalysisFailed],
  ['closureChanged', closureChanged],
  ['timeoutUnreproduced', ({ entry }) => unreproducedTimeout(entry)],
]

const refusalOf = (naming: Naming): ReuseRefusalReason =>
  Option.getOrElse(
    Option.map(Arr.findFirst(refusalPrecedence, ([, applies]) => applies(naming)), ([reason]) => reason),
    (): ReuseRefusalReason => 'noPriorRecord',
  )

const refusalWithoutReadableEntry = (lookup: VerdictLookup): ReuseRefusalReason =>
  Boolean.match(lookup.entries.length > 0, {
    onTrue: (): ReuseRefusalReason => 'entryUnreadable',
    onFalse: (): ReuseRefusalReason => 'noPriorRecord',
  })

const refusalOfLookup = (lookup: VerdictLookup, closureAnalysisFailed: boolean): ReuseRefusalReason =>
  Boolean.match(currentEntryUnreadable(lookup), {
    onTrue: (): ReuseRefusalReason => 'entryUnreadable',
    onFalse: () =>
      Option.match(Arr.head(readableEntriesOf(lookup)), {
        onNone: () => refusalWithoutReadableEntry(lookup),
        onSome: (entry) => refusalOf({ entry, current: lookup.current, closureAnalysisFailed }),
      }),
  })

const timeoutEvidenceOf = (entry: TestedEntry): Option.Option<TimeoutEvidence> =>
  Option.map(
    Option.fromUndefinedOr(entry.timeoutKind),
    (timeoutKind): TimeoutEvidence => ({ timeoutKind, reproductions: reproductionsOf(entry) }),
  )

const priorTimeoutOf = (lookup: VerdictLookup, refusal: ReuseRefusalReason): TimeoutEvidence | undefined =>
  Option.getOrUndefined(
    Option.flatMap(
      Option.filter(Arr.head(readableEntriesOf(lookup)), () => refusal === 'timeoutUnreproduced'),
      (newest) => Option.flatMap(testedOf(newest), timeoutEvidenceOf),
    ),
  )

const sameClosure = (entry: TestedEntry, current: CurrentVerdict): boolean =>
  Boolean.and(current.closureDigest !== undefined, entry.components.closureDigest === current.closureDigest)

const priorKilledByOf = (lookup: VerdictLookup): ReadonlyArray<string> =>
  Arr.dedupe(
    Arr.getSomes(readableEntriesOf(lookup).map(testedOf))
      .filter((entry) => sameClosure(entry, lookup.current))
      .flatMap((entry) => Option.getOrElse(Option.fromUndefinedOr(entry.killedBy), (): ReadonlyArray<string> => [])),
  )

const toRunOf = (lookup: VerdictLookup, refusal: ReuseRefusalReason): MutantToRun =>
  MutantToRun.make({
    mutant: lookup.mutant,
    refusal,
    priorTimeout: priorTimeoutOf(lookup, refusal),
    priorKilledBy: priorKilledByOf(lookup),
  })

const flakyMutantIdsOf = (command: IncrementalDiffCommand): HashSet.HashSet<string> =>
  HashSet.fromIterable(Option.getOrElse(Option.fromUndefinedOr(command.flakyMutantIds), (): readonly string[] => []))

/**
 * A mutant is flaky-dependent when a flaky test covers it — or when it is static and any test is
 * flaky, because a static mutant runs every test in the suite and so inherits every flaky test's
 * instability even though it never appears in the per-test coverage.
 */
const flakyDependent = (flaky: HashSet.HashSet<string>, mutant: Mutant.Mutant): boolean =>
  Boolean.or(HashSet.has(flaky, mutant.id), Boolean.and(mutant.static === true, HashSet.size(flaky) > 0))

const decideFromStore = (command: IncrementalDiffCommand, lookup: VerdictLookup): IncrementalDiffDecision =>
  Option.match(Option.filter(matchingEntryOf(lookup), () => Boolean.not(command.closureAnalysisFailed)), {
    onNone: () => toRunOf(lookup, refusalOfLookup(lookup, command.closureAnalysisFailed)),
    onSome: (entry) => rememberedOf(lookup.mutant, entry),
  })

const decideAvailable = (command: IncrementalDiffCommand, lookup: VerdictLookup): IncrementalDiffDecision =>
  Boolean.match(lookup.unavailable, {
    onTrue: () => toRunOf(lookup, 'storeUnavailable'),
    onFalse: () => decideFromStore(command, lookup),
  })

const decideLookup =
  (command: IncrementalDiffCommand, flaky: HashSet.HashSet<string>) =>
  (lookup: VerdictLookup): IncrementalDiffDecision =>
    Boolean.match(flakyDependent(flaky, lookup.mutant), {
      onTrue: () => toRunOf(lookup, 'flakyDependency'),
      onFalse: () => decideAvailable(command, lookup),
    })

const forcedRun = (lookup: VerdictLookup): IncrementalDiffDecision =>
  MutantToRun.make({ mutant: lookup.mutant, refusal: 'noPriorRecord' })

const decide = (command: IncrementalDiffCommand): Result.Result<readonly IncrementalDiffDecision[], never> => {
  const flaky = flakyMutantIdsOf(command)
  return Result.succeed(
    command.lookups.map(
      Boolean.match(command.force, {
        onTrue: () => forcedRun,
        onFalse: () => decideLookup(command, flaky),
      }),
    ),
  )
}

export const incrementalDiff = Workflow.make({
  command: IncrementalDiffCommand,
  decision: S.Array(S.Union([MutantRemembered, MutantToRun])),
  error: S.Never,
  decide,
})
