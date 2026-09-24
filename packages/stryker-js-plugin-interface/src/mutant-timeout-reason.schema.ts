import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import { SchemaGetter, SchemaIssue, SchemaTransformation } from 'effect'

export const HitLimitReasonPrefix = S.Literal('Hit limit reached')

export const WallClockTimeoutReason = S.Literal('wall-clock-timeout')

export const HitLimitReasonText = S.String.check(S.isStartsWith(HitLimitReasonPrefix.literal))

const limitsOf = SchemaGetter.transformEffect((text: HitLimitReasonText) =>
  Option.match(
    Option.flatMap(
      Option.fromNullable(/^Hit limit reached \((\d+)\/(\d+)\)$/.exec(text)),
      (matched) => Option.all([Option.fromNullable(matched[1]), Option.fromNullable(matched[2])]),
    ),
    {
      onNone: () => Effect.fail(malformedHitLimit(text)),
      onSome: ([count, limit]) =>
        Effect.succeed({ count: Number.parseInt(count, 10), limit: Number.parseInt(limit, 10) }),
    },
  )
)

const textOf = SchemaGetter.transform(
  (limits: { readonly count: number; readonly limit: number }): string =>
    `${HitLimitReasonPrefix.literal} (${limits.count}/${limits.limit})`,
)

const malformedHitLimit = (text: string) =>
  new SchemaIssue.InvalidValue({ message: `expected "Hit limit reached (count/limit)", got ${text}` }, text)

export const HitLimitReason = S.Struct({ count: S.Finite, limit: S.Finite }).pipe(
  S.decodeTo(HitLimitReasonText, SchemaTransformation.makeTransformation({ decode: limitsOf, encode: textOf })),
)
