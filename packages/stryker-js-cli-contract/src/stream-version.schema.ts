import * as S from 'effect/Schema'

export const StreamSchemaVersion = S.Literal('1.1')
export type StreamSchemaVersion = typeof StreamSchemaVersion.Type
