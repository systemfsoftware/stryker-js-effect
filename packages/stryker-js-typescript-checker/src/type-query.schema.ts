import * as S from 'effect/Schema'

export const ServerCrash = S.TaggedStruct('ServerCrash', { detail: S.String })
export type ServerCrash = typeof ServerCrash.Type
