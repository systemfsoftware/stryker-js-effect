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
}) {
  get label(): string {
    return `${this.corpus}/${this.entry} ${this.side}@${this.position}`
  }
}

const BenchRunTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/BenchRun')
type BenchRunTypeId = typeof BenchRunTypeId

export const WorkloadDigest = S.TaggedUnion({
  verified: { digest: S.NonEmptyString },
  unverified: { reason: S.NonEmptyString },
})
export type WorkloadDigest = typeof WorkloadDigest.Type

export const BenchRunFailureCode = S.Literals(['stream-undecodable', 'stream-invalid', 'timeout'])
export type BenchRunFailureCode = typeof BenchRunFailureCode.Type

export const RunExit = S.TaggedUnion({
  exited: { code: S.Int },
  'timed-out': { afterMs: Report.NonNegativeFinite },
})
export type RunExit = typeof RunExit.Type

export const PhaseTime = S.Struct({
  phase: RunEvent.RunPhase,
  startMs: Report.NonNegativeFinite,
  endMs: Report.NonNegativeFinite,
})
export type PhaseTime = typeof PhaseTime.Type

export const LineArrivals = S.Array(Report.NonNegativeFinite)

export const LineArrivalsJson = S.fromJsonString(LineArrivals)

export class BenchRunMeasured extends S.TaggedClass<BenchRunMeasured>()('measured', {
  key: BenchRunKey,
  phaseDurations: RunEvent.PhaseDurations,
  phaseTimes: S.Array(PhaseTime),
  mutants: Report.NonNegativeInt,
  testsExecuted: Report.NonNegativeInt,
  workloadDigest: WorkloadDigest,
  wallMs: Report.NonNegativeFinite,
  exitCode: S.Int,
}) {
  readonly [BenchRunTypeId] = BenchRunTypeId
}

export class BenchRunInvalid extends S.TaggedClass<BenchRunInvalid>()('invalid', {
  key: BenchRunKey,
  code: BenchRunFailureCode,
  reason: S.String,
  lineNumber: S.NullOr(S.Int),
  exitCode: S.NullOr(S.Int),
  stderrTail: S.String,
}) {
  readonly [BenchRunTypeId] = BenchRunTypeId
}

export const BenchRun = S.Union([BenchRunMeasured, BenchRunInvalid])
export type BenchRun = typeof BenchRun.Type
