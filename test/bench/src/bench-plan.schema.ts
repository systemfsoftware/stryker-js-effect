import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const LegSelectionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-bench/LegSelection')
type LegSelectionTypeId = typeof LegSelectionTypeId

export class AffectedLegs extends S.TaggedClass<AffectedLegs>()('AffectedLegs', {
  base: S.NonEmptyString,
  legs: S.Array(S.NonEmptyString),
  skipped: S.Array(S.NonEmptyString),
}) {
  readonly [LegSelectionTypeId] = LegSelectionTypeId
}

export const FullCorpusReason = S.Literals(['dispatch', 'no-green-ancestor', 'lane-inputs-changed'])
export type FullCorpusReason = typeof FullCorpusReason.Type

export class FullCorpus extends S.TaggedClass<FullCorpus>()('FullCorpus', {
  base: S.NonEmptyString,
  reason: FullCorpusReason,
  legs: S.NonEmptyArray(S.NonEmptyString),
}) {
  readonly [LegSelectionTypeId] = LegSelectionTypeId
}

export const LegSelection = S.Union([AffectedLegs, FullCorpus])
export type LegSelection = typeof LegSelection.Type

export class NoBenchBase extends S.TaggedError<NoBenchBase>()('NoBenchBase', {
  head: S.NonEmptyString,
}) {
  override get message(): string {
    return `${this.head} has no green Bench ancestor and no first parent, so side A cannot be chosen`
  }
}

export class TurboAffectedPackage extends S.Class<TurboAffectedPackage>('TurboAffectedPackage')({
  path: S.String,
}) {}

export class TurboAffected extends S.Class<TurboAffected>('TurboAffected')({
  data: S.Struct({ affectedPackages: S.Struct({ items: S.Array(TurboAffectedPackage) }) }),
}) {}

export const TurboAffectedJson: S.Codec<TurboAffected, string> = S.fromJsonString(TurboAffected)

export const BenchLegsJson: S.Codec<ReadonlyArray<string>, string> = S.NonEmptyString.pipe(S.Array, S.fromJsonString)

const SHA = 's'

const decodes = <T, E>(schema: S.Codec<T, E>, encoded: E): boolean => Result.isSuccess(S.decodeResult(schema)(encoded))

const textFieldVerdicts = (value: string): ReadonlyArray<boolean> => [
  decodes(AffectedLegs, { _tag: 'AffectedLegs', base: value, legs: [], skipped: [] }),
  decodes(AffectedLegs, { _tag: 'AffectedLegs', base: SHA, legs: [value], skipped: [] }),
  decodes(AffectedLegs, { _tag: 'AffectedLegs', base: SHA, legs: [], skipped: [value] }),
  decodes(FullCorpus, { _tag: 'FullCorpus', base: value, reason: 'dispatch', legs: [SHA] }),
  decodes(FullCorpus, { _tag: 'FullCorpus', base: SHA, reason: 'dispatch', legs: [value] }),
  decodes(NoBenchBase, { _tag: 'NoBenchBase', head: value }),
]

const fullCorpusVerdicts = (reason: string, legCount: number): ReadonlyArray<boolean> => [
  Result.isSuccess(
    S.decodeUnknownResult(FullCorpus)({
      _tag: 'FullCorpus',
      base: SHA,
      reason,
      legs: Array.from({ length: legCount }, () => SHA),
    }),
  ),
]

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const reasons = ['dispatch', 'no-green-ancestor', 'lane-inputs-changed']

  it.prop(
    '∀s_LegSelectionTextRefusal_≡EveryShaAndLegRefusesOnlyTheEmptyString',
    { of: [S.String], subject: textFieldVerdicts },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append(['', ' ', SHA], drawn),
        (value) => Arr.every(subject(value), (accepted) => accepted === value.length > 0),
      ),
  )

  it.prop(
    '∀sn_FullCorpusRefusal_≡AKnownReasonAndAtLeastOneLeg',
    { of: [S.String, S.Int], subject: fullCorpusVerdicts },
    (subject, [drawn, count]) =>
      Arr.every(
        Arr.append(['', 'push', 'dispatch ', ...reasons], drawn),
        (reason) =>
          Arr.every([0, 1, 2, Math.abs(count) % 5], (legs) =>
            Arr.every(subject(reason, legs), (accepted) => accepted === (reasons.includes(reason) && legs > 0))),
      ),
  )
}
