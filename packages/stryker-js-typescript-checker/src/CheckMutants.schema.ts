import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

/** A file name the node map can be keyed by: non-empty, and naming an extension. */
export const SourceFileSchema = S.NonEmptyString.pipe(S.check(S.isPattern(/\.[^./\\]+$/)))

const DiagnosticSchema = S.Struct({
  fileName: S.optional(SourceFileSchema),
  text: S.String,
})

export interface NodeDecodedShape {
  readonly fileName: string
  readonly parents: readonly NodeDecodedShape[]
  readonly children: readonly NodeDecodedShape[]
}

export const TSFileNodeSchema: S.Codec<NodeDecodedShape, NodeDecodedShape> = S.suspend(() =>
  S.Struct({
    fileName: SourceFileSchema,
    parents: S.Array(TSFileNodeSchema),
    children: S.Array(TSFileNodeSchema),
  })
)

export class CheckMutantsInput extends S.TaggedClass<CheckMutantsInput>()(
  'CheckMutantsInput',
  {
    mutants: S.Array(Checker.CheckerMutantWire),
    diagnostics: S.Array(DiagnosticSchema),
    nodes: S.Record(SourceFileSchema, TSFileNodeSchema),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export type MutantDecoded = Checker.CheckerMutantWire
export type DiagnosticDecoded = S.Schema.Type<typeof DiagnosticSchema>
export type NodeDecoded = NodeDecodedShape
