/// <reference types="vitest/importMeta" />
import type * as Arr from 'effect/Array'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'

export const Offset = S.Int.check(S.isGreaterThanOrEqualTo(0))
export type Offset = typeof Offset.Type

const OffsetEnds = S.Struct({ start: Offset, end: Offset })
type OffsetEnds = typeof OffsetEnds.Type

export const Span = S.declare(
  (value: unknown): value is OffsetEnds => S.is(OffsetEnds)(value) && Mutant.notReversed(Order.Number)(value),
  {
    expected: 'a span whose end is not before its start',
    toCodecArbitrary: () =>
      S.link<OffsetEnds>()(OffsetEnds, {
        decode: SchemaGetter.transform(Mutant.inOrder(Order.Number)),
        encode: SchemaGetter.transform((ends: OffsetEnds) => ends),
      }),
  },
)
export type Span = typeof Span.Type

export const ScriptOrigin = S.Struct({ line: Mutant.Line, columnShift: Offset })
export type ScriptOrigin = typeof ScriptOrigin.Type

/**
 * The node span (`source`) is a 1-based position inside the embedded script;
 * the region origin (`offset`) is where that script begins in its host file.
 * The region's first line carries its column shift, later lines start at
 * column 1, so the shift adds `offset.line - 1` lines and — only when the node
 * sits on the region's first line — `offset.columnShift`.
 */
const columnOffsetOf = (source: Mutant.Position, offset: ScriptOrigin): number =>
  Match.value(source.line === 1).pipe(
    Match.when(true, () => offset.columnShift),
    Match.when(false, () => 0),
    Match.exhaustive,
  )

const shiftedPosition = (source: Mutant.Position, offset: ScriptOrigin): Mutant.Position => ({
  column: source.column + columnOffsetOf(source, offset),
  line: source.line + offset.line - 1,
})

export const shiftedLocation: {
  (location: Mutant.Location, offset: ScriptOrigin): Mutant.Location
  (offset: ScriptOrigin): (location: Mutant.Location) => Mutant.Location
} = dual(
  2,
  (location: Mutant.Location, offset: ScriptOrigin): Mutant.Location => ({
    start: shiftedPosition(location.start, offset),
    end: shiftedPosition(location.end, offset),
  }),
)

export type LineStarts = Arr.NonEmptyReadonlyArray<Offset>

const accepts = {
  offset: S.is(Offset),
  span: S.is(Span),
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const seeds = [-1, 0, 1, Number.MAX_SAFE_INTEGER]
  const withSeeds = (drawn: number): ReadonlyArray<number> => Arr.append(seeds, drawn)
  const atLeast = (minimum: number) => (n: number): boolean => Number.isSafeInteger(n) && n >= minimum

  it.prop(
    '∀n_OffsetRefusal_≡NonNegative',
    { of: [S.Int], subject: accepts },
    (subject, [drawn]) => Arr.every(withSeeds(drawn), (n) => subject.offset(n) === atLeast(0)(n)),
  )

  it.prop(
    '∀s_SpanRefusal_≡EndNotBeforeStart',
    { of: [S.Int, S.Int], subject: accepts },
    (subject, [start, drawnEnd]) =>
      Arr.every(
        withSeeds(drawnEnd),
        (end) => subject.span({ start, end }) === (Arr.every([start, end], atLeast(0)) && start <= end),
      ),
  )

  const SCRIPT_LINES: readonly [string, string, string] = ['ab', 'cdef', 'gh']
  const within = (n: number, size: number): number => ((n % size) + size) % size
  const hostOf = (before: number, indent: number): ReadonlyArray<string> => [
    ...Array.from({ length: before }, () => '--'),
    `${' '.repeat(indent)}${SCRIPT_LINES[0]}`,
    SCRIPT_LINES[1],
    SCRIPT_LINES[2],
  ]
  const originOf = (before: number, indent: number): ScriptOrigin => ({ line: before + 1, columnShift: indent })
  const scriptPosition = (line: number, column: number): Mutant.Position => ({
    line: 1 + within(line, SCRIPT_LINES.length),
    column: 1 + within(column, 2),
  })
  const charsBefore = (lines: ReadonlyArray<string>): number =>
    lines.reduce((count, lineText) => count + lineText.length + 1, 0)
  const countOf = (text: string, needle: string): number => text.split(needle).length - 1
  const hostPositionAt = (host: ReadonlyArray<string>, index: number): Mutant.Position => {
    const before = host.join('\n').slice(0, index)
    return { line: countOf(before, '\n') + 1, column: index - before.lastIndexOf('\n') }
  }
  const indexOfScriptPoint = (host: ReadonlyArray<string>, indent: number) => (point: Mutant.Position): number =>
    charsBefore(host.slice(0, host.length - SCRIPT_LINES.length + point.line - 1)) +
    indent * Number(point.line === 1) + point.column - 1
  const hostPositionOf =
    (host: ReadonlyArray<string>, indent: number): (point: Mutant.Position) => Mutant.Position => (point) =>
      hostPositionAt(host, indexOfScriptPoint(host, indent)(point))
  const samePosition = (left: Mutant.Position, right: Mutant.Position): boolean =>
    left.line === right.line && left.column === right.column

  it.prop(
    '∀o,p_ShiftedPosition_≡TheHostPositionOfTheSameCharacter',
    { of: [S.Int, S.Int, S.Int, S.Int], subject: shiftedPosition },
    (subject, [drawnBefore, drawnIndent, drawnLine, drawnColumn]) => {
      const before = within(drawnBefore, 4)
      const indent = within(drawnIndent, 5)
      const at = hostPositionOf(hostOf(before, indent), indent)
      const position = scriptPosition(drawnLine, drawnColumn)
      return samePosition(subject(position, originOf(before, indent)), at(position))
    },
  )

  it.prop(
    '∀o,l_ShiftedLocation_≡BothEndsAtTheirHostPositions',
    { of: [S.Int, S.Int, S.Int, S.Int, S.Int, S.Int], subject: shiftedLocation },
    (subject, [drawnBefore, drawnIndent, drawnStartLine, drawnStartColumn, drawnEndLine, drawnEndColumn]) => {
      const before = within(drawnBefore, 4)
      const indent = within(drawnIndent, 5)
      const at = hostPositionOf(hostOf(before, indent), indent)
      const start = scriptPosition(drawnStartLine, drawnStartColumn)
      const end = scriptPosition(drawnEndLine, drawnEndColumn)
      const shifted = subject({ start, end }, originOf(before, indent))
      return samePosition(at(start), shifted.start) && samePosition(at(end), shifted.end)
    },
  )
}
