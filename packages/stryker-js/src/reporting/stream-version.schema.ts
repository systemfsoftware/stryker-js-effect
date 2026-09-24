import * as S from 'effect/Schema'

export const StreamSchemaVersion = S.Literal('1.0')
export type StreamSchemaVersion = typeof StreamSchemaVersion.Type

export const VerdictEnvelopeSchemaVersion = S.Literal('1.1')
export type VerdictEnvelopeSchemaVersion = typeof VerdictEnvelopeSchemaVersion.Type
