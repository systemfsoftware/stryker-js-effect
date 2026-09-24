import { Schema } from 'effect'

export const OracleSliceId = Schema.Literals(['lifecycle', 'edge', 'checker', 'resilience'])

export type OracleSliceId = typeof OracleSliceId.Type

const NonNegativeCount = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))

const Counts = Schema.Struct({
  compileErrors: NonNegativeCount,
  ignored: NonNegativeCount,
  killed: NonNegativeCount,
  noCoverage: NonNegativeCount,
  pending: NonNegativeCount,
  runtimeErrors: NonNegativeCount,
  survived: NonNegativeCount,
  timeout: NonNegativeCount,
})
export type BaselineCountKey = keyof typeof Counts.Type

export type BaselineCounts = typeof Counts.Type

export class BlessedBaseline extends Schema.Class<BlessedBaseline>('BlessedBaseline')({
  artifactContract: Schema.Literal('stryker-oracle-baseline/v1'),
  slice: OracleSliceId,
  strykerConfig: Schema.String,
  counts: Counts,
  mutatorStatusTally: Schema.Record(Schema.String, NonNegativeCount),
}) {
  static readonly ARTIFACT_CONTRACT = 'stryker-oracle-baseline/v1'
}
