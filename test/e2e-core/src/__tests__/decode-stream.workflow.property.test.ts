import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { decodeStream, DecodeStreamCommand, StreamLineUndecodable } from '../decode-stream.workflow.js'

const NON_EVENT_LINES = ['not json', '{}', '[]', 'null', '42', '{"_tag":"nope"}', '{'] as const

const wireLineOf = (event: RunEvent.RunEvent): string =>
  Result.match(S.encodeResult(RunEvent.RunEventWireLine)(event), {
    onFailure: () => '',
    onSuccess: (line) => line,
  })

const undecodableOrdinalArb = Arbitrary.filter(
  Arbitrary.schema(S.Int),
  (ordinal) => ordinal >= 1 && ordinal <= 4,
)

const decodeOf = (lines: ReadonlyArray<string>) => DecodeStreamCommand.make({ lines: [...lines] })

describe('decodeStream', () => {
  it.prop(
    '∀e_TwoDistinctEventLines_≡DecodedInOrder',
    {
      of: [Arbitrary.schema(RunEvent.RunEvent), Arbitrary.schema(RunEvent.RunEvent)],
      subject: decodeStream,
    },
    (subject, [first, second]) => {
      const firstLine = wireLineOf(first)
      const secondLine = wireLineOf(second)
      if (firstLine === secondLine) {
        return true
      }
      return Result.match(subject(decodeOf([firstLine, secondLine])), {
        onFailure: () => false,
        onSuccess: (decoded) =>
          decoded.events.length === 2 &&
          wireLineOf(decoded.events[0]) === firstLine &&
          wireLineOf(decoded.events[1]) === secondLine,
      })
    },
  )

  it.prop(
    '∀e_BlankLinesAroundAnEvent_≡Ignored',
    { of: [Arbitrary.schema(RunEvent.RunEvent)], subject: decodeStream },
    (subject, [event]) => {
      const line = wireLineOf(event)
      return Result.match(subject(decodeOf(['', line, '   ', '\t'])), {
        onFailure: () => false,
        onSuccess: (decoded) => decoded.events.length === 1 && wireLineOf(decoded.events[0]) === line,
      })
    },
  )

  it.prop(
    '∀l_NonEventLine_≡RefusedNamingTheLine',
    { of: [S.Literals(NON_EVENT_LINES)], subject: decodeStream },
    (subject, [line]) => {
      return Result.match(subject(decodeOf([line])), {
        onFailure: (failure) =>
          S.is(StreamLineUndecodable)(failure) && failure.lineNumber === 1 && failure.line === line,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀n_UndecodableLineOrdinal_≡NamedByOneBasedLineNumber',
    { of: [undecodableOrdinalArb, Arbitrary.schema(RunEvent.RunEvent)], subject: decodeStream },
    (subject, [ordinal, event]) => {
      const preceding = Array.from({ length: ordinal - 1 }, () => wireLineOf(event))
      const bad = NON_EVENT_LINES[0]
      return Result.match(subject(decodeOf([...preceding, bad])), {
        onFailure: (failure) =>
          S.is(StreamLineUndecodable)(failure) && failure.lineNumber === ordinal && failure.line === bad,
        onSuccess: () => false,
      })
    },
  )
})
