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

  const idsArb = Arbitrary.array(Arbitrary.schema(S.String.check(S.isPattern(/^[0-9a-f]{4}$/))), { maxLength: 12 })

  it.prop(
    '∀ids_Missing_≡NamesTheFirstFiveAndCountsTheRest',
    { of: [idsArb], subject: missingShardMutantsTextOf },
    (subject, [ids]) => {
      const [a, b, c, d, e, ...rest] = ids
      const named = [a, b, c, d, e].filter((id) => id !== undefined).join(', ')
      return subject(ids) === (rest.length === 0 ? named : `${named}, +${rest.length} more`)
    },
  )
}
