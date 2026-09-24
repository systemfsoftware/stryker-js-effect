import { LocationSchema } from '@systemfsoftware/stryker-js-instrumenter'
import type { Location, Position } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

const ReportPositionSchema = S.Struct({
  column: S.Finite,
  line: S.Finite,
})

const ReportLocationSchema = S.Struct({
  start: ReportPositionSchema,
  end: ReportPositionSchema,
})

const reportPositionOf = (position: Position) => ({
  column: position.column + 1,
  line: position.line + 1,
})

const reportLocationOf = (location: Location) => ({
  start: reportPositionOf(location.start),
  end: reportPositionOf(location.end),
})

export const ReportLocationFromMutant = LocationSchema.pipe(
  S.decodeTo(ReportLocationSchema, {
    decode: SGetter.transform(reportLocationOf),
    encode: SGetter.forbiddenEncoding,
  }),
)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const Result = await import('effect/Result')

  const ShiftableLocation = S.Struct({
    start: S.Struct({ line: S.Int, column: S.Int }),
    end: S.Struct({ line: S.Int, column: S.Int }),
  })

  const shiftsByOne = (before: Position, after: Position) =>
    after.line - before.line === 1 && after.column - before.column === 1

  const keyOrderOf = (value: object) => Object.keys(value).join()

  it.prop('∀location_ReportLocationFromMutant_ShiftsEveryPositionByOne', [ShiftableLocation], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)(location), {
      onFailure: () => false,
      onSuccess: (report) => shiftsByOne(location.start, report.start) && shiftsByOne(location.end, report.end),
    }))

  it.prop('∀location_ReportLocationFromMutant_OrdersReportKeysColumnFirst', [ShiftableLocation], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)(location), {
      onFailure: () => false,
      onSuccess: (report) =>
        keyOrderOf(report) === 'start,end' && keyOrderOf(report.start) === 'column,line' &&
        keyOrderOf(report.end) === 'column,line',
    }))

  it.prop('∀location_ReportLocationFromMutant_ForbidsEncoding', [ShiftableLocation], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)(location), {
      onFailure: () => false,
      onSuccess: (report) => Result.isFailure(S.encodeResult(ReportLocationFromMutant)(report)),
    }))
}
