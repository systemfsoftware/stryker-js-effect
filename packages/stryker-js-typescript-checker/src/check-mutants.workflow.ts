import { Workflow } from '@systemfsoftware/effect-cell-types'
import { type Checker, Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type CheckIgnore, CheckMutantsInput, type DiagnosticDecoded } from './CheckMutants.schema.js'

const CheckTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/CheckOutcome')
type CheckTypeId = typeof CheckTypeId

export class MutantPassed extends S.TaggedClass<MutantPassed>()('MutantPassed', {
  id: Mutant.MutantId,
}) {
  readonly [CheckTypeId] = CheckTypeId
}

export class MutantFailed extends S.TaggedClass<MutantFailed>()('MutantFailed', {
  id: Mutant.MutantId,
  reason: S.String,
}) {
  readonly [CheckTypeId] = CheckTypeId
}

export class MutantIgnored extends S.TaggedClass<MutantIgnored>()('MutantIgnored', {
  id: Mutant.MutantId,
  reason: S.String,
}) {
  readonly [CheckTypeId] = CheckTypeId
}

export const CheckOutcomes = S.Array(S.Union([MutantPassed, MutantFailed, MutantIgnored]))
export type CheckOutcomes = typeof CheckOutcomes.Type
export type CheckOutcome = MutantPassed | MutantFailed | MutantIgnored

export type CheckMutantsAnswer = S.Codec.Encoded<typeof CheckOutcomes>

const ignoreReasonOf = (ignore: CheckIgnore, replacement: string): string =>
  Match.value(ignore).pipe(
    Match.when('original', () => 'equivalent-to-original: tce'),
    Match.when('sibling', () => 'duplicate-at-site: tce'),
    Match.when('always-true', () => `constant-collection-size: ${replacement} is always true`),
    Match.when('always-false', () => `constant-collection-size: ${replacement} is always false`),
    Match.exhaustive,
  )

const outcomeOf = (
  mutant: Checker.CheckerMutantWire,
  diagnostics: readonly DiagnosticDecoded[],
  ignore: CheckIgnore | undefined,
): CheckOutcome =>
  Boolean.match(diagnostics.length === 0, {
    onFalse: () =>
      MutantFailed.make({
        id: mutant.id,
        reason: Arr.map(diagnostics, (diagnostic) => diagnostic.rendered).join('\n'),
      }),
    onTrue: () =>
      Option.match(Option.fromUndefinedOr(ignore), {
        onNone: () => MutantPassed.make({ id: mutant.id }),
        onSome: (present) => MutantIgnored.make({ id: mutant.id, reason: ignoreReasonOf(present, mutant.replacement) }),
      }),
  })

const decide = (input: CheckMutantsInput): Result.Result<CheckOutcomes, never> => {
  const verdicts = HashMap.fromIterable(Arr.map(input.verdicts, (verdict) => [verdict.id, verdict] as const))
  return Result.succeed(
    Arr.map(input.mutants, (mutant) =>
      Option.match(HashMap.get(verdicts, mutant.id), {
        onNone: () => outcomeOf(mutant, [], undefined),
        onSome: (verdict) => outcomeOf(mutant, verdict.diagnostics, verdict.ignore),
      })),
  )
}

export const checkMutants = Workflow.make({
  command: CheckMutantsInput,
  decision: CheckOutcomes,
  error: S.Never,
  decide,
})
