import { it } from '@systemfsoftware/vitest'
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

const ORIGINAL_WITHOUT_A_STRING_LITERAL = 'site'

const outcomesOf = (
  decide: typeof mutantSetPolicy,
  candidates: ReadonlyArray<MutantSetFacts>,
): readonly MutantSetOutcome[] =>
  Result.getOrElse(
    decide(MutantSetPolicyCommand.make({ policy: 'default', candidates: [...candidates] })),
    () => [],
  )

const againstTheOriginal = (decide: typeof mutantSetPolicy, originalCode: string, replacementCode: string) =>
  outcomesOf(decide, [{ originalCode, replacementCode }])[0]

const laterAtTheSite = (decide: typeof mutantSetPolicy, earlier: string, later: string) =>
  outcomesOf(decide, [
    { originalCode: ORIGINAL_WITHOUT_A_STRING_LITERAL, replacementCode: earlier },
    { originalCode: ORIGINAL_WITHOUT_A_STRING_LITERAL, replacementCode: later },
  ])[1]

const isKept = (outcome: MutantSetOutcome | undefined): boolean => outcome !== undefined && S.is(MutantKept)(outcome)

const suppressedAs = (outcome: MutantSetOutcome | undefined, ruleId: MutantSuppressed['ruleId']): boolean =>
  outcome !== undefined && S.is(MutantSuppressed)(outcome) && outcome.ruleId === ruleId

const neitherCulledAsTheOther = (decide: typeof mutantSetPolicy, left: string, right: string): boolean =>
  [
    isKept(againstTheOriginal(decide, left, right)),
    isKept(againstTheOriginal(decide, right, left)),
    isKept(laterAtTheSite(decide, left, right)),
    isKept(laterAtTheSite(decide, right, left)),
  ].every(Boolean)

const literalOf = (text: string): string => JSON.stringify(text)

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

it.prop(
  '∀f_SequenceAndItsParenthesisedForm_≡NeitherIsCulledAsTheOther',
  { of: [MutantSetFactsSchema], subject: mutantSetPolicy },
  (subject, [facts]) => {
    const sequence = `${literalOf(facts.originalCode)}, ${literalOf(facts.replacementCode)}`
    return neitherCulledAsTheOther(subject, sequence, `(${sequence})`)
  },
)

it.prop(
  '∀f_ArrowBodyObjectAndTheBlockItsBracesSpell_≡NeitherIsCulledAsTheOther',
  { of: [MutantSetFactsSchema], subject: mutantSetPolicy },
  (subject, [facts]) => {
    const braces = `{ ${literalOf(facts.originalCode)}: ${literalOf(facts.replacementCode)} }`
    return neitherCulledAsTheOther(subject, braces, `(${braces})`)
  },
)

it.prop(
  '∀f_StringLiterals_≡DuplicatesAtTheSiteExactlyWhenTheirContentsAreEqual',
  { of: [MutantSetFactsSchema], subject: mutantSetPolicy },
  (subject, [facts]) =>
    suppressedAs(
      laterAtTheSite(subject, literalOf(facts.originalCode), literalOf(facts.replacementCode)),
      'duplicate-at-site',
    ) === (facts.originalCode === facts.replacementCode),
)

it.prop(
  '∀f_ExpressionUnderPaddedParentheses_≡CulledAsTheOriginalAndAsTheSitesDuplicate',
  { of: [MutantSetFactsSchema], subject: mutantSetPolicy },
  (subject, [facts]) => {
    const expression = `f(${literalOf(facts.originalCode)}) + ${literalOf(facts.replacementCode)}`
    const padded = ` ( ${expression} ) `
    return [
      suppressedAs(againstTheOriginal(subject, expression, padded), 'equivalent-to-original'),
      suppressedAs(laterAtTheSite(subject, expression, padded), 'duplicate-at-site'),
    ].every(Boolean)
  },
)
