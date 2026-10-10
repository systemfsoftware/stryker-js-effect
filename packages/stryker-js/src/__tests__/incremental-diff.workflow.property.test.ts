import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  incrementalDiff,
  IncrementalDiffCommand,
  type IncrementalDiffDecision,
  MutantRemembered,
  MutantToRun,
} from '../incremental-diff.workflow.js'
import type { CurrentVerdict, VerdictLookup } from '../IncrementalDiff.schema.js'
import { currentKeysOf } from '../run/current-verdict.js'
import {
  CheckerEntrySchema,
  type SharedComponents,
  type SurvivedTestedEntry,
  type TestedEntry,
  TestedEntrySchema,
  type VerdictComponents,
  type VerdictEntry,
  VerdictEntrySchema,
  type VerdictKind,
} from '../verdict-store/VerdictEntry.schema.js'
import { verdictKeyOf } from '../verdict-store/VerdictKey.js'
import type { ListedEntry } from '../verdict-store/VerdictStore.schema.js'

const DRIFTS = [
  'semanticsChanged',
  'policyChanged',
  'runInputsChanged',
  'checkerConfigChanged',
  'programChanged',
  'closureAnalysisFailed',
  'closureChanged',
] as const

type Drift = typeof DRIFTS[number]

const sharedOf = (components: VerdictComponents): SharedComponents => ({
  engineDigest: components.engineDigest,
  runInputsDigest: components.runInputsDigest,
  mutantSetPolicy: components.mutantSetPolicy,
  mutantId: components.mutantId,
  fileName: components.fileName,
  mutatorName: components.mutatorName,
  replacementDigest: components.replacementDigest,
  location: components.location,
  fileContentDigest: components.fileContentDigest,
})

const staleOf = (entry: VerdictEntry): VerdictEntry =>
  Match.valueTags(entry.components, {
    tested: (components): VerdictEntry => {
      const staleComponents = { ...components, engineDigest: drifted(components.engineDigest) }
      return S.is(TestedEntrySchema)(entry)
        ? { ...entry, components: staleComponents, settledAt: entry.settledAt + 1 }
        : { components: staleComponents, status: 'Survived', costMs: entry.costMs, settledAt: entry.settledAt + 1 }
    },
    checker: (components): VerdictEntry => ({
      components: { ...components, engineDigest: drifted(components.engineDigest) },
      status: 'CompileError',
      costMs: entry.costMs,
      settledAt: entry.settledAt + 1,
    }),
  })

const currentOf = (entry: VerdictEntry): CurrentVerdict =>
  Match.valueTags(entry.components, {
    tested: (tested): CurrentVerdict => ({
      shared: sharedOf(tested),
      coveringTestIds: tested.coveringTestIds,
      closureDigest: tested.closureDigest,
      checkerConfigDigest: tested.checkerConfigDigest,
    }),
    checker: (checker): CurrentVerdict => ({ shared: sharedOf(checker), programDigest: checker.programDigest }),
  })

const kindOf = (entry: VerdictEntry): VerdictKind =>
  Match.valueTags(entry.components, { tested: (): VerdictKind => 'tested', checker: (): VerdictKind => 'checker' })

const readable = (entry: VerdictEntry): ListedEntry => ({
  _tag: 'Readable',
  kind: kindOf(entry),
  key: verdictKeyOf(entry.components),
  entry,
})

const unreadable = (entry: VerdictEntry): ListedEntry => ({
  _tag: 'Unreadable',
  kind: kindOf(entry),
  key: verdictKeyOf(entry.components),
})

const mutantOf = (current: CurrentVerdict, isStatic = false): Mutant.Mutant =>
  Mutant.Mutant.make({
    id: current.shared.mutantId,
    fileName: current.shared.fileName,
    mutatorName: current.shared.mutatorName,
    replacement: '',
    location: current.shared.location,
    ...(isStatic ? { static: true } : {}),
  })

const lookupOf = (
  current: CurrentVerdict,
  entries: ReadonlyArray<ListedEntry>,
  fields: { readonly unavailable?: boolean; readonly static?: boolean } = {},
): VerdictLookup => ({
  mutant: mutantOf(current, fields.static),
  current,
  currentKeys: [...currentKeysOf(current)],
  entries: [...entries],
  unavailable: fields.unavailable ?? false,
})

interface CommandFields {
  readonly closureAnalysisFailed?: boolean
  readonly force?: boolean
  readonly flakyMutantIds?: ReadonlyArray<Mutant.MutantId>
}

