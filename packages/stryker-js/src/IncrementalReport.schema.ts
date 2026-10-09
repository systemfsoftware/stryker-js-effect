import * as S from 'effect/Schema'

import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export const IncrementalReportSchema = S.StructWithRest(
  S.Struct({
    incrementalVersion: S.String,
    engineDigest: S.String,
    mutantSetPolicy: Options.MutantSetPolicy,
    runInputsDigest: S.String,
    budget: S.optional(RunEvent.Budget),
    dryRunCoverage: S.optionalKey(S.Unknown),
  }),
  [S.Record(S.String, S.Unknown)],
)

export type IncrementalReport = S.Schema.Type<typeof IncrementalReportSchema>
