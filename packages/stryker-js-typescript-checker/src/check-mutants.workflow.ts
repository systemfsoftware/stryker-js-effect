import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CheckMutantsInput, type DiagnosticDecoded } from './CheckMutants.schema.js'

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

export const CheckOutcomes = S.Array(S.Union([MutantPassed, MutantFailed]))
export type CheckOutcomes = typeof CheckOutcomes.Type
export type CheckOutcome = MutantPassed | MutantFailed

export type CheckMutantsAnswer = S.Codec.Encoded<typeof CheckOutcomes>

const outcomeOf = (mutantId: Mutant.MutantId, diagnostics: readonly DiagnosticDecoded[]): CheckOutcome =>
  Boolean.match(diagnostics.length === 0, {
    onTrue: () => MutantPassed.make({ id: mutantId }),
    onFalse: () =>
      MutantFailed.make({ id: mutantId, reason: Arr.map(diagnostics, (diagnostic) => diagnostic.rendered).join('\n') }),
  })

const decide = (input: CheckMutantsInput): Result.Result<CheckOutcomes, never> => {
  const diagnostics = HashMap.fromIterable(
    Arr.map(input.verdicts, (verdict) => [verdict.id, verdict.diagnostics] as const),
  )
  return Result.succeed(
    Arr.map(input.mutants, (mutant) =>
      outcomeOf(
        mutant.id,
        Option.getOrElse(HashMap.get(diagnostics, mutant.id), (): readonly DiagnosticDecoded[] => []),
      )),
  )
}

export const checkMutants = Workflow.make({
  command: CheckMutantsInput,
  decision: CheckOutcomes,
  error: S.Never,
  decide,
})
