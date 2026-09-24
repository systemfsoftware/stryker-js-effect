import type * as S from 'effect/Schema'

export type VmJson = S.Schema.Type<typeof S.Json>

export type GlobalValue = VmJson | object
