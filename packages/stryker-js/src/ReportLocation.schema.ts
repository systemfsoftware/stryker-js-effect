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

const mutantPositionOf = (position: Position) => ({
  column: position.column - 1,
  line: position.line - 1,
})

const mutantLocationOf = (location: Location) => ({
  start: mutantPositionOf(location.start),
  end: mutantPositionOf(location.end),
})

export const ReportLocationFromMutant = MutantLocationSchema.pipe(
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

  const shiftsBy = (offset: number) => (before: Position, after: Position) =>
    after.line - before.line === offset && after.column - before.column === offset

  const shiftsLocationBy = (offset: number) => (location: Location, shifted: Location) =>
    shiftsBy(offset)(location.start, shifted.start) && shiftsBy(offset)(location.end, shifted.end)

  const keyOrderOf = (value: object) => Object.keys(value).join()

  const positionsColumnFirst = (report: Location) =>
    keyOrderOf(report.start) === 'column,line' && keyOrderOf(report.end) === 'column,line'

  it.prop('∀location_ReportLocationFromMutant_ShiftsEveryPositionByOne', [ShiftableLocation], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)(location), {
      onFailure: () => false,
      onSuccess: (report) => shiftsLocationBy(1)(location, report),
    }))

  it.prop('∀location_ReportLocationFromMutant_EncodesMutantCoordinatesByMinusOne', [ShiftableLocation], ([location]) =>
    Result.match(S.decodeResult(ReportLocationFromMutant)(location), {
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