const commandOf = (lookups: ReadonlyArray<VerdictLookup>, fields: CommandFields = {}): IncrementalDiffCommand =>
  IncrementalDiffCommand.make({
    lookups: [...lookups],
    closureAnalysisFailed: fields.closureAnalysisFailed ?? false,
    force: fields.force ?? false,
    ...(fields.flakyMutantIds === undefined ? {} : { flakyMutantIds: [...fields.flakyMutantIds] }),
  })

const matchingLookupOf = (entry: VerdictEntry): VerdictLookup => lookupOf(currentOf(entry), [readable(entry)])

const onlyDecision = (
  result: Result.Result<readonly IncrementalDiffDecision[], never>,
): IncrementalDiffDecision | undefined =>
  Result.isSuccess(result) && result.success.length === 1 ? result.success[0] : undefined

const runsWithRefusal = (
  result: Result.Result<readonly IncrementalDiffDecision[], never>,
  refusal: string,
): boolean => {
  const decision = onlyDecision(result)
  return decision !== undefined && S.is(MutantToRun)(decision) && decision.refusal === refusal
}

const remembersStatus = (result: Result.Result<readonly IncrementalDiffDecision[], never>, status: string): boolean => {
  const decision = onlyDecision(result)
  return decision !== undefined && S.is(MutantRemembered)(decision) && decision.status === status
}

const drifted = (value: string | undefined): string => `${value ?? ''}-drifted`

interface Scenario {
  readonly current: CurrentVerdict
  readonly closureAnalysisFailed: boolean
}

const withShared = (scenario: Scenario, shared: Partial<SharedComponents>): Scenario => ({
  ...scenario,
  current: { ...scenario.current, shared: { ...scenario.current.shared, ...shared } },
})

const driftOf: Readonly<Record<Drift, (scenario: Scenario) => Scenario>> = {
  semanticsChanged: (s) => withShared(s, { engineDigest: drifted(s.current.shared.engineDigest) }),
  policyChanged: (s) =>
    withShared(s, { mutantSetPolicy: s.current.shared.mutantSetPolicy === 'default' ? 'full' : 'default' }),
  runInputsChanged: (s) => withShared(s, { runInputsDigest: drifted(s.current.shared.runInputsDigest) }),
  checkerConfigChanged: (s) => ({
    ...s,
    current: { ...s.current, checkerConfigDigest: drifted(s.current.checkerConfigDigest) },
  }),
  programChanged: (s) => ({ ...s, current: { ...s.current, programDigest: drifted(s.current.programDigest) } }),
  closureAnalysisFailed: (s) => {
    const { closureDigest: _dropped, ...withoutClosure } = s.current
    return { current: withoutClosure, closureAnalysisFailed: true }
  },
  closureChanged: (s) => withShared(s, { fileContentDigest: drifted(s.current.shared.fileContentDigest) }),
}

const appliesTo = (entry: VerdictEntry, drift: Drift): boolean =>
  Match.valueTags(entry.components, {
    tested: () => drift !== 'programChanged',
    checker: () => drift !== 'checkerConfigChanged',
  })

const survivorOf = (entry: TestedEntry): SurvivedTestedEntry =>
  Match.value(entry).pipe(
    Match.discriminatorsExhaustive('status')({
      Survived: (survived): SurvivedTestedEntry => survived,
      NoCoverage: (noCoverage): SurvivedTestedEntry => ({ ...noCoverage, status: 'Survived' }),
      Killed: ({ killedBy: _killedBy, ...rest }): SurvivedTestedEntry => ({ ...rest, status: 'Survived' }),
      Timeout: ({ timeoutKind: _timeoutKind, reproductions: _reproductions, ...rest }): SurvivedTestedEntry => ({
        ...rest,
        status: 'Survived',
      }),
      Ignored: ({ statusReason: _statusReason, ...rest }): SurvivedTestedEntry => ({ ...rest, status: 'Survived' }),
    }),
  )

