import { parse } from '@std/jsonc'
import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as SchemaIssue from 'effect/SchemaIssue'
import * as SchemaTransformation from 'effect/SchemaTransformation'

import { ParseTsconfigTextCommand } from './CheckerCommands.schema.js'
import { type TsConfigDocument, TsConfigDocumentSchema } from './Tsconfig.schema.js'

const TsconfigTextTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-typescript-checker/TsconfigText',
)
type TsconfigTextTypeId = typeof TsconfigTextTypeId

export class TsconfigParsed extends S.TaggedClass<TsconfigParsed>()('TsconfigParsed', {
  document: TsConfigDocumentSchema,
}) {
  readonly [TsconfigTextTypeId] = TsconfigTextTypeId
}

export class TsconfigRefused extends S.TaggedClass<TsconfigRefused>()('TsconfigRefused', {
  reason: S.String,
}) {
  readonly [TsconfigTextTypeId] = TsconfigTextTypeId
}

export const TsconfigTextDecision = S.Union([TsconfigParsed, TsconfigRefused])
export type TsconfigTextDecision = typeof TsconfigTextDecision.Type

type JsonValue = S.Schema.Type<typeof S.Json>

const reasonOfThrown = <A = unknown>(cause: A): string =>
  Option.getOrElse(
    Option.map(
      Option.liftPredicate(cause, (error: A): error is A & Error => error instanceof Error),
      (error) => error.message,
    ),
    () => 'a non-Error value was thrown',
  )

const documentIssueOf = (value: JsonValue): SchemaIssue.Issue =>
  new SchemaIssue.InvalidValue({
    message: Result.match(S.decodeUnknownResult(TsConfigDocumentSchema)(value), {
      onFailure: (error) => error.message,
      onSuccess: () => 'expected a TypeScript configuration object',
    }),
  })

const parseJsonc = (jsonText: string): Result.Result<JsonValue, SchemaIssue.Issue> =>
  Result.match(
    Result.try({ try: () => parse(jsonText.replace(/^\uFEFF/, '')), catch: (cause) => cause }),
    {
      onFailure: (cause) => Result.fail(new SchemaIssue.InvalidValue({ message: reasonOfThrown(cause) })),
      onSuccess: (value) =>
        Result.mapError(
          S.decodeUnknownResult(S.Json)(value),
          (error) => new SchemaIssue.InvalidValue({ message: error.message }),
        ),
    },
  )

const documentOf = (value: JsonValue): Result.Result<TsConfigDocument, SchemaIssue.Issue> =>
  Option.match(Option.liftPredicate(value, S.is(TsConfigDocumentSchema)), {
    onNone: () => Result.fail(documentIssueOf(value)),
    onSome: () =>
      Result.mapError(
        S.decodeUnknownResult(TsConfigDocumentSchema)(value),
        (error) => new SchemaIssue.InvalidValue({ message: error.message }),
      ),
  })

const decodeText = (jsonText: string): Result.Result<TsConfigDocument, SchemaIssue.Issue> =>
  Result.flatMap(parseJsonc(jsonText), documentOf)

const TsConfigText = S.String.pipe(
  S.decodeTo(
    TsConfigDocumentSchema,
    SchemaTransformation.transformEffect({
      decode: (jsonText: string) =>
        Result.match(decodeText(jsonText), {
          onFailure: (issue) => Effect.fail(issue),
          onSuccess: (document) => Effect.succeed(document),
        }),
      encode: (document: TsConfigDocument) => Effect.succeed(JSON.stringify(document)),
    }),
  ),
)

const decide = (command: ParseTsconfigTextCommand): Result.Result<TsconfigTextDecision, never> =>
  Result.succeed(
    Result.match(S.decodeResult(TsConfigText)(command.text), {
      onFailure: (error) => TsconfigRefused.make({ reason: error.message }),
      onSuccess: (document) => TsconfigParsed.make({ document }),
    }),
  )

export const parseTsconfigText = Workflow.make({
  command: ParseTsconfigTextCommand,
  decision: TsconfigTextDecision,
  error: S.Never,
  decide,
})
