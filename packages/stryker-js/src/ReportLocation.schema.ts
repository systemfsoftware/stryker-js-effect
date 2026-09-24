import { LocationSchema } from '@systemfsoftware/stryker-js-instrumenter'
import type { Location, Position } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

const ReportCoordinate = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(1)))

const ReportPositionSchema = S.Struct({
  column: ReportCoordinate,
  line: ReportCoordinate,
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

const mutantPositionOf = (position: Position) => ({
  column: position.column - 1,
  line: position.line - 1,
})

const mutantLocationOf = (location: Location) => ({
  start: mutantPositionOf(location.start),
  end: mutantPositionOf(location.end),
})

export const ReportLocationFromMutant = LocationSchema.pipe(
  S.decodeTo(ReportLocationSchema, {
    decode: SGetter.transform(reportLocationOf),
    encode: SGetter.transform(mutantLocationOf),
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

  type ReportSide = typeof ReportLocationSchema.Type

  const shiftsBy = (offset: number) => (before: ReportSide['start'], after: ReportSide['start']) =>
    after.line - before.line === offset && after.column - before.column === offset

  const shiftsLocationBy = (offset: number) => (side: ReportSide, shifted: ReportSide) =>
    shiftsBy(offset)(side.start, shifted.start) && shiftsBy(offset)(side.end, shifted.end)

  const keyOrderOf = (value: object) => Object.keys(value).join()

  const positionsColumnFirst = (report: ReportSide) =>
    keyOrderOf(report.start) === 'column,line' && keyOrderOf(report.end) === 'column,line'

  it.prop('∀location_ReportLocationFromMutant_ShiftsEveryPositionByOne', [ReportLocationSchema], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)({ start: location.start, end: location.end }), {
      onFailure: () => false,
      onSuccess: (report) => shiftsLocationBy(1)(location, report),
    }))

  it.prop('∀location_ReportLocationFromMutant_EncodesMutantCoordinatesByMinusOne', [ShiftableLocation], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)({ start: location.start, end: location.end }), {
      onFailure: () => false,
      onSuccess: (report) =>
        Result.match(S.encodeResult(ReportLocationFromMutant)(report), {
          onFailure: () => false,
          onSuccess: (mutant) => shiftsLocationBy(-1)(report, mutant),
        }),
    }))

  it.prop('∀location_ReportLocationFromMutant_OrdersReportKeysColumnFirst', [ShiftableLocation], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)(location), {
      onFailure: () => false,
      onSuccess: (report) => keyOrderOf(report) === 'start,end' && positionsColumnFirst(report),
    }))
}
