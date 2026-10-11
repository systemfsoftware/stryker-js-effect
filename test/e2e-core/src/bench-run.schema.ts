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

export const RunIdentity = S.TaggedUnion({
  read: { projectRoot: S.NonEmptyString, runInputsDigest: S.NonEmptyString, mutantIdsDigest: S.NonEmptyString },
  unread: { reason: S.NonEmptyString },
})
export type RunIdentity = typeof RunIdentity.Type

export const BenchRunFailureCode = S.Literals(['stream-undecodable', 'stream-invalid'])
export type BenchRunFailureCode = typeof BenchRunFailureCode.Type

export class BenchRunMeasured extends S.TaggedClass<BenchRunMeasured>()('measured', {
  key: BenchRunKey,
  phaseDurations: RunEvent.PhaseDurations,
  mutants: Report.NonNegativeInt,
  testsExecuted: Report.NonNegativeInt,
  workloadDigest: WorkloadDigest,
  identity: RunIdentity,
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
  exitCode: S.Int,
  stderrTail: S.String,
}) {
  readonly [BenchRunTypeId] = BenchRunTypeId
}

export const BenchRun = S.Union([BenchRunMeasured, BenchRunInvalid])
export type BenchRun = typeof BenchRun.Type
