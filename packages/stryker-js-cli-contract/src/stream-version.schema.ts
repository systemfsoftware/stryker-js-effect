import * as S from 'effect/Schema'

export const StreamSchemaVersion = S.Literal('9.0')
export type StreamSchemaVersion = typeof StreamSchemaVersion.Type
