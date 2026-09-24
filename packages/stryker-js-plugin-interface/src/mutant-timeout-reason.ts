import * as S from 'effect/Schema'
import { SchemaGetter, SchemaTransformation } from 'effect'

export const HitLimitReasonPrefix = S.Literal('Hit limit reached')

export const WallClockTimeoutReason = S.Literal('wall-clock-timeout')

export const HitLimitReasonText = S.String.check(S.isStartsWith(HitLimitReasonPrefix.literal))

const tailOf = (text: string) => text.slice(HitLimitReasonPrefix.literal.length).trim()

const limitsOf = SchemaGetter.transformEffect((text: HitLimitReasonText) =>
  MatchTail.value(tailOf(text)).pipe(
    MatchTail.when(/^\(\d+\/\d+\)$/, (matched) => {
      const [count = '', limit = ''] = matched.slice(1, -1).split('/')
      return Effect.succeed({ count: Number.parseInt(count, 10), limit: Number.parseInt(limit, 10) })
    }),
    MatchTail.orElse(() => Effect.fail(malformedHitLimit)),
  )
)
