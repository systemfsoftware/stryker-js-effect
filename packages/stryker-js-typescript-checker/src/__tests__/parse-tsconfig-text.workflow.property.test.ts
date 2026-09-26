import { describe } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ParseTsconfigTextCommand } from '../CheckerCommands.schema.js'
import { parseTsconfigText, TsconfigParsed } from '../parse-tsconfig-text.workflow.js'
import { type TsConfigDocument, TsConfigDocumentSchema } from '../Tsconfig.schema.js'

type JsonValue = S.Schema.Type<typeof S.Json>

const decodedFor = (jsonText: string): Result.Result<TsConfigDocument, string> => {
  const decision = Result.match(parseTsconfigText(ParseTsconfigTextCommand.make({ text: jsonText })), {
    onFailure: (refused) => refused,
    onSuccess: (value) => value,
  })
  return S.is(TsconfigParsed)(decision) ? Result.succeed(decision.document) : Result.fail(decision.reason)
}

const decodedMatches = (document: TsConfigDocument, result: Result.Result<TsConfigDocument, string>): boolean =>
  Result.match(result, { onFailure: () => false, onSuccess: (decoded) => Equal.equals(decoded, document) })

describe('parseTsconfigText', (it) => {
  it.prop(
    '∀document_ParseSerialise_≡Identity',
    { of: [TsConfigDocumentSchema], subject: (document: TsConfigDocument) => decodedFor(JSON.stringify(document)) },
    (subject, [document]) => decodedMatches(document, subject(document)),
  )

  it.prop(
    '∀document_ByteOrderMark_≡Identity',
    {
      of: [TsConfigDocumentSchema],
      subject: (document: TsConfigDocument) => decodedFor(`\uFEFF${JSON.stringify(document)}`),
    },
    (subject, [document]) => decodedMatches(document, subject(document)),
  )

  it.prop(
    '∀json_Parse_≡DocumentSchemaAcceptance',
    { of: [S.Json], subject: (value: JsonValue) => decodedFor(JSON.stringify(value)) },
    (subject, [value]) => Result.isSuccess(subject(value)) === S.is(TsConfigDocumentSchema)(value),
  )
})
