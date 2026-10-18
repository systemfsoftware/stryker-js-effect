import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as S from 'effect/Schema'
import * as SchemaAST from 'effect/SchemaAST'

export const StreamFileFirstLine = S.Union([
  RunEvent.RunEventWireLine,
  S.fromJsonString(S.TaggedStruct('stream', { schemaVersion: S.String, runId: S.String })),
])

const objectsOf = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.Objects> => [
  ...Arr.filter([ast], SchemaAST.isObjects),
  ...Arr.filter([ast], SchemaAST.isUnion).flatMap((union) => union.types.flatMap(objectsOf)),
]

const wireTags = Arr.dedupe(
  objectsOf(SchemaAST.toEncoded(RunEvent.RunEvent.ast))
    .flatMap((objects) => objects.propertySignatures)
    .filter((signature) => signature.name === '_tag')
    .map((signature) => signature.type)
    .filter(SchemaAST.isLiteral)
    .map((literal) => `{"_tag":"${String(literal.literal)}"`),
)

export const RunEventRecordOpening = S.Literals(wireTags)
