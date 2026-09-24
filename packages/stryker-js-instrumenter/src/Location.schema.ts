import * as S from 'effect/Schema'

/**
 * File coordinates in the mutation-testing-report-schema contract: both line
 * and column are 1-based. The first line of a file is line 1, and the first
 * character of a line is column 1. Slicing a source line by one of these
 * positions uses `line - 1` for the line index and `column - 1` for the
 * character offset.
 */
export const PositionSchema = S.Struct({
  line: S.Finite,
  column: S.Finite,
})
export type Position = typeof PositionSchema.Type

export const LocationSchema = S.Struct({
  start: PositionSchema,
  end: PositionSchema,
})
export type Location = typeof LocationSchema.Type

export const OpenEndLocationSchema = S.Struct({
  start: PositionSchema,
  end: S.optional(PositionSchema),
})
export type OpenEndLocation = typeof OpenEndLocationSchema.Type
