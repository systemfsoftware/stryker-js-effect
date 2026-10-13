import * as S from 'effect/Schema'

export const NodeResolution = S.Struct({ esm: S.NullOr(S.String), cjs: S.NullOr(S.String) })
export type NodeResolution = typeof NodeResolution.Type

export const NodeResolutions = S.Struct({ imports: NodeResolution, exports: NodeResolution })
export type NodeResolutions = typeof NodeResolutions.Type
