import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  OtherSite,
  Subsumed,
  subsumeMutants,
  SubsumeMutantsCommand,
  type SubsumptionDecision,
} from '../subsume-mutants.workflow.js'

const decisionsOf = (decided: Result.Result<readonly SubsumptionDecision[], never>): readonly SubsumptionDecision[] =>
  Result.getOrElse(decided, () => [])

const isSubsumed = S.is(Subsumed)

describe('subsumeMutants', () => {
  it.prop(
    '∀c_Command_≡ASubsumedMutantIsKeptAndNamesOnlyKeptUnaffectedCandidates',
    { of: [SubsumeMutantsCommand], subject: subsumeMutants },
    (subject, [command]) => {
      const decisions = decisionsOf(subject(command))
      const keptUnaffected = (id: Mutant.MutantId): boolean =>
        command.candidates.some((candidate, index) =>
          candidate.id === id && candidate.status === 'StaticallyKept' && !isSubsumed(decisions[index])
        )
      return decisions.length === command.candidates.length &&
        decisions.every((decision, index) =>
          !isSubsumed(decision) ||
          (command.candidates[index]!.status === 'StaticallyKept' && decision.dominators.every(keptUnaffected))
        )
    },
  )

  it.prop(
    '∀c_Command_≡IgnoringEveryNamedDominatorLeavesTheMutantUnaffected',
    { of: [SubsumeMutantsCommand], subject: subsumeMutants },
    (subject, [command]) => {
      const named = new Set(
        decisionsOf(subject(command)).flatMap((decision) => isSubsumed(decision) ? decision.dominators : []),
      )
      const withoutDominators = SubsumeMutantsCommand.make({
        ...command,
        candidates: command.candidates.map((candidate) =>
          named.has(candidate.id) ? { ...candidate, status: 'StaticallyIgnored' as const } : candidate
        ),
      })
      return decisionsOf(subject(withoutDominators)).every((decision) => !isSubsumed(decision))
    },
  )

  it.prop(
    '∀c_Command_≡OnlyARelationalSiteUnderTheDefaultPolicySubsumes',
    { of: [SubsumeMutantsCommand], subject: subsumeMutants },
    (subject, [command]) => {
      const full = decisionsOf(subject(SubsumeMutantsCommand.make({ ...command, policy: 'full' })))
      const other = decisionsOf(subject(SubsumeMutantsCommand.make({ ...command, site: OtherSite.make({}) })))
      return [full, other].every((decisions) =>
        decisions.length === command.candidates.length && !decisions.some(isSubsumed)
      )
    },
  )
})
