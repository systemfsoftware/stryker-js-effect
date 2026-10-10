import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  OtherSite,
  Subsumed,
  subsumeMutants,
  SubsumeMutantsCommand,
  type SubsumptionDecision,
} from '../subsume-mutants.workflow.js'

type Candidate = SubsumeMutantsCommand['candidates'][number]
type DecidedPair = [Candidate, SubsumptionDecision]
type SubsumedPair = [Candidate, Subsumed]

const decisionsOf = (decided: Result.Result<readonly SubsumptionDecision[], never>): readonly SubsumptionDecision[] =>
  Result.getOrElse(decided, () => [])

const isSubsumed = S.is(Subsumed)

const isSubsumedPair = (pair: DecidedPair): pair is SubsumedPair => isSubsumed(pair[1])

const isKeptUnaffectedPair = (pair: DecidedPair): boolean => pair[0].status === 'StaticallyKept' && !isSubsumed(pair[1])

describe('subsumeMutants', () => {
  it.prop(
    '∀c_Command_≡ASubsumedMutantIsKeptAndNamesOnlyKeptUnaffectedCandidates',
    { of: [SubsumeMutantsCommand], subject: subsumeMutants },
    (subject, [command]) => {
      const decisions = decisionsOf(subject(command))
      const pairs = Arr.zip(command.candidates, decisions)
      const keptUnaffected = new Set(pairs.filter(isKeptUnaffectedPair).map(([candidate]) => candidate.id))
      return decisions.length === command.candidates.length &&
        pairs.filter(isSubsumedPair).every(([candidate, subsumed]) =>
          candidate.status === 'StaticallyKept' && subsumed.dominators.every((id) => keptUnaffected.has(id))
        )
    },
  )

  it.prop(
    '∀c_Command_≡IgnoringEveryNamedDominatorLeavesTheMutantUnaffected',
    { of: [SubsumeMutantsCommand], subject: subsumeMutants },
    (subject, [command]) => {
      const named = new Set(decisionsOf(subject(command)).filter(isSubsumed).flatMap((subsumed) => subsumed.dominators))
      const withoutDominators = SubsumeMutantsCommand.make({
        policy: command.policy,
        site: command.site,
        candidates: command.candidates.map((candidate) =>
          named.has(candidate.id) ? { ...candidate, status: 'StaticallyIgnored' as const } : candidate
        ),
      })
      return !decisionsOf(subject(withoutDominators)).some(isSubsumed)
    },
  )

  it.prop(
    '∀c_Command_≡OnlyARelationalSiteUnderTheDefaultPolicySubsumes',
    { of: [SubsumeMutantsCommand], subject: subsumeMutants },
    (subject, [command]) => {
      const full = decisionsOf(
        subject(SubsumeMutantsCommand.make({ policy: 'full', site: command.site, candidates: command.candidates })),
      )
      const other = decisionsOf(
        subject(
          SubsumeMutantsCommand.make({
            policy: command.policy,
            site: OtherSite.make({}),
            candidates: command.candidates,
          }),
        ),
      )
      return [full, other].every((decisions) =>
        decisions.length === command.candidates.length && !decisions.some(isSubsumed)
      )
    },
  )
})
