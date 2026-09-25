import * as Result from 'effect/Result'
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

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const PathPieces = S.Array(S.Tuple([S.Literals(['src', 'sub', 'x.ts', '']), S.Literals(['/', '\\'])]))

  const joinPath = (pieces: ReadonlyArray<readonly [string, string]>) =>
    pieces.map(([segment, separator]) => `${segment}${separator}`).join('')

  it.prop(
    '∀p_ReportFileName_≡CanonicalFixpoint',
    { of: [PathPieces], subject: normalizeSeparators },
    (subject, [pieces]) => {
      const relativePath = joinPath(pieces)
      return Result.match(S.decodeResult(ReportFileName)(relativePath), {
        onFailure: () => false,
        onSuccess: (canonical) =>
          [
            canonical === subject(relativePath),
            Result.isSuccess(S.decodeResult(CanonicalReportFileName)(canonical)),
            Result.match(S.encodeResult(ReportFileName)(canonical), {
              onFailure: () => false,
              onSuccess: (encoded) => encoded === canonical,
            }),
          ].every(Boolean),
      })
    },
  )

  it.prop(
    '∀names_ReportFileNames_≡CanonicalizedKeys',
    { of: [S.Array(S.Tuple([S.String, PathPieces]))], subject: normalizeSeparators },
    (subject, [entries]) => {
      const join = joinPath
      const names = Object.fromEntries(entries.map(([fileName, pieces]) => [fileName, join(pieces)]))
      return Result.match(S.decodeResult(ReportFileNames)(names), {
        onFailure: () => false,
        onSuccess: (canonical) =>
          Object.values(canonical).every((value) =>
            subject(value) === value && Result.isSuccess(S.decodeResult(CanonicalReportFileName)(value))
          ) && Object.keys(canonical).length === Object.keys(names).length,
      })
    },
  )
}
