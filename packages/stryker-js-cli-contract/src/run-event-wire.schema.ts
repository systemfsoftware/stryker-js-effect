import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as SchemaTransformation from 'effect/SchemaTransformation'

import { RunEvent } from './run-event.schema.js'

export const RunEventWireLine = S.String.pipe(
  S.decodeTo(S.fromJsonString(RunEvent), {
    decode: SchemaGetter.transform((line: string): string => line.replace(/\n$/, '')),
    encode: SchemaGetter.transform((json: string): string => `${json}\n`),
  }),
)

export type RunEventWireLine = typeof RunEventWireLine.Type

const BlankLine = S.String.check(S.isPattern(/^\s*$/)).pipe(
  S.decodeTo(S.Null, SchemaTransformation.transform({ decode: () => null, encode: () => '' })),
)

const linesOf = (text: string): ReadonlyArray<string> => text.split(/(?<=\n)/)

export const RunEventWireText = S.String.pipe(
  S.decodeTo(
    S.Array(S.Union([BlankLine, RunEventWireLine])),
    SchemaTransformation.transform({ decode: linesOf, encode: (lines) => lines.join('') }),
  ),
  S.decodeTo(
    RunEvent.pipe(S.toType, S.Array),
    SchemaTransformation.transform({
      decode: (lines): ReadonlyArray<RunEvent> => lines.filter((line): line is RunEvent => line !== null),
      encode: (events): ReadonlyArray<RunEvent | null> => events,
    }),
  ),
)

export type RunEventWireText = typeof RunEventWireText.Type

if (import.meta.vitest !== void 0) {
  // Dynamic: the test runner and its helpers must not become static imports of a shipped module.
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Option = await import('effect/Option')
  const Result = await import('effect/Result')

  const BlankLineAt = S.Tuple([S.Int, S.Array(S.Literals([' ', '\t', '\r']))])

  const CandidateLine = S.Union([
    S.Literals(['', ' ', '\t\r', '\u00a0', 'x', '{}', 'null', '[]', '"verdict"']),
    S.String,
  ])

  const decodeText = S.decodeResult(RunEventWireText)

  type Decode = typeof decodeText

  const textOf = (events: ReadonlyArray<RunEvent>): string =>
    Result.match(S.encodeResult(RunEventWireText)(events), {
      onFailure: (error) => `unencodable: ${error.message}`,
      onSuccess: (text) => text,
    })

  const positionOf = (message: string): string =>
    Option.getOrElse(Option.fromNullishOr(/at \[(\d+)\]/.exec(message)?.[1]), () => 'no position')

  const readsAs = (decode: Decode, text: string): string =>
    Result.match(decode(text), {
      onFailure: (error) => `refused at ${positionOf(error.message)}`,
      onSuccess: (events) => `events: ${textOf(events)}`,
    })

  const positionIn = (drawn: number, length: number): number => Math.abs(drawn) % (length + 1)

  const insertedAt = (lines: ReadonlyArray<string>, drawn: number, line: string): ReadonlyArray<string> => {
    const at = positionIn(drawn, lines.length)
    return [...lines.slice(0, at), line, ...lines.slice(at)]
  }

  const expectedFor = (line: string, canonical: string, at: number): string =>
    line.trim() === '' ? `events: ${canonical}` : `refused at ${at}`

  const readsTheSameWithOrWithoutTheLastNewline = (decode: Decode, text: string, expected: string): boolean =>
    readsAs(decode, text) === expected && readsAs(decode, text.replace(/\n$/, '')) === expected

  it.prop(
    '∀l_RunEventWireTextRefusal_≡OnlyBlankLinesAreSkippedAndAnyOtherIsRefusedAtItsPosition',
    { of: [S.Array(RunEvent), BlankLineAt, S.Int, CandidateLine], subject: decodeText },
    (subject, [events, [blankAt, blank], drawn, candidate]) => {
      const canonical = textOf(events)
      const eventLines = Arr.filter(linesOf(canonical), (line) => line !== '')
      const lines = insertedAt(eventLines, blankAt, `${blank.join('')}\n`)
      const line = candidate.replaceAll('\n', '')
      return readsTheSameWithOrWithoutTheLastNewline(
        subject,
        insertedAt(lines, drawn, `${line}\n`).join(''),
        expectedFor(line, canonical, positionIn(drawn, lines.length)),
      )
    },
  )
}
