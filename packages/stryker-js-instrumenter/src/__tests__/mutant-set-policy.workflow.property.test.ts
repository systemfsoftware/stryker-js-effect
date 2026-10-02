import { it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  MutantKept,
  type MutantSetFacts,
  MutantSetFactsSchema,
  type MutantSetOutcome,
  mutantSetPolicy,
  MutantSetPolicyCommand,
  MutantSuppressed,
} from '../mutant-set-policy.workflow.js'

const holds = (conditions: readonly boolean[]): boolean => conditions.every((condition) => condition)

const outcomeOf = (
  decided: Result.Result<readonly MutantSetOutcome[], never>,
): MutantSetOutcome | undefined =>
  Result.match(decided, {
    onFailure: () => undefined,
    onSuccess: (outcomes) => (outcomes.length === 1 ? outcomes[0] : undefined),
  })

const isFacts = (value: unknown): value is MutantSetFacts => typeof value === 'object' && value !== null

const literalCode = (code: string): boolean =>
  holds([code.length > 0, code.includes('(') === false, code.includes(')') === false, code.trim() === code])

const sameLiteralCode = (facts: MutantSetFacts): boolean =>
  holds([facts.replacementCode === facts.originalCode, literalCode(facts.originalCode)])

const sameReplacementAsEarlier = (
  candidates: readonly MutantSetFacts[],
  facts: MutantSetFacts,
  index: number,
): boolean =>
  holds([
    literalCode(facts.replacementCode),
    candidates.slice(0, index).some((earlier) => earlier.replacementCode === facts.replacementCode),
  ])

const repeatsAReplacement = (candidates: readonly MutantSetFacts[]): boolean =>
  candidates.some((facts, index) => sameReplacementAsEarlier(candidates, facts, index))

const tokenCharacterArb = Arbitrary.schema(S.Literals(['a', 'b', 'c', '0', '1', 'Z']))

const tokenArb = Arbitrary.array(tokenCharacterArb, { minLength: 1, maxLength: 6 }).pipe(
  Arbitrary.map((characters) => characters.join('')),
)

const plainFactsArb: Arbitrary.Arbitrary<MutantSetFacts> = Arbitrary.schema(MutantSetFactsSchema)

const literalFactsArb: Arbitrary.Arbitrary<MutantSetFacts> = Arbitrary.all({
  code: tokenArb,
  relationalSufficient: Arbitrary.schema(S.Boolean),
}).pipe(
  Arbitrary.map(({ code, relationalSufficient }) =>
    MutantSetFactsSchema.make({ originalCode: code, replacementCode: code, relationalSufficient })
  ),
)

const candidateFactsArb: Arbitrary.Arbitrary<MutantSetFacts> = Arbitrary.schema(S.Boolean).pipe(
  Arbitrary.flatMap((literal) => (literal ? literalFactsArb : plainFactsArb)),
)

const relationalInsufficientFactsArb: Arbitrary.Arbitrary<MutantSetFacts> = plainFactsArb.pipe(
  Arbitrary.map((facts) => MutantSetFactsSchema.make({ ...facts, relationalSufficient: false })),
)

const candidateArbs = {
  plain: plainFactsArb,
  literal: literalFactsArb,
  relational: relationalInsufficientFactsArb,
} as const

const candidateArb: Arbitrary.Arbitrary<MutantSetFacts> = Arbitrary.schema(
  S.Literals(['plain', 'literal', 'relational']),
).pipe(Arbitrary.flatMap((kind) => candidateArbs[kind]))

const candidateListArb = Arbitrary.array(candidateArb, { maxLength: 3 })

const duplicatedListArb = Arbitrary.all({
  head: literalFactsArb,
  tail: candidateListArb,
}).pipe(Arbitrary.map(({ head, tail }) => [head, head, ...tail]))

const candidatesArb: Arbitrary.Arbitrary<readonly MutantSetFacts[]> = Arbitrary.schema(S.Boolean).pipe(
  Arbitrary.flatMap((duplicated) => (duplicated ? duplicatedListArb : candidateListArb)),
)

const fullPolicyCommandArb: Arbitrary.Arbitrary<MutantSetPolicyCommand> = candidatesArb.pipe(
  Arbitrary.map((candidates) => MutantSetPolicyCommand.make({ policy: 'full', candidates })),
)

it.prop(
  '∀pf_PolicyAndFacts_≡TheRelationalVerdictDecidesTheSingleCandidateOutcome',
  {
    of: [S.Literals(['default', 'full']), candidateFactsArb],
    subject: mutantSetPolicy,
    cover: {
      fullPolicy: [(policy) => policy === 'full', 0.2],
      relationalSuppression: [
        (policy, facts) => holds([policy === 'default', isFacts(facts) && facts.relationalSufficient === false]),
        0.1,
      ],
      equivalentSuppression: [
        (policy, facts) =>
          holds([
            policy === 'default',
            isFacts(facts) && facts.relationalSufficient === true && sameLiteralCode(facts),
          ]),
        0.05,
      ],
      keptUnderDefault: [
        (policy, facts) =>
          holds([
            policy === 'default',
            isFacts(facts) && facts.relationalSufficient === true && sameLiteralCode(facts) === false,
          ]),
        0.05,
      ],
    },
  },
  (subject, [policy, facts]) => {
    const outcome = outcomeOf(subject(MutantSetPolicyCommand.make({ policy, candidates: [facts] })))
    if (policy === 'full') {
      return outcome !== undefined && S.is(MutantKept)(outcome)
    }
    if (facts.relationalSufficient === false) {
      return outcome !== undefined && S.is(MutantSuppressed)(outcome) && outcome.ruleId === 'redundant-relational'
    }
    if (sameLiteralCode(facts)) {
      return outcome !== undefined && S.is(MutantSuppressed)(outcome) && outcome.ruleId === 'equivalent-to-original'
    }
    return (
      outcome !== undefined &&
      (S.is(MutantKept)(outcome) || (S.is(MutantSuppressed)(outcome) && outcome.ruleId === 'equivalent-to-original'))
    )
  },
)

it.prop(
  '∀c_Command_≡TheFullPolicySuppressesNothing',
  {
    of: [fullPolicyCommandArb],
    subject: mutantSetPolicy,
    cover: {
      emptyCandidates: [(command) => command.candidates.length === 0, 0.05],
      relationalInsufficientCandidate: [
        (command) => command.candidates.some((facts) => facts.relationalSufficient === false),
        0.2,
      ],
      equivalentCandidate: [(command) => command.candidates.some((facts) => sameLiteralCode(facts)), 0.2],
      duplicateReplacement: [(command) => repeatsAReplacement(command.candidates), 0.15],
    },
  },
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
