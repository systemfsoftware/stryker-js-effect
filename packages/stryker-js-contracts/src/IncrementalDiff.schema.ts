import * as S from 'effect/Schema'

export const FormatIdentitySchema = S.Struct({
  formatId: S.String,
  ownerModule: S.String,
  ownerVersion: S.String,
})

export type FormatIdentity = S.Schema.Type<typeof FormatIdentitySchema>

export const TimeoutKindSchema = S.Literals(['wallClock', 'hitLimit'])

export type TimeoutKind = typeof TimeoutKindSchema.Type

export const TimeoutEvidenceSchema = S.Struct({
  timeoutKind: TimeoutKindSchema,
  reproductions: S.Natural,
})

export type TimeoutEvidence = S.Schema.Type<typeof TimeoutEvidenceSchema>
