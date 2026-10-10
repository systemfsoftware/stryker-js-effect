import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'
import { SharedComponentsSchema, TimeoutKindSchema, VerdictKey } from './verdict-store/VerdictEntry.schema.js'
import { ListedEntrySchema } from './verdict-store/VerdictStore.schema.js'

export const ReuseRefusalReasonSchema = S.Literals([
  'semanticsChanged',
  'policyChanged',
  'runInputsChanged',
  'checkerConfigChanged',
  'closureChanged',
  'closureAnalysisFailed',
  'programChanged',
  'flakyDependency',
  'timeoutUnreproduced',
  'entryUnreadable',
  'storeUnavailable',
  'noPriorRecord',
])

export type ReuseRefusalReason = typeof ReuseRefusalReasonSchema.Type

export const RefusalCountsSchema = S.Record(ReuseRefusalReasonSchema, Report.NonNegativeInt)
export type RefusalCounts = typeof RefusalCountsSchema.Type

export const TimeoutEvidenceSchema = S.Struct({
  timeoutKind: TimeoutKindSchema,
  reproductions: S.Natural,
})

export type TimeoutEvidence = S.Schema.Type<typeof TimeoutEvidenceSchema>

export const CurrentVerdictSchema = S.Struct({
  shared: SharedComponentsSchema,
  coveringTestIds: S.String.pipe(S.Array, S.optional),
  closureDigest: S.optional(S.String),
  checkerConfigDigest: S.optional(S.String),
  programDigest: S.optional(S.String),
})

export type CurrentVerdict = S.Schema.Type<typeof CurrentVerdictSchema>

export const VerdictLookupSchema = S.Struct({
  mutant: Mutant.Mutant,
  current: CurrentVerdictSchema,
  currentKeys: S.Array(VerdictKey),
  entries: S.Array(ListedEntrySchema),
  unavailable: S.Boolean,
})

export type VerdictLookup = S.Schema.Type<typeof VerdictLookupSchema>
