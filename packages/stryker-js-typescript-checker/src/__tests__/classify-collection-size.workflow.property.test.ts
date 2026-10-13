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
  type LengthSide,
  type ReceiverKind,
  type SizeComparison,
  type SizeOperator,
} from '../classify-collection-size.workflow.js'

const CONSTANT_CELLS: ReadonlyArray<readonly [LengthSide, SizeOperator, boolean, Option.Option<boolean>]> = [
  ['left', '>=', true, Option.some(true)],
  ['left', '>=', false, Option.none()],
  ['left', '<', true, Option.some(false)],
  ['left', '<', false, Option.none()],
  ['left', '>', true, Option.none()],
  ['left', '>', false, Option.none()],
  ['left', '<=', true, Option.none()],
  ['left', '<=', false, Option.none()],
  ['right', '<=', true, Option.some(true)],
  ['right', '<=', false, Option.none()],
  ['right', '>', true, Option.some(false)],
  ['right', '>', false, Option.none()],
  ['right', '<', true, Option.none()],
  ['right', '<', false, Option.none()],
  ['right', '>=', true, Option.none()],
  ['right', '>=', false, Option.none()],
]

const constantOf = (comparison: SizeComparison): Option.Option<boolean> =>
  Option.flatMap(
    Arr.findFirst(
      CONSTANT_CELLS,
      ([side, operator, againstZero]) =>
        side === comparison.lengthSide &&
        operator === comparison.operator &&
        againstZero === comparison.againstZero,
    ),
    (row) => row[3],
  )

const receiverIsCollection = (receiver: ReadonlyArray<ReceiverKind>): boolean =>
  Boolean.every([receiver.length > 0, Arr.every(receiver, (kind) => kind !== 'other')])

const qualifies = (comparison: SizeComparison): boolean =>
  Boolean.every([
    comparison.referenceReceiver,
    comparison.strictNullChecks,
    receiverIsCollection(comparison.receiver),
  ])

const siblingBacks = (
  candidates: ClassifyCollectionSizeCommand['sites'][number]['candidates'],
  index: number,
  always: boolean,
): boolean =>
  Arr.some(
    candidates,
    (sibling, siblingIndex) =>
      Boolean.every([siblingIndex !== index, sibling.kept, Option.contains(sibling.literal, always)]),
  )

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
          Option.filter(constantOf(comparison), () => qualifies(comparison)))
        const culled = Boolean.and(
          candidate.kept,
          Option.exists(constant, (always) =>
            siblingBacks(site.candidates, index, always)),
        )
        return culled
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
