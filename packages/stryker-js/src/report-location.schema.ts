import { LocationSchema } from '@systemfsoftware/stryker-js-instrumenter'
import { SchemaGetter } from 'effect'
import * as S from 'effect/Schema'

export class MutantLocation extends S.Class<MutantLocation>()('MutantLocation', {
  start: S.Struct({ line: S.Finite, column: S.Finite }),
  end: S.Struct({ line: S.Finite, column: S.Finite }),
}) {}

const oneBased = (position: { readonly line: number; readonly column: number }) => ({
  line: position.line + 1,
  column: position.column + 1,
})

export const ReportLocationFromMutant = MutantLocation.pipe(
  S.decodeTo(LocationSchema, {
    decode: SchemaGetter.transform((location: MutantLocation) => ({
      start: oneBased(location.start),
      end: oneBased(location.end),
    })),
    encode: SchemaGetter.forbiddenEncoding,
  }),
)
