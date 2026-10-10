import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const MutantSetFactsSchema = S.Struct({
  originalCode: S.String,
  replacementCode: S.String,
})
export type MutantSetFacts = typeof MutantSetFactsSchema.Type

export const MutantSetRuleId = S.Literals(['equivalent-to-original', 'duplicate-at-site'])
export type MutantSetRuleId = typeof MutantSetRuleId.Type

export class MutantSetPolicyCommand extends S.TaggedClass<MutantSetPolicyCommand>()('MutantSetPolicyCommand', {
  policy: Options.MutantSetPolicy,
  candidates: S.Array(MutantSetFactsSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const MutantSetOutcomeTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/MutantSetOutcome',
)
type MutantSetOutcomeTypeId = typeof MutantSetOutcomeTypeId

export class MutantSuppressed extends S.TaggedClass<MutantSuppressed>()('MutantSuppressed', {
  ruleId: MutantSetRuleId,
  detail: S.String,
}) {
  readonly [MutantSetOutcomeTypeId] = MutantSetOutcomeTypeId
}

export class MutantKept extends S.TaggedClass<MutantKept>()('MutantKept', {}) {
  readonly [MutantSetOutcomeTypeId] = MutantSetOutcomeTypeId
}

export const MutantSetOutcome = S.Union([MutantSuppressed, MutantKept])
export type MutantSetOutcome = typeof MutantSetOutcome.Type

export const MutantSetDecision = S.Array(MutantSetOutcome)

const canonicalForm = (text: string): string => stripOuterParentheses(text.trim())

const stripOuterParentheses = (text: string): string =>
  Match.value(wrapsWhole(text)).pipe(
    Match.when(true, () => stripOuterParentheses(text.slice(1, -1).trim())),
    Match.orElse(() => text),
  )

const parenDepthDelta = (character: string): number =>
  Match.value(character).pipe(
    Match.when('(', () => 1),
    Match.when(')', () => -1),
    Match.orElse(() => 0),
  )

const depthsAfter = (text: string): readonly number[] =>
  text.split('').reduce<readonly number[]>(
    (depths, character) => [...depths, Option.getOrElse(Arr.last(depths), () => 0) + parenDepthDelta(character)],
    [],
  )

const wrapsWhole = (text: string): boolean => {
  const depths = depthsAfter(text)
  return [
    text.startsWith('('),
    text.endsWith(')'),
    depths.length > 0,
    depths.slice(0, -1).every((depth) => depth >= 1),
    Option.getOrElse(Arr.last(depths), () => 0) === 0,
  ].every(Boolean)
}

const defaultOnly = <A>(
  policy: Options.MutantSetPolicyType,
  value: () => Option.Option<A>,
): Option.Option<A> =>
  Match.value(policy).pipe(
    Match.when('full', () => Option.none<A>()),
    Match.when('default', value),
    Match.exhaustive,
  )

const printedAs = (code: string): string => canonicalForm(code)

const printsSomething = (code: string): boolean => printedAs(code).length > 0

const samePrintedCode = (left: string, right: string): boolean =>
  [printsSomething(left), printedAs(left) === printedAs(right)].every(Boolean)

const alreadyPrinted = (code: string, earlier: readonly string[]): boolean =>
  [printsSomething(code), earlier.includes(printedAs(code))].every(Boolean)

const equivalentSuppression = (
  facts: MutantSetFacts,
  policy: Options.MutantSetPolicyType,
): Option.Option<MutantSuppressed> =>
  defaultOnly(policy, () =>
    Option.map(
      Option.filter(
        Option.some(facts),
        (candidate) => samePrintedCode(candidate.replacementCode, candidate.originalCode),
      ),
      () =>
        MutantSuppressed.make({
          ruleId: 'equivalent-to-original',
          detail: `${printedAs(facts.replacementCode)} is the original code`,
        }),
    ))

const duplicateSuppression = (
  facts: MutantSetFacts,
  earlier: readonly string[],
  policy: Options.MutantSetPolicyType,
): Option.Option<MutantSuppressed> =>
  defaultOnly(policy, () =>
    Option.map(
      Option.filter(Option.some(facts), (candidate) => alreadyPrinted(candidate.replacementCode, earlier)),
      () =>
        MutantSuppressed.make({
          ruleId: 'duplicate-at-site',
          detail: `${printedAs(facts.replacementCode)} is already planted at this site`,
        }),
    ))

const outcomeOf = (
  facts: MutantSetFacts,
  earlier: readonly string[],
  policy: Options.MutantSetPolicyType,
): MutantSetOutcome =>
  Option.getOrElse(
    Option.orElse(equivalentSuppression(facts, policy), () => duplicateSuppression(facts, earlier, policy)),
    () => MutantKept.make({}),
  )

interface FoldState {
  readonly outcomes: readonly MutantSetOutcome[]
  readonly earlier: readonly string[]
}

const foldCandidate = (
  state: FoldState,
  facts: MutantSetFacts,
  policy: Options.MutantSetPolicyType,
): FoldState => ({
  outcomes: [...state.outcomes, outcomeOf(facts, state.earlier, policy)],
  earlier: [...state.earlier, canonicalForm(facts.replacementCode)],
})

const outcomesFor = (command: MutantSetPolicyCommand): readonly MutantSetOutcome[] =>
  command.candidates
    .reduce<FoldState>(
      (state, facts) => foldCandidate(state, facts, command.policy),
      { outcomes: [], earlier: [] },
    )
    .outcomes

export const mutantSetPolicy = Workflow.make({
  command: MutantSetPolicyCommand,
  decision: MutantSetDecision,
  error: S.Never,
  decide: (command: MutantSetPolicyCommand): Result.Result<readonly MutantSetOutcome[], never> =>
    Result.succeed([...outcomesFor(command)]),
})
