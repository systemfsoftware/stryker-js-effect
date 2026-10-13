import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as S from 'effect/Schema'
import * as SchemaAST from 'effect/SchemaAST'

export const StreamFileFirstLine = S.Union([
  RunEvent.RunEventWireLine,
  S.fromJsonString(S.TaggedStruct('stream', { schemaVersion: S.String, runId: S.String })),
])

export const JsonLine = S.fromJsonString(S.Unknown)

const wireTags = Arr.filter([SchemaAST.toEncoded(RunEvent.RunEvent.ast)], SchemaAST.isUnion)
  .flatMap((union) => union.types)
  .filter(SchemaAST.isObjects)
  .flatMap((objects) => objects.propertySignatures)
  .filter((signature) => signature.name === '_tag')
  .map((signature) => signature.type)
  .filter(SchemaAST.isLiteral)
  .map((literal) => `{"_tag":"${String(literal.literal)}"`)

export const RunEventRecordOpening = S.Literals(wireTags)
