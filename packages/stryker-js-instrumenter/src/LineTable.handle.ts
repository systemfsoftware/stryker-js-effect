import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'
import type { Pipeable } from 'effect/Pipeable'
import { Prototype } from 'effect/Pipeable'
import type { Range } from './Ast.schema.js'
import type { Location, Position } from './Location.schema.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js-instrumenter/LineTable')
export type TypeId = typeof TypeId

export interface LineTable extends Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly lineStarts: ReadonlyArray<number>
}

export const isLineTable = (value: unknown): value is LineTable => Predicate.hasProperty(value, TypeId)

export const of = (lineStarts: ReadonlyArray<number>): LineTable => ({ [TypeId]: TypeId, lineStarts, ...Prototype })

export const empty: LineTable = of([0])

const LINE_TERMINATOR = /\r\n|[\n\r\u2028\u2029]/g

const lineStartsOf = (text: string): ReadonlyArray<number> => [
  0,
  ...[...text.matchAll(LINE_TERMINATOR)].map((match) => match.index + match[0].length),
]

export const fromText = (text: string): LineTable => of(lineStartsOf(text))

const middleIndex = (low: number, high: number): number => low + ((high - low) >> 1)

const lastLineStartAt = (lineStarts: ReadonlyArray<number>, offset: number): number => {
  const search = (low: number, high: number): number =>
    Boolean.match(low > high, {
      onTrue: () => low - 1,
      onFalse: () => {
        const middle = middleIndex(low, high)
        return Match.value(lineStarts[middle]).pipe(
          Match.when(offset, () => middle),
          Match.when((mid) => mid < offset, () => search(middle + 1, high)),
          Match.orElse(() => search(low, middle - 1)),
        )
      },
    })
  return search(0, lineStarts.length - 1)
}

const positionOf = (lineStarts: ReadonlyArray<number>, offset: number): Position => {
  const zeroBasedLine = lastLineStartAt(lineStarts, offset)
  return { line: zeroBasedLine + 1, column: offset - (lineStarts[zeroBasedLine] ?? 0) + 1 }
}

export const positionAt: {
  (offset: number): (self: LineTable) => Position
  (self: LineTable, offset: number): Position
} = dual(
  2,
  (self: LineTable, offset: number): Position => positionOf(self.lineStarts, offset),
)

export const locationOf: {
  (range: Range): (self: LineTable) => Location
  (self: LineTable, range: Range): Location
} = dual(
  2,
  (self: LineTable, range: Range): Location => ({
    start: positionOf(self.lineStarts, range.start),
    end: positionOf(self.lineStarts, range.end),
  }),
)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Schema } = await import('effect')
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')

  const unitDraw = (draw: number): number => ((draw % 1) + 1) % 1

  it.prop(
    '∀to_Offset→Position→Offset≡Id',
    [Schema.String, Schema.Finite],
    ([text, draw]) => {
      const table = fromText(text)
      const offset = Math.floor(unitDraw(draw) * (text.length + 1))
      const position = positionAt(table, offset)
      const modelLine = table.lineStarts.filter((start, index) => index > 0 && start <= offset).length
      return table.lineStarts[position.line - 1] + position.column - 1 === offset && position.line - 1 === modelLine
    },
  )
}
