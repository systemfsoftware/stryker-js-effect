import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  describeMissingShardMutants,
  DescribeMissingShardMutantsCommand,
} from '../describe-missing-shard-mutants.workflow.js'

const MISSING_IDS_NAMED = 5

const textOf = (missingIds: ReadonlyArray<string>): string =>
  Result.getOrElse(
    describeMissingShardMutants(DescribeMissingShardMutantsCommand.make({ missingIds })),
    (neverError) => neverError,
  ).text

const NAMED_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const

const labelArb = Arbitrary.schema(S.Literals(NAMED_LABELS))

const atMostNamedIds = Arbitrary.array(labelArb, { maxLength: MISSING_IDS_NAMED })
const overNamedIds = Arbitrary.array(labelArb, { minLength: MISSING_IDS_NAMED + 1, maxLength: MISSING_IDS_NAMED + 4 })

const partsOf = (text: string): ReadonlyArray<string> => text === '' ? [] : text.split(', ')

const messageCases: ReadonlyArray<{
  readonly name: string
  readonly missingIds: ReadonlyArray<string>
  readonly expected: string
}> = [
  { name: 'no missing ids render an empty message', missingIds: [], expected: '' },
  { name: 'one id renders alone', missingIds: ['m1'], expected: 'm1' },
  { name: 'five ids render joined', missingIds: ['m1', 'm2', 'm3', 'm4', 'm5'], expected: 'm1, m2, m3, m4, m5' },
  {
    name: 'six ids render five joined then one more',
    missingIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
    expected: 'm1, m2, m3, m4, m5, +1 more',
  },
  {
    name: 'seven ids render five joined then two more',
    missingIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
    expected: 'm1, m2, m3, m4, m5, +2 more',
  },
]

describe('describeMissingShardMutants', () => {
  it.prop(
    '∀ids_MissingIdsAtMostFive_≡EachIdNamedOnceInInputOrderWithNoRestCount',
    { of: [atMostNamedIds], subject: describeMissingShardMutants },
    (subject, [missingIds]) => {
      const text = Result.getOrElse(
        subject(DescribeMissingShardMutantsCommand.make({ missingIds })),
        (neverError) => neverError,
      ).text
      const parts = partsOf(text)
      return !text.includes('more') &&
        parts.length === missingIds.length &&
        Arr.every(parts, (part, index) => part === missingIds[index])
    },
  )

  it.prop(
    '∀ids_MissingIdsOverFive_≡FirstFiveNamedInInputOrderThenCountsTheRest',
    { of: [overNamedIds], subject: describeMissingShardMutants },
    (subject, [missingIds]) => {
      const text = Result.getOrElse(
        subject(DescribeMissingShardMutantsCommand.make({ missingIds })),
        (neverError) => neverError,
      ).text
      const named = missingIds.slice(0, MISSING_IDS_NAMED)
      const parts = partsOf(text)
      return parts.length === named.length + 1 &&
        Arr.every(named, (id, index) => parts[index] === id) &&
        parts[named.length] === `+${missingIds.length - named.length} more`
    },
  )

  it.each(messageCases)('$name', function*(row, { expect }) {
    yield* expect(textOf(row.missingIds)).toBe(row.expected)
  })
})
