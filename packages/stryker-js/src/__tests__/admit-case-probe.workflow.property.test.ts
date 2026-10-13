import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'

import { admitCaseProbe, CaseProbeCommand } from '../admit-case-probe.workflow.js'

const commandArb = Arbitrary.schema(CaseProbeCommand)

const decisionOf = (subject: typeof admitCaseProbe, names: ReadonlyArray<string>) =>
  Result.getOrUndefined(subject(CaseProbeCommand.make({ names })))

const lowerAsciiNameOf = (name: string) => `n${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`

const expectedFor = (names: ReadonlyArray<string>) => {
  const pairs = [...names].sort().slice(0, 16).map((name) => ({ name, swapped: name.toUpperCase() }))
  return pairs.length === 0 ? { _tag: 'NoCaseToProbe' } : { _tag: 'CaseProbePairs', pairs }
}

describe('admitCaseProbe', () => {
  it.prop(
    '∀c_RootOfLowerCaseAsciiNames_≡TheFirstSixteenSortedWithTheirUpperCase',
    { of: [commandArb], subject: admitCaseProbe },
    (subject, [command]) => {
      const names = command.names.map(lowerAsciiNameOf)
      return JSON.stringify(decisionOf(subject, names)) === JSON.stringify(expectedFor(names))
    },
  )

  it.prop(
    '∀c_ProbedPair_≡ARootNameAndItsCaseVariant',
    { of: [commandArb], subject: admitCaseProbe },
    (subject, [command]) => {
      const decision = decisionOf(subject, command.names)
      const pairs = decision?._tag === 'CaseProbePairs' ? decision.pairs : []
      return pairs.every((pair) =>
        command.names.includes(pair.name) && pair.swapped !== pair.name &&
        pair.swapped.toLowerCase() === pair.name.toLowerCase()
      )
    },
  )

  it.prop(
    '∀c_ListingOrder_≡SameDecision',
    { of: [commandArb], subject: admitCaseProbe },
    (subject, [command]) =>
      JSON.stringify(decisionOf(subject, command.names)) ===
        JSON.stringify(decisionOf(subject, [...command.names].reverse())),
  )
})
