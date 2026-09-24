import type { Location, Position } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

const MutantLocationSchema = S.Struct({
  start: S.Struct({ line: S.Finite, column: S.Finite }),
  end: S.Struct({ line: S.Finite, column: S.Finite }),
})

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

export const ReportLocationFromMutant = MutantLocationSchema.pipe(
  S.decodeTo(ReportLocationSchema, {
    decode: SGetter.transform(reportLocationOf),
    encode: SGetter.forbiddenEncoding,
  }),
)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const Result = await import('effect/Result')

  const SourceCoordinate = S.Int.pipe(S.check(S.isBetween({ minimum: 0, maximum: 1_000_000 })))

  const ShiftableLocation = S.Struct({
    start: S.Struct({ line: SourceCoordinate, column: SourceCoordinate }),
    end: S.Struct({ line: SourceCoordinate, column: SourceCoordinate }),
  })

  const shiftsByOne = (before: Position, after: Position) =>
    after.line - before.line === 1 && after.column - before.column === 1

  const shiftsLocationByOne = (location: Location, report: Location) =>
    shiftsByOne(location.start, report.start) && shiftsByOne(location.end, report.end)

  const keyOrderOf = (value: object) => Object.keys(value).join()

  const positionsColumnFirst = (report: Location) =>
    keyOrderOf(report.start) === 'column,line' && keyOrderOf(report.end) === 'column,line'

  it.prop('∀location_ReportLocationFromMutant_ShiftsEveryPositionByOne', [ShiftableLocation], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)(location), {
      onFailure: () => false,
      onSuccess: (report) => shiftsLocationByOne(location, report),
    }))

  it.prop('∀location_ReportLocationFromMutant_OrdersReportKeysColumnFirst', [ShiftableLocation], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)(location), {
      onFailure: () => false,
      onSuccess: (report) => keyOrderOf(report) === 'start,end' && positionsColumnFirst(report),
    }))

  it.prop('∀location_ReportLocationFromMutant_ForbidsEncoding', [ShiftableLocation], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)(location), {
      onFailure: () => false,
      onSuccess: (report) => Result.isFailure(S.encodeResult(ReportLocationFromMutant)(report)),
    }))
}
