import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as S from 'effect/Schema'

const RoundsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/CheckRounds')
type RoundsTypeId = typeof RoundsTypeId

export class SoloRound extends S.TaggedClass<SoloRound>()('SoloRound', {
  id: Mutant.MutantId,
}) {
  readonly [RoundsTypeId] = RoundsTypeId
}

export class SharedRound extends S.TaggedClass<SharedRound>()('SharedRound', {
  ids: S.Array(Mutant.MutantId).check(S.isMinLength(2)),
}) {
  readonly [RoundsTypeId] = RoundsTypeId
}

export const CheckRound = S.Union([SoloRound, SharedRound])
export type CheckRound = typeof CheckRound.Type

export const CheckRounds = S.Array(CheckRound)
export type CheckRounds = typeof CheckRounds.Type

export const roundOfLayer = ([id, ...others]: Arr.NonEmptyReadonlyArray<Mutant.MutantId>): CheckRound =>
  Arr.match(others, {
    onEmpty: () => SoloRound.make({ id }),
    onNonEmpty: (rest) => SharedRound.make({ ids: [id, ...rest] }),
  })

const accepts = {
  sharedRoundIds: S.is(SharedRound.fields.ids),
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const idsOf = (round: CheckRound): ReadonlyArray<Mutant.MutantId> => S.is(SoloRound)(round) ? [round.id] : round.ids
  const sameIds = Arr.makeEquivalence(S.toEquivalence(Mutant.MutantId))

  it.prop(
    '∀l_RoundOfLayer_≡SoloForOneIdSharedOtherwiseKeepingEveryIdInOrder',
    { of: [S.NonEmptyArray(Mutant.MutantId)], subject: roundOfLayer },
    (subject, [layer]) => {
      const round = subject(layer)
      return S.is(SoloRound)(round) === (layer.length === 1) && sameIds(idsOf(round), layer)
    },
  )

  const holdsTwoOrMore = (ids: ReadonlyArray<Mutant.MutantId>): boolean => ids.length > 1

  it.prop(
    '∀i_SharedRoundIdsRefusal_≡FewerThanTwoIds',
    { of: [S.Array(Mutant.MutantId)], subject: accepts },
    (subject, [drawn]) =>
      Arr.every(
        [Arr.take(drawn, 0), Arr.take(drawn, 1), drawn],
        (ids) => subject.sharedRoundIds(ids) === holdsTwoOrMore(ids),
      ),
  )
}
