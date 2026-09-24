import { it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import { SchemaGetter } from 'effect'

import {
  DryRunResultSchema,
  type DryRunResult,
  type MutantRunResult,
  MutantRunResultSchema,
} from '../TestRunner.schema.js'

const hex = (length: number) => S.String.pipe(S.pattern(new RegExp(`^[0-9a-f]{${length}}$`)))

const wellFormedParts = S.Struct({
  version: S.String.pipe(S.pattern(/^[0-9a-f]{2}$/)),
  traceId: hex(32),
  spanId: hex(16),
  traceFlags: S.Finite,
  traceState: S.optional(S.String),
})

it.prop('∀trace_Traceparent_roundTrip', [wellFormedParts], ([parts]) => {
  const text = S.encodeSync(Traceparent)(parts)
  const parsed = S.decodeUnknownOption(Traceparent)(text)
  return Option.match(parsed, {
    onNone: () => false,
    onSome: (roundTripped) =>
      roundTripped.version === parts.version
      && roundTripped.traceId === parts.traceId
      && roundTripped.spanId === parts.spanId
      && (roundTripped.traceFlags & 0xff) === (parts.traceFlags & 0xff),
  })
})

it.prop('∀header_Traceparent_refusesMalformed', [S.String], ([value]) => {
  const parsed = S.decodeUnknownOption(Traceparent)(value)
  const parsedByBaseline = parseTraceparentBaseline(value)
  return Option.isSome(parsed) === parsedByBaseline
})
