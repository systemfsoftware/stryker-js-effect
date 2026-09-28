import { it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  MutantKept,
  MutantSetFactsSchema,
  type MutantSetOutcome,
  mutantSetPolicy,
  MutantSetPolicyCommand,
  MutantSuppressed,
} from '../mutant-set-policy.workflow.js'

const outcomeOf = (
  decided: Result.Result<readonly MutantSetOutcome[], never>,
): MutantSetOutcome | undefined =>
  Result.match(decided, {
    onFailure: () => undefined,
    onSuccess: (outcomes) => (outcomes.length === 1 ? outcomes[0] : undefined),
  })

it.prop(
  '∀pf_PolicyAndFacts_≡TheRelationalVerdictDecidesTheSingleCandidateOutcome',
  { of: [S.Literals(['default', 'full']), MutantSetFactsSchema], subject: mutantSetPolicy },
  (subject, [policy, facts]) => {
    const outcome = outcomeOf(subject(MutantSetPolicyCommand.make({ policy, candidates: [facts] })))
    if (policy === 'full') {
      return outcome !== undefined && S.is(MutantKept)(outcome)
    }
    if (facts.relationalSufficient === false) {
      return outcome !== undefined && S.is(MutantSuppressed)(outcome) && outcome.ruleId === 'redundant-relational'
    }
    return true
  },
)

it.prop(
  '∀c_Command_≡TheFullPolicySuppressesNothing',
  { of: [MutantSetPolicyCommand], subject: mutantSetPolicy },
  (subject, [command]) =>
    Result.match(
      subject(MutantSetPolicyCommand.make({ policy: 'full', candidates: [...command.candidates] })),
      {
        onFailure: () => false,
        onSuccess: (outcomes) =>
          outcomes.length === command.candidates.length && outcomes.every((outcome) => S.is(MutantKept)(outcome)),
      },
    ),
)
