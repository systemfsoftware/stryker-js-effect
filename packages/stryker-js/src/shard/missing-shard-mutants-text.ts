import * as Boolean from 'effect/Boolean'

const MISSING_IDS_NAMED = 5

const namedIds = (missingIds: ReadonlyArray<string>): string => missingIds.slice(0, MISSING_IDS_NAMED).join(', ')

const unnamedCount = (missingIds: ReadonlyArray<string>): number => missingIds.length - MISSING_IDS_NAMED

export const missingShardMutantsTextOf = (missingIds: ReadonlyArray<string>): string =>
  Boolean.match(unnamedCount(missingIds) > 0, {
    onTrue: () => `${namedIds(missingIds)}, +${unnamedCount(missingIds)} more`,
    onFalse: () => namedIds(missingIds),
  })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arbitrary = await import('effect/Arbitrary')
  const S = await import('effect/Schema')
  const { Mutant } = await import('@systemfsoftware/stryker-js-plugin-interface')

  const idsArb = Mutant.MutantId.pipe(S.Array, Arbitrary.schema)

  it.prop(
    '∀ids_AtMostFive_≡NamesEveryIdAndNoCount',
    { of: [idsArb], subject: missingShardMutantsTextOf },
    (subject, [drawn]) => {
      const ids = drawn.slice(0, 5)
      return subject(ids) === ids.join(', ')
    },
  )

  it.prop(
    '∀ids_MoreThanFive_≡NamesTheFirstFiveThenCountsTheRest',
    {
      of: [Mutant.MutantId.pipe(S.Array, S.check(S.isMinLength(6)), Arbitrary.schema)],
      subject: missingShardMutantsTextOf,
    },
    (subject, [ids]) => subject(ids) === `${ids.slice(0, 5).join(', ')}, +${ids.length - 5} more`,
  )
}
