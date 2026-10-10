import * as S from 'effect/Schema'

export const StreamSchemaVersion = S.Literal('7.0')
export type StreamSchemaVersion = typeof StreamSchemaVersion.Type
