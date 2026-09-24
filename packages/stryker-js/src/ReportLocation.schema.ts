import { LocationSchema } from '@systemfsoftware/stryker-js-instrumenter'
import type { Location, Position } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

const reportPositionOf = (position: Position): Position => ({
  column: position.column + 1,
  line: position.line + 1,
})

const reportLocationOf = (location: Location): Location => ({
  start: reportPositionOf(location.start),
  end: reportPositionOf(location.end),
})

export const ReportLocationFromMutant = LocationSchema.pipe(
  S.decodeTo(LocationSchema, {
    decode: SGetter.transform(reportLocationOf),
    encode: SGetter.forbiddenEncoding,
  }),
)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')
  const Result = await import('effect/Result')

  const ShiftableLocation = S.Struct({
    start: S.Struct({ line: S.Int, column: S.Int }),
    end: S.Struct({ line: S.Int, column: S.Int }),
  })
  const nonNegativePositionOf = (position: { readonly line: number; readonly column: number }) => ({
    column: Math.abs(position.column),
    line: Math.abs(position.line),
  })
  const locationArbitrary = Arbitrary.map(Arbitrary.schema(ShiftableLocation), (location) => ({
    start: nonNegativePositionOf(location.start),
    end: nonNegativePositionOf(location.end),
  }))

  it.prop('∀location_ReportLocationFromMutant_ShiftsEveryPositionByOne', [locationArbitrary], ([location]) => {
    const report = S.decodeSync(ReportLocationFromMutant)(location)
    const shiftsByOne = (before: Position, after: Position) =>
      after.line - before.line === 1 && after.column - before.column === 1
    return shiftsByOne(location.start, report.start) && shiftsByOne(location.end, report.end)
  })

  it.prop('∀location_ReportLocationFromMutant_ForbidsEncoding', [locationArbitrary], ([location]) =>
    Result.isFailure(
      S.encodeResult(ReportLocationFromMutant)(S.decodeSync(ReportLocationFromMutant)(location)),
    ))
}
