import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'

import { admitCaseProbe, CaseProbeCommand } from '../admit-case-probe.workflow.js'

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
      const names = command.names.map((_, index) => `n${index}`)
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
})
