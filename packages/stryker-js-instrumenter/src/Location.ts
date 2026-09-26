import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import type { LineStarts, Location, Offset, Position, ScriptOrigin, Span } from './Location.schema.js'
import { Location as LocationSchema, ScriptOrigin as ScriptOriginSchema } from './Location.schema.js'

const LINE_TERMINATOR = /\r\n|[\n\r\u2028\u2029]/g

export const lineStartsOf = (text: string): LineStarts => [
  0,
  ...[...text.matchAll(LINE_TERMINATOR)].map((match) => match.index + match[0].length),
]

const middleIndex = (low: number, high: number): number => low + ((high - low) >> 1)

const positionAtOffset = (
  lineStarts: LineStarts,
  offset: Offset,
  low: number,
  high: number,
  start: number,
): Position =>
  Boolean.match(low > high, {
    onTrue: () => ({ line: low, column: offset - start + 1 }),
    onFalse: () =>
      Option.match(Arr.get(lineStarts, middleIndex(low, high)), {
        onNone: () => ({ line: low, column: offset - start + 1 }),
        onSome: (found) =>
          Boolean.match(found === offset, {
            onTrue: () => ({ line: middleIndex(low, high) + 1, column: 1 }),
            onFalse: () =>
              Boolean.match(found < offset, {
                onTrue: () => positionAtOffset(lineStarts, offset, middleIndex(low, high) + 1, high, found),
                onFalse: () => positionAtOffset(lineStarts, offset, low, middleIndex(low, high) - 1, start),
              }),
          }),
      }),
  })

export const positionAt: {
  (lineStarts: LineStarts, offset: Offset): Position
  (offset: Offset): (lineStarts: LineStarts) => Position
} = dual(
  2,
  (lineStarts: LineStarts, offset: Offset): Position =>
    positionAtOffset(lineStarts, offset, 0, lineStarts.length - 1, 0),
)

export const locationOf: {
  (lineStarts: LineStarts, span: Span): Location
  (span: Span): (lineStarts: LineStarts) => Location
} = dual(
  2,
  (lineStarts: LineStarts, span: Span): Location =>
    LocationSchema.make({ start: positionAt(lineStarts, span.start), end: positionAt(lineStarts, span.end) }),
)

export const originAt: {
  (lineStarts: LineStarts, offset: Offset): ScriptOrigin
  (offset: Offset): (lineStarts: LineStarts) => ScriptOrigin
} = dual(2, (lineStarts: LineStarts, offset: Offset): ScriptOrigin => {
  const position = positionAt(lineStarts, offset)
  return ScriptOriginSchema.make({ line: position.line, columnShift: position.column - 1 })
})

export const offsetAt: {
  (lineStarts: LineStarts, position: Position): Option.Option<Offset>
  (position: Position): (lineStarts: LineStarts) => Option.Option<Offset>
} = dual(
  2,
  (lineStarts: LineStarts, position: Position): Option.Option<Offset> =>
    Option.flatMap(Arr.get(lineStarts, position.line - 1), (start) => {
      const offset = start + position.column - 1
      return Option.match(Arr.get(lineStarts, position.line), {
        onNone: () => Option.some(offset),
        onSome: (next) => Option.liftPredicate(offset, (candidate) => candidate < next),
      })
    }),
)
