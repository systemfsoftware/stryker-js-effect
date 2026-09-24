import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

export const ReportFileName = S.String.pipe(
  S.decodeTo(S.String.pipe(S.check(S.isPattern(/^[^\\]*$/))), {
    decode: SGetter.transform((relativePath) => relativePath.replaceAll('\\', '/')),
    encode: SGetter.transform((canonical) => canonical),
  }),
)
export type ReportFileName = typeof ReportFileName.Type
