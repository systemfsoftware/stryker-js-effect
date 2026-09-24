// Throwaway old-vs-new evidence vs the 432b15ac3 baseline (oracles quoted from its dist); run, report, delete.
import { it } from '@effect/vitest'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { HitLimitReason } from './mutant-timeout-reason.schema.js'
import { isCustomTestRunner, TestRunnerCustomConfigSchema } from './stryker-options.schema.js'
import { Traceparent } from './TraceContext.schema.js'

const parseTraceparentBaseline = (value: string) => {
  const parts = value.split('-')
  const fields = {
    version: parts[0] ?? '',
    traceId: parts[1] ?? '',
    spanId: parts[2] ?? '',
    flags: parts[3] ?? '',
  }
  const acceptsFieldCount = (version: string, count: number) => version !== '00' || count === 4
  const isKnownVersion = (version: string) => /^[0-9a-f]{2}$/.test(version) && version !== 'ff'
  const isNonZeroHex = (pattern: RegExp, id: string) => pattern.test(id) && !/^0+$/.test(id)
  const wellFormed = [
    acceptsFieldCount(fields.version, parts.length),
    isKnownVersion(fields.version),
    isNonZeroHex(/^[0-9a-f]{32}$/, fields.traceId),
    isNonZeroHex(/^[0-9a-f]{16}$/, fields.spanId),
    /^[0-9a-f]{2}$/.test(fields.flags),
  ].every((check) => check)
  return Option.map(Option.liftPredicate(fields, () => wellFormed), (candidate) => ({
    version: candidate.version,
    traceId: candidate.traceId,
    spanId: candidate.spanId,
    traceFlags: Number.parseInt(candidate.flags, 16),
  }))
}

const formatTraceparentBaseline = (parts: {
  readonly version: string
  readonly traceId: string
  readonly spanId: string
  readonly traceFlags: number
}) => `${parts.version}-${parts.traceId}-${parts.spanId}-${(parts.traceFlags & 255).toString(16).padStart(2, '0')}`

const isCustomTestRunnerBaseline = (value: unknown) => typeof value !== 'string'

it.prop('∀text_TraceparentDec_=parseTraceparentBaseline', [S.String], ([text]) =>
  Option.match(S.decodeUnknownOption(Traceparent)(text), {
    onNone: () => Option.isNone(parseTraceparentBaseline(text)),
    onSome: (parts) =>
      Option.match(parseTraceparentBaseline(text), {
        onNone: () => false,
        onSome: (expected) =>
          parts.version === expected.version && parts.traceId === expected.traceId &&
          parts.spanId === expected.spanId && parts.traceFlags === expected.traceFlags,
      }),
  }))

it.prop('∀parts_TraceparentEnc_=formatTraceparentBaseline', [Traceparent], ([parts]) =>
  Result.match(S.encodeResult(Traceparent)(parts), {
    onFailure: () => false,
    onSuccess: (header) => header === formatTraceparentBaseline(parts),
  }))

it.prop('∀value_isCustomTestRunner_=baselineTypeofTest', [S.Unknown], ([value]) =>
  isCustomTestRunner(value) === isCustomTestRunnerBaseline(value))

it.prop(
  '∀limits_HitLimitReasonEnc_=hitLimitReachedReasonBaseline',
  [S.Struct({ count: S.Int.check(S.isBetween({ minimum: 0, maximum: 10000 })), limit: S.Int.check(S.isBetween({ minimum: 0, maximum: 10000 })) })],
  ([limits]) =>
    Result.match(S.encodeResult(HitLimitReason)(limits), {
      onFailure: () => false,
      onSuccess: (text) => text === `Hit limit reached (${limits.count}/${limits.limit})`,
    }),
)
