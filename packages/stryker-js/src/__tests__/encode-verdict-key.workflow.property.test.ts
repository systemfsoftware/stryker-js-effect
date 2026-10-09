import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  encodeVerdictKey,
  EncodeVerdictKeyCommand,
  type VerdictKeyEncoded,
} from '../verdict-store/encode-verdict-key.workflow.js'
import {
  type CheckerComponents,
  CheckerComponentsSchema,
  type TestedComponents,
  TestedComponentsSchema,
  type VerdictComponents,
  VerdictComponentsSchema,
} from '../verdict-store/VerdictEntry.schema.js'
import { schemeNameOf, VerdictKeyScheme, VerdictKeySchemeSchema } from '../verdict-store/VerdictKeyScheme.schema.js'

type Subject = typeof encodeVerdictKey

interface Swap<C> {
  readonly swapped: (base: C, other: C) => C
  readonly same: (base: C, other: C) => boolean
}

const encodingOf = (subject: Subject, components: VerdictComponents): VerdictKeyEncoded =>
  Result.merge(subject(EncodeVerdictKeyCommand.make({ scheme: VerdictKeyScheme, components })))

const sameCoveringSet = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  Arr.every(left, (id) => right.includes(id)) && Arr.every(right, (id) => left.includes(id))

const sharedSwaps = <C extends VerdictComponents>(): ReadonlyArray<Swap<C>> => [
  { swapped: (b, o) => ({ ...b, engineDigest: o.engineDigest }), same: (b, o) => b.engineDigest === o.engineDigest },
  {
    swapped: (b, o) => ({ ...b, runInputsDigest: o.runInputsDigest }),
    same: (b, o) => b.runInputsDigest === o.runInputsDigest,
  },
  {
    swapped: (b, o) => ({ ...b, mutantSetPolicy: o.mutantSetPolicy }),
    same: (b, o) => b.mutantSetPolicy === o.mutantSetPolicy,
  },
  { swapped: (b, o) => ({ ...b, mutantId: o.mutantId }), same: (b, o) => b.mutantId === o.mutantId },
  { swapped: (b, o) => ({ ...b, fileName: o.fileName }), same: (b, o) => b.fileName === o.fileName },
  { swapped: (b, o) => ({ ...b, mutatorName: o.mutatorName }), same: (b, o) => b.mutatorName === o.mutatorName },
  {
    swapped: (b, o) => ({ ...b, replacementDigest: o.replacementDigest }),
    same: (b, o) => b.replacementDigest === o.replacementDigest,
  },
  {
    swapped: (b, o) => ({ ...b, location: o.location }),
    same: (b, o) => JSON.stringify(b.location) === JSON.stringify(o.location),
  },
  {
    swapped: (b, o) => ({ ...b, fileContentDigest: o.fileContentDigest }),
    same: (b, o) => b.fileContentDigest === o.fileContentDigest,
  },
]

const testedSwaps: ReadonlyArray<Swap<TestedComponents>> = [
  ...sharedSwaps<TestedComponents>(),
  {
    swapped: (b, o) => ({ ...b, coveringTestIds: o.coveringTestIds }),
    same: (b, o) => sameCoveringSet(b.coveringTestIds, o.coveringTestIds),
  },
  {
    swapped: (b, o) => ({ ...b, closureDigest: o.closureDigest }),
    same: (b, o) => b.closureDigest === o.closureDigest,
  },
  {
    swapped: (b, o) => ({ ...b, checkerConfigDigest: o.checkerConfigDigest }),
    same: (b, o) => b.checkerConfigDigest === o.checkerConfigDigest,
  },
]

const checkerSwaps: ReadonlyArray<Swap<CheckerComponents>> = [
  ...sharedSwaps<CheckerComponents>(),
  {
    swapped: (b, o) => ({ ...b, programDigest: o.programDigest }),
    same: (b, o) => b.programDigest === o.programDigest,
  },
]

const swapAgreesWithComponentEquality = <C extends VerdictComponents>(
  subject: Subject,
  swaps: ReadonlyArray<Swap<C>>,
  base: C,
  other: C,
): boolean =>
  Arr.every(
    swaps,
    (swap) =>
      (encodingOf(subject, swap.swapped(base, other)).encoding === encodingOf(subject, base).encoding) ===
        swap.same(base, other),
  )

describe('encodeVerdictKey', () => {
  it.prop(
    '∀tt_TestedComponents_≡AnySingleChangedComponentMovesTheKey',
    { of: [TestedComponentsSchema, TestedComponentsSchema], subject: encodeVerdictKey },
    (subject, [base, other]) => swapAgreesWithComponentEquality(subject, testedSwaps, base, other),
  )

  it.prop(
    '∀cc_CheckerComponents_≡AnySingleChangedComponentMovesTheKey',
    { of: [CheckerComponentsSchema, CheckerComponentsSchema], subject: encodeVerdictKey },
    (subject, [base, other]) => swapAgreesWithComponentEquality(subject, checkerSwaps, base, other),
  )

  it.prop(
    '∀t_TestedComponents_≡CoveringTestOrderKeepsTheKey',
    { of: [TestedComponentsSchema], subject: encodeVerdictKey },
    (subject, [components]) =>
      encodingOf(subject, { ...components, coveringTestIds: Arr.reverse(components.coveringTestIds) }).encoding ===
        encodingOf(subject, components).encoding,
  )

  it.prop(
    '∀tc_TestedAndCheckerComponents_≡KindsNeverShareAKey',
    { of: [TestedComponentsSchema, CheckerComponentsSchema], subject: encodeVerdictKey },
    (subject, [tested, checker]) => encodingOf(subject, tested).encoding !== encodingOf(subject, checker).encoding,
  )

  it.prop(
    '∀tsss_ShiftedSeparator_≡AdjacentComponentsNeverCollide',
    { of: [TestedComponentsSchema, S.String, S.NonEmptyString, S.String], subject: encodeVerdictKey },
    (subject, [components, head, shifted, tail]) =>
      encodingOf(subject, { ...components, engineDigest: `${head}\u0000${shifted}`, runInputsDigest: tail })
        .encoding !==
        encodingOf(subject, { ...components, engineDigest: head, runInputsDigest: `${shifted}\u0000${tail}` })
          .encoding,
  )
})

describe('verdict key schemes', () => {
  it.prop(
    '∀ssc_TwoSchemes_≡DisjointKeysAndListings',
    { of: [VerdictKeySchemeSchema, VerdictKeySchemeSchema, VerdictComponentsSchema], subject: encodeVerdictKey },
    (subject, [left, right, components]) => {
      const encodedAt = (scheme: VerdictKeyScheme) =>
        Result.merge(subject(EncodeVerdictKeyCommand.make({ scheme, components })))
      const sameScheme = schemeNameOf(left) === schemeNameOf(right)
      const atLeft = encodedAt(left)
      const atRight = encodedAt(right)
      return Arr.every([
        (atLeft.encoding === atRight.encoding) === sameScheme,
        (atLeft.directory === atRight.directory) === sameScheme,
        !atLeft.directory.startsWith(`${atRight.directory}/`),
        !atRight.directory.startsWith(`${atLeft.directory}/`),
      ], (holds) => holds)
    },
  )
})
