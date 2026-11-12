import * as S from 'effect/Schema'

export class PrintFailed extends S.TaggedError<PrintFailed, { readonly brand: unique symbol }>(
  '@systemfsoftware/stryker-js-instrumenter/print/PrintFailed.schema/PrintFailed',
)(
  'PrintFailed',
  {
    message: S.String,
  },
) {}
