import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as S from 'effect/Schema'

import { MergedProject } from './shard/shard-merge.schema.js'
import { PriorReportDocument } from './Survivors/Survivors.schema.js'

const GateThresholds = S.Struct({
  break: S.NullOr(Report.Percentage).pipe(S.withDecodingDefaultKey(Effect.succeed(null))),
})

export const GateReportDocument = S.Struct({
  ...PriorReportDocument.fields,
  thresholds: GateThresholds.pipe(S.withDecodingDefaultKey(Effect.succeed({ break: null }))),
  projects: S.Array(MergedProject).pipe(S.withDecodingDefaultKey(Effect.succeed([]))),
})
export type GateReportDocument = typeof GateReportDocument.Type
