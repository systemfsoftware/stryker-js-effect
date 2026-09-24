import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

export const CanonicalReportFileName = S.String.pipe(S.check(S.isPattern(/^[^\\]*$/)))
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
      ),
    ),
    encode: SGetter.transform((canonical) => canonical),
  }),
)
export type ReportFileNames = typeof ReportFileNames.Type

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const PathPieces = S.Array(S.Tuple([S.Literals(['src', 'sub', 'x.ts', '']), S.Literals(['/', '\\'])]))

  const joinPath = (pieces: ReadonlyArray<readonly [string, string]>) =>
    pieces.map(([segment, separator]) => `${segment}${separator}`).join('')

  it.prop('∀p_ReportFileName_DecodesToCanonicalFixpoint', [PathPieces], ([pieces]) => {
    const relativePath = joinPath(pieces)
    return Result.match(S.decodeResult(ReportFileName)(relativePath), {
      onFailure: () => false,
      onSuccess: (canonical) =>
        Result.isSuccess(S.decodeResult(CanonicalReportFileName)(canonical)) &&
        Result.match(S.encodeResult(ReportFileName)(canonical), {
          onFailure: () => false,
          onSuccess: (encoded) => encoded === canonical,
        }),
    })
  })

  it.prop('∀names_ReportFileNames_ConservesKeysCanonicalizesValues', [S.Array(S.Tuple([S.String, PathPieces]))], ([
    entries,
  ]) => {
    const names = Object.fromEntries(entries.map(([fileName, pieces]) => [fileName, joinPath(pieces)]))
    return Result.match(S.decodeResult(ReportFileNames)(names), {
      onFailure: () => false,
      onSuccess: (canonical) =>
        Object.entries(canonical).every(([fileName, value]) =>
          Result.isSuccess(S.decodeResult(CanonicalReportFileName)(value)),
        ) && Object.keys(canonical).length === Object.keys(names).length,
    })
  })
}
