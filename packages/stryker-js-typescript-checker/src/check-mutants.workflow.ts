import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CheckMutantsInput, type DiagnosticDecoded, type TceOutcome } from './CheckMutants.schema.js'

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

const IGNORE_REASON: Record<TceOutcome, string> = {
  original: 'equivalent-to-original: tce',
  sibling: 'duplicate-at-site: tce',
}

const ignoreReasonOf = (tce: TceOutcome | undefined): Option.Option<string> =>
  Option.flatMap(Option.fromUndefinedOr(tce), (present) => Option.fromUndefinedOr(IGNORE_REASON[present]))

const outcomeOf = (
  mutantId: Mutant.MutantId,
  diagnostics: readonly DiagnosticDecoded[],
  tce: TceOutcome | undefined,
): CheckOutcome =>
  Boolean.match(diagnostics.length === 0, {
    onFalse: () =>
      MutantFailed.make({ id: mutantId, reason: Arr.map(diagnostics, (diagnostic) => diagnostic.rendered).join('\n') }),
    onTrue: () =>
      Option.match(ignoreReasonOf(tce), {
        onNone: () => MutantPassed.make({ id: mutantId }),
        onSome: (reason) => MutantIgnored.make({ id: mutantId, reason }),
      }),
  })

const decide = (input: CheckMutantsInput): Result.Result<CheckOutcomes, never> => {
  const verdicts = HashMap.fromIterable(Arr.map(input.verdicts, (verdict) => [verdict.id, verdict] as const))
  return Result.succeed(
    Arr.map(input.mutants, (mutant) =>
      Option.match(HashMap.get(verdicts, mutant.id), {
        onNone: () => outcomeOf(mutant.id, [], undefined),
        onSome: (verdict) => outcomeOf(mutant.id, verdict.diagnostics, verdict.tce),
      })),
  )
}

export const checkMutants = Workflow.make({
  command: CheckMutantsInput,
  decision: CheckOutcomes,
  error: S.Never,
  decide,
})
