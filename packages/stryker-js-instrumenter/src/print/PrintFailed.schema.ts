import * as S from 'effect/Schema'

export class PrintFailed
  extends S.TaggedError<PrintFailed>()('@systemfsoftware/stryker-js-instrumenter/print/PrintFailed.schema/PrintFailed')(
    'PrintFailed',
    {
      message: S.String,
    },
  )
{}
