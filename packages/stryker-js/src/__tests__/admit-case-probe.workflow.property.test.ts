import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { admitCaseProbe, CaseProbeCommand, CaseProbePairs } from '../admit-case-probe.workflow.js'

const commandArb = Arbitrary.schema(CaseProbeCommand)

const pairsOf = (subject: typeof admitCaseProbe, names: ReadonlyArray<string>) => {
  const decision = Result.getOrUndefined(subject(CaseProbeCommand.make({ names })))
  return decision?._tag === 'CaseProbePairs' ? decision.pairs : []
}

const uncasedPartOf = (name: string) =>
  name.split('').filter((char) => char.toUpperCase() === char && char.toLowerCase() === char).join('')

describe('admitCaseProbe', () => {
  it.prop(
    '∀c_RootOfDistinctLetterNames_≡AtMostSixteenProbedAndNoneSkippedBeforeThem',
    { of: [commandArb], subject: admitCaseProbe },
    (subject, [command]) => {
      const names = Array.from({ length: command.names.length * 4 }, (_, index) => `n${index}`)
      const probed = pairsOf(subject, names).map((pair) => pair.name)
      const skipped = names.filter((name) => !probed.includes(name))
      return probed.length === Math.min(16, names.length) &&
        skipped.every((name) => probed.every((chosen) => chosen < name))
    },
  )

  it.prop(
    '∀c_RootWithoutCasedNames_≡NoCaseToProbe',
    { of: [commandArb], subject: admitCaseProbe },
    (subject, [command]) =>
      Result.getOrUndefined(subject(CaseProbeCommand.make({ names: command.names.map(uncasedPartOf) })))?._tag ===
        'NoCaseToProbe',
  )

  it.prop(
    '∀c_ProbedPair_≡ARootNameAndItsCaseVariant',
    { of: [commandArb], subject: admitCaseProbe },
    (subject, [command]) =>
      pairsOf(subject, command.names).every((pair) =>
        command.names.includes(pair.name) && pair.swapped !== pair.name &&
        pair.swapped.toLowerCase() === pair.name.toLowerCase()
      ),
  )

  it.prop(
    '∀c_ListingOrder_≡SameDecision',
    { of: [commandArb], subject: admitCaseProbe },
    (subject, [command]) =>
      JSON.stringify(pairsOf(subject, command.names)) ===
        JSON.stringify(pairsOf(subject, [...command.names].reverse())),
  )

  it.prop(
    '∀p_CaseProbePairsRefusal_≡EmptyPairs',
    { of: [S.Array(S.Struct({ name: S.String, swapped: S.String }))], subject: S.decodeUnknownResult(CaseProbePairs) },
    (subject, [pairs]) =>
      Result.isSuccess(subject({ _tag: 'CaseProbePairs', pairs })) === Arr.isReadonlyArrayNonEmpty(pairs),
  )
})
