import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
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

export const BenchRunFailureCode = S.Literals(['stream-undecodable', 'stream-invalid'])
export type BenchRunFailureCode = typeof BenchRunFailureCode.Type

export class BenchRunMeasured extends S.TaggedClass<BenchRunMeasured>()('measured', {
  key: BenchRunKey,
  phaseDurations: RunEvent.PhaseDurations,
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
  exitCode: S.Int,
  stderrTail: S.String,
}) {
  readonly [BenchRunTypeId] = BenchRunTypeId
}

export const BenchRun = S.Union([BenchRunMeasured, BenchRunInvalid])
export type BenchRun = typeof BenchRun.Type

const acceptsFailureCode = (code: string): boolean => Result.isSuccess(S.decodeUnknownResult(BenchRunFailureCode)(code))

const acceptsInvalidExitCode = (exitCode: number | null): boolean =>
  Result.isSuccess(
    S.decodeUnknownResult(BenchRunInvalid)({
      _tag: 'invalid',
      key: { corpus: 'repo', entry: 'entry', side: 'A', position: 0 },
      code: 'stream-invalid',
      reason: 'reason',
      lineNumber: null,
      exitCode,
      stderrTail: '',
    }),
  )

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  it.prop(
    '∀s_BenchRunFailureCodeRefusal_≡OnlyAnUndecodableOrInvalidStream',
    { of: [S.String], subject: acceptsFailureCode },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append(['', 'timeout', 'stream-undecodable', 'stream-invalid'], drawn),
        (code) => subject(code) === (code === 'stream-undecodable' || code === 'stream-invalid'),
      ),
  )

  it.prop(
    '∀n_InvalidRunExitCodeRefusal_≡AlwaysASafeInteger',
    { of: [S.NullOr(S.Finite)], subject: acceptsInvalidExitCode },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append([null, -1, 0, 1, 1.5, 2 ** 53, Number.NaN], drawn),
        (exitCode) => subject(exitCode) === (exitCode !== null && Number.isSafeInteger(exitCode)),
      ),
  )
}