describe('incrementalDiff', () => {
  it.prop(
    '∀e_Entries_≡ForceRunsEveryMutantInOrderNamingNoPriorRecord',
    { of: [S.Array(VerdictEntrySchema)], subject: incrementalDiff },
    (subject, [entries]) => {
      const lookups = entries.map(matchingLookupOf)
      const result = subject(commandOf(lookups, { force: true }))
      return Result.isSuccess(result) && result.success.length === lookups.length &&
        result.success.every((decision, index) =>
          S.is(MutantToRun)(decision) && decision.mutant.id === lookups[index]?.mutant.id &&
          decision.refusal === 'noPriorRecord'
        )
    },
  )

  it.prop(
    '∀ed_EntryAndDrifts_≡TheHighestRankedDriftNamesTheRefusalAndAnInapplicableDriftChangesNothing',
    { of: [VerdictEntrySchema, S.Array(S.Literals(DRIFTS))], subject: incrementalDiff },
    (subject, [entry, drifts]) => {
      const scenario = Arr.dedupe(drifts).reduce(
        (accumulated, drift) => driftOf[drift](accumulated),
        { current: currentOf(entry), closureAnalysisFailed: false },
      )
      const result = subject(
        commandOf([lookupOf(scenario.current, [readable(entry)])], {
          closureAnalysisFailed: scenario.closureAnalysisFailed,
        }),
      )
      const expected = DRIFTS.find((drift) => drifts.includes(drift) && appliesTo(entry, drift))
      return expected !== undefined
        ? runsWithRefusal(result, expected)
        : JSON.stringify(result) === JSON.stringify(subject(commandOf([matchingLookupOf(entry)])))
    },
  )

  it.prop(
    '∀e_Entry_≡AMatchingEntryIsRememberedWithItsStatusAndReasonUnlessItIsAnUnreproducedWallClockTimeout',
    { of: [VerdictEntrySchema], subject: incrementalDiff },
    (subject, [entry]) => {
      const result = subject(commandOf([matchingLookupOf(entry)]))
      const decision = onlyDecision(result)
      const unreproduced = S.is(TestedEntrySchema)(entry) && entry.status === 'Timeout' &&
        entry.timeoutKind !== 'hitLimit' && (entry.reproductions ?? 0) < 1
      return unreproduced
        ? runsWithRefusal(result, 'timeoutUnreproduced')
        : decision !== undefined && S.is(MutantRemembered)(decision) &&
          decision.mutantId === entry.components.mutantId && decision.status === entry.status &&
          decision.statusReason === entry.statusReason
    },
  )

  it.prop(
    '∀tcb_TestedAndCheckerEntries_≡TheNewestCurrentEntryIsRememberedWhateverItsKind',
    { of: [TestedEntrySchema, CheckerEntrySchema, S.Boolean], subject: incrementalDiff },
    (subject, [tested, checker, checkerIsNewer]) => {
      const survivor = survivorOf(tested)
      const compileError: VerdictEntry = {
        ...checker,
        components: { ...checker.components, ...sharedOf(survivor.components) },
      }
      const current: CurrentVerdict = { ...currentOf(survivor), programDigest: checker.components.programDigest }
      const entries = checkerIsNewer
        ? [readable({ ...survivor, settledAt: 1 }), readable({ ...compileError, settledAt: 2 })]
        : [readable({ ...compileError, settledAt: 1 }), readable({ ...survivor, settledAt: 2 })]
      return remembersStatus(
        subject(commandOf([lookupOf(current, entries)])),
        checkerIsNewer ? 'CompileError' : 'Survived',
      )
    },
  )

  it.prop(
    '∀er_EntryAndReproductions_≡AWallClockTimeoutIsRememberedExactlyWhenItReproduced',
    { of: [TestedEntrySchema, S.Natural], subject: incrementalDiff },
    (subject, [tested, reproductions]) => {
      const entry: TestedEntry = { ...survivorOf(tested), status: 'Timeout', timeoutKind: 'wallClock', reproductions }
      const decision = onlyDecision(subject(commandOf([matchingLookupOf(entry)])))
      if (decision === undefined) {
        return false
      }
      return reproductions >= 1
        ? S.is(MutantRemembered)(decision) && decision.status === 'Timeout' && decision.timeoutKind === 'wallClock' &&
          decision.reproductions === reproductions
        : S.is(MutantToRun)(decision) && decision.refusal === 'timeoutUnreproduced' &&
          decision.priorTimeout?.timeoutKind === 'wallClock'
    },
  )

  it.prop(
    '∀e_Entry_≡AHitLimitTimeoutIsRememberedOnFirstSight',
    { of: [TestedEntrySchema], subject: incrementalDiff },
    (subject, [tested]) => {
      const entry: TestedEntry = { ...survivorOf(tested), status: 'Timeout', timeoutKind: 'hitLimit', reproductions: 0 }
      return remembersStatus(subject(commandOf([matchingLookupOf(entry)])), 'Timeout')
    },
  )

  it.prop(
    '∀e_Entry_≡ACurrentEntryIsRememberedBesideANewerStaleOne',
    { of: [TestedEntrySchema], subject: incrementalDiff },
    (subject, [tested]) => {
      const entry = survivorOf(tested)
      const stale: TestedEntry = {
        ...entry,
        status: 'Killed',
        components: { ...entry.components, engineDigest: drifted(entry.components.engineDigest) },
        settledAt: entry.settledAt + 1,
      }
      return remembersStatus(
        subject(commandOf([lookupOf(currentOf(entry), [readable(stale), readable(entry)])])),
        'Survived',
      )
    },
  )

  it.prop(
    '∀ett_EntryAndTimes_≡WithoutACurrentEntryTheNewestStaleEntryNamesTheRefusal',
    { of: [TestedEntrySchema, S.Natural, S.Natural], subject: incrementalDiff },
    (subject, [entry, first, drawn]) => {
      const second = drawn === first ? first + 1 : drawn
      const semantics: TestedEntry = {
        ...entry,
        components: { ...entry.components, engineDigest: drifted(entry.components.engineDigest) },
        settledAt: first,
      }
      const runInputs: TestedEntry = {
        ...entry,
        components: { ...entry.components, runInputsDigest: drifted(entry.components.runInputsDigest) },
        settledAt: second,
      }
      const result = subject(commandOf([lookupOf(currentOf(entry), [readable(semantics), readable(runInputs)])]))
      return runsWithRefusal(result, first > second ? 'semanticsChanged' : 'runInputsChanged')
    },
  )

  it.prop(
    '∀e_Entry_≡AnUnreadableCurrentEntryNamesEntryUnreadableOverAReadableStaleOne',
    { of: [VerdictEntrySchema], subject: incrementalDiff },
    (subject, [entry]) => {
      const stale = staleOf(entry)
      return runsWithRefusal(
        subject(commandOf([lookupOf(currentOf(entry), [unreadable(entry), readable(stale)])])),
        'entryUnreadable',
      )
    },
  )

  it.prop(
    '∀e_Entry_≡OnlyUnreadableStaleEntriesNameEntryUnreadable',
    { of: [VerdictEntrySchema], subject: incrementalDiff },
    (subject, [entry]) => {
      const current = driftOf.semanticsChanged({ current: currentOf(entry), closureAnalysisFailed: false }).current
      return runsWithRefusal(subject(commandOf([lookupOf(current, [unreadable(entry)])])), 'entryUnreadable')
    },
  )

  it.prop(
    '∀e_Entry_≡AnUnavailableStoreRunsTheMutantNamingStoreUnavailable',
    { of: [VerdictEntrySchema], subject: incrementalDiff },
    (subject, [entry]) =>
      runsWithRefusal(
        subject(commandOf([lookupOf(currentOf(entry), [], { unavailable: true })])),
        'storeUnavailable',
      ),
  )

  it.prop(
    '∀efu_EntryFlakyIdAndAvailability_≡AStaticMutantIsFlakyDependentWheneverTheFlakeSetIsNotEmpty',
    { of: [VerdictEntrySchema, Mutant.MutantId, S.Boolean], subject: incrementalDiff },
    (subject, [entry, flakyId, unavailable]) => {
      const lookup = lookupOf(currentOf(entry), unavailable ? [] : [readable(entry)], { unavailable, static: true })
      return runsWithRefusal(subject(commandOf([lookup], { flakyMutantIds: [flakyId] })), 'flakyDependency')
    },
  )

  it.prop(
    '∀e_Entry_≡ACheckerEntryIsRememberedWithoutATestedKey',
    { of: [CheckerEntrySchema], subject: incrementalDiff },
    (subject, [entry]) => remembersStatus(subject(commandOf([matchingLookupOf(entry)])), 'CompileError'),
  )

  it.prop(
    '∀e_CheckerEntry_≡AFailedClosureAnalysisRunsAMatchingCompileErrorNamingClosureAnalysisFailed',
    { of: [CheckerEntrySchema], subject: incrementalDiff },
    (subject, [entry]) =>
      runsWithRefusal(
        subject(commandOf([matchingLookupOf(entry)], { closureAnalysisFailed: true })),
        'closureAnalysisFailed',
      ),
  )
})
