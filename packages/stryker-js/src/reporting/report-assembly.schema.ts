import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

export const CanonicalReportFileName = S.String.pipe(
  S.check(S.isPattern(/^[^\\]*$/)),
  S.brand('CanonicalReportFileName'),
)
export type CanonicalReportFileName = typeof CanonicalReportFileName.Type

const normalizeSeparators = (relativePath: string) => relativePath.replaceAll('\\', '/')

export const ReportFileName = S.String.pipe(
  S.decodeTo(CanonicalReportFileName, {
    decode: SGetter.transform(normalizeSeparators),
    encode: SGetter.transform((canonical) => canonical),
  }),
)
export type ReportFileName = typeof ReportFileName.Type

const ReportName = S.Record(S.String, S.String)

export const ReportFileNames = ReportName.pipe(
  S.decodeTo(S.Record(S.String, CanonicalReportFileName), {
    decode: SGetter.transform((relativeNames) =>
      Object.fromEntries(
        Object.entries(relativeNames).map(([fileName, relativePath]) => [fileName, normalizeSeparators(relativePath)]),
      )
    ),
    encode: SGetter.transform((canonical) => canonical),
  }),
)
export type ReportFileNames = typeof ReportFileNames.Type
