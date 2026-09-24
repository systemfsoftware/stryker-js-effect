import { SchemaGetter, SchemaIssue, SchemaTransformation } from 'effect'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const HitLimitReasonPrefix = S.Literal('Hit limit reached')

export const WallClockTimeoutReason = S.Literal('wall-clock-timeout')

export const HitLimitReasonText = S.String.check(S.isStartsWith(HitLimitReasonPrefix.literal))

const HIT_LIMIT_REASON_SHAPE = /^Hit limit reached \((\d+)\/(\d+)\)$/

const limitsOf = SchemaGetter.transformEffect((text: string) =>
  Option.match(Option.fromNullishOr(HIT_LIMIT_REASON_SHAPE.exec(text)), {
    onNone: () => Effect.fail(malformedHitLimit(text)),
    onSome: (matched) =>
      Effect.succeed({
        count: Number.parseInt(String(matched[1]), 10),
        limit: Number.parseInt(String(matched[2]), 10),
      }),
  })
)

const textOf = SchemaGetter.transform((limits: { readonly count: number; readonly limit: number }): string =>
  `${HitLimitReasonPrefix.literal} (${limits.count}/${limits.limit})`
)

const malformedHitLimit = (text: string) =>
  new SchemaIssue.InvalidValue({ message: 'expected "Hit limit reached (count/limit)"' }, text)

export const HitLimitReason = HitLimitReasonText.pipe(
  S.decodeTo(
    S.Struct({ count: S.Natural, limit: S.Natural }),
    SchemaTransformation.makeTransformation({ decode: limitsOf, encode: textOf }),
  ),
)
