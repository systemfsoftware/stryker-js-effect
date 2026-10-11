import { it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import {
  classifyCollectionSize,
  ClassifyCollectionSizeCommand,
  type MutantSite,
  type SizeComparison,
} from '../classify-collection-size.workflow.js'

const SIZES = [0, 1, 2, 3, 2 ** 32 - 1]

const holdsAt = (comparison: SizeComparison, size: number): boolean => {
  const [left, right] = comparison.lengthSide === 'left' ? [size, 0] : [0, size]
  switch (comparison.operator) {
    case '<':
      return left < right
    case '<=':
      return left <= right
    case '>':
      return left > right
    case '>=':
      return left >= right
  }
}

const provenConstantOf = (comparison: SizeComparison): boolean | undefined => {
  const outcomes = new Set(SIZES.map((size) => holdsAt(comparison, size)))
  const typesProveACollection = comparison.receiver.length > 0 &&
    comparison.receiver.every((kind) => kind !== 'other')
  return comparison.againstZero && typesProveACollection && outcomes.size === 1 ? [...outcomes][0] : undefined
}

const expectedCullsOf = (site: MutantSite): ReadonlyArray<readonly [string, boolean]> =>
  site.candidates.flatMap((candidate, index) => {
    const always = candidate.kept
      ? Option.match(candidate.comparison, {
        onNone: () => undefined,
        onSome: provenConstantOf,
      })
      : undefined
    const keptSiblingHasIt = site.candidates.some((sibling, siblingIndex) =>
      siblingIndex !== index && sibling.kept && Option.getOrUndefined(sibling.literal) === always
    )
    return always !== undefined && keptSiblingHasIt ? [[candidate.id, always] as const] : []
  })

it.prop(
  '∀c_Command_≡CulledExactlyWhenTheTypesProveTheConstantAndAKeptSiblingHasIt',
  { of: [ClassifyCollectionSizeCommand], subject: classifyCollectionSize },
  (subject, [command]) =>
    Result.match(subject(command), {
      onFailure: () => false,
      onSuccess: (decisions) =>
        Equal.equals(
          decisions.map((decision) => [decision.id, decision.always] as const),
          command.sites.flatMap(expectedCullsOf),
        ),
    }),
)
