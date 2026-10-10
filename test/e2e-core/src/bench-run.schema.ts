import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const BenchSide = S.Literals(['A', 'B'])
export type BenchSide = typeof BenchSide.Type

export const BenchCorpusName = S.Literals(['repo', 'enterprise'])
export type BenchCorpusName = typeof BenchCorpusName.Type

export class BenchRunKey extends S.Class<BenchRunKey>('BenchRunKey')({
  corpus: BenchCorpusName,
  entry: S.NonEmptyString,
  side: BenchSide,
  position: S.Int,
}) {}

const BenchRunTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/BenchRun')
type BenchRunTypeId = typeof BenchRunTypeId

export class BenchRunMeasured extends S.TaggedClass<BenchRunMeasured>()('measured', {
  key: BenchRunKey,
  phaseDurations: RunEvent.PhaseDurations,
  mutants: Report.NonNegativeInt,
  testsExecuted: Report.NonNegativeInt,
  workloadDigest: S.String,
  wallMs: Report.NonNegativeFinite,
  exitCode: S.Int,
}) {
  readonly [BenchRunTypeId] = BenchRunTypeId
}

export class BenchRunInvalid extends S.TaggedClass<BenchRunInvalid>()('invalid', {
  key: BenchRunKey,
  reason: S.String,
  lineNumber: S.NullOr(S.Int),
}) {
  readonly [BenchRunTypeId] = BenchRunTypeId
}

export const BenchRun = S.Union([BenchRunMeasured, BenchRunInvalid])
export type BenchRun = typeof BenchRun.Type
