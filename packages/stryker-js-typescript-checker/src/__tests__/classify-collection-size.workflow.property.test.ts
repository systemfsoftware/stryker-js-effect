import { describe } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import {
  classifyCollectionSize,
  ClassifyCollectionSizeCommand,
  type CollectionSizeDecision,
  type ReceiverKind,
  type SizeComparison,
} from '../classify-collection-size.workflow.js'

const ALWAYS: {
  readonly [side in SizeComparison['lengthSide']]: { readonly [operator in SizeComparison['operator']]?: boolean }
} = {
  left: { '>=': true, '<': false },
  right: { '<=': true, '>': false },
}

const receiverIsCollection = (receiver: ReadonlyArray<ReceiverKind>): boolean =>
  Boolean.every([receiver.length > 0, Arr.every(receiver, (kind) => kind !== 'other')])

const decisions = (
  command: ClassifyCollectionSizeCommand,
): ReadonlyArray<{ readonly id: string; readonly always: boolean }> =>
  Arr.map(
    Result.match(classifyCollectionSize(command), { onFailure: () => [], onSuccess: (decision) => decision }),
    (decision: CollectionSizeDecision) => ({ id: decision.id, always: decision.always }),
  )

const expected = (
  command: ClassifyCollectionSizeCommand,
): ReadonlyArray<{ readonly id: string; readonly always: boolean }> =>
  Arr.flatMap(command.sites, (site) =>
    Arr.getSomes(
      Arr.map(site.candidates, (candidate, index) => {
        const constant = Option.flatMap(candidate.comparison, (comparison) =>
          Option.filter(
            Option.fromUndefinedOr(ALWAYS[comparison.lengthSide][comparison.operator]),
            () =>
              Boolean.every([
                comparison.againstZero,
                comparison.referenceReceiver,
                comparison.strictNullChecks,
                receiverIsCollection(comparison.receiver),
              ]),
          ))
        const siblingBacks = Option.exists(constant, (always) =>
          Arr.some(
            site.candidates,
            (sibling, siblingIndex) =>
              Boolean.every([siblingIndex !== index, sibling.kept, Option.contains(sibling.literal, always)]),
          ))
        return Boolean.and(candidate.kept, siblingBacks)
          ? Option.map(constant, (always): { readonly id: string; readonly always: boolean } => ({
            id: candidate.id,
            always,
          }))
          : Option.none()
      }),
    ))

describe('classifyCollectionSize', (it) => {
  it.prop(
    '∀command_Decisions_≡IndependentDecisionTable',
    { of: [Arbitrary.schema(ClassifyCollectionSizeCommand)], subject: decisions },
    (subject, [command]) => Equal.equals(subject(command), expected(command)),
  )
})
