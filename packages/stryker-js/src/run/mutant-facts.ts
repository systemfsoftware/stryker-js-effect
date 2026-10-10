import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type LineStarts, lineStartsOf, offsetAt } from '@systemfsoftware/stryker-js-instrumenter'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as SchemaIssue from 'effect/SchemaIssue'

import { MutantFactsInvalid } from '../Run.schema.js'

export interface SourceText {
  readonly text: string
  readonly lineStarts: LineStarts
}

export const sourceTextOf = (text: string): SourceText => ({ text, lineStarts: lineStartsOf(text) })

export interface MutantFactsInput {
  readonly result: Mutant.RunMutantResult
  readonly file: Mutant.CanonicalFileName
  readonly source: Option.Option<SourceText>
}

const originalTextOf = (source: Option.Option<SourceText>, location: Mutant.Location): string | null =>
  Option.getOrNull(
    Option.flatMap(source, ({ text, lineStarts }) =>
      Option.zipWith(
        offsetAt(lineStarts, location.start),
        offsetAt(lineStarts, location.end),
        (start, end) => text.slice(start, end),
      )),
  )

const invalidFacts = (result: Mutant.RunMutantResult, detail: string): MutantFactsInvalid =>
  MutantFactsInvalid.make({ code: 'mutant-facts-invalid', mutantId: result.id, detail })

const statusReasonOf = (result: Mutant.RunMutantResult): Effect.Effect<string, MutantFactsInvalid> =>
  Effect.fromOption(
    Option.fromUndefinedOr(result.statusReason),
    () => invalidFacts(result, `the ${result.status} mutant carries no status reason`),
  )

const formatIssue = SchemaIssue.makeFormatterDefault()

const madeFor = <A>(
  result: Mutant.RunMutantResult,
  made: Effect.Effect<A, SchemaIssue.Issue>,
): Effect.Effect<A, MutantFactsInvalid> =>
  Effect.mapError(
    made,
    (issue) => invalidFacts(result, `the ${result.status} facts are refused: ${formatIssue(issue)}`),
  )

const sharedFactsOf = ({ result, file }: MutantFactsInput, statusReason: string) => ({
  id: result.id,
  fileName: file,
  location: result.location,
  mutatorName: result.mutatorName,
  replacement: result.replacement,
  static: Option.getOrElse(Option.fromUndefinedOr(result.static), () => false),
  cost: Option.getOrNull(Option.map(Option.fromUndefinedOr(result.cost), (cost) => RunEvent.MutantCost.make(cost))),
  subsumption: Option.getOrNull(Option.fromUndefinedOr(result.subsumption)),
  statusReason,
})

const actionableFactsOf = <Status extends Mutant.ActionableStatus>(
  { result, file, source }: MutantFactsInput,
  status: Status,
) => {
  const measured = Option.fromUndefinedOr(result.coveredBy)
  return {
    original: originalTextOf(source, result.location),
    coveredBy: [...Option.getOrElse(measured, () => [])],
    next: RunEvent.nextActionOf(
      { id: result.id, file, location: result.location, coveredBy: Option.getOrNull(measured) },
      status,
    ),
  }
}

export const mutantFactsOf = Effect.fnUntraced(function*(input: MutantFactsInput) {
  const { result } = input
  const shared = sharedFactsOf(input, yield* statusReasonOf(result))
  const { cases } = RunEvent.MutantFacts
  return yield* Match.value(result.status).pipe(
    Match.when('Killed', () =>
      madeFor(
        result,
        cases.Killed.makeEffect({
          ...shared,
          status: 'Killed',
          killedBy: [...Option.getOrElse(Option.fromUndefinedOr(result.killedBy), () => [])],
        }),
      )),
    Match.when('Survived', () =>
      madeFor(
        result,
        cases.Survived.makeEffect({ ...shared, status: 'Survived', ...actionableFactsOf(input, 'Survived') }),
      )),
    Match.when('NoCoverage', () => {
      const { original, next } = actionableFactsOf(input, 'NoCoverage')
      return madeFor(result, cases.NoCoverage.makeEffect({ ...shared, status: 'NoCoverage', original, next }))
    }),
    Match.when('Timeout', () =>
      madeFor(
        result,
        cases.Timeout.makeEffect({ ...shared, status: 'Timeout', ...actionableFactsOf(input, 'Timeout') }),
      )),
    Match.when('RuntimeError', () =>
      madeFor(
        result,
        cases.RuntimeError.makeEffect({
          ...shared,
          status: 'RuntimeError',
          ...actionableFactsOf(input, 'RuntimeError'),
        }),
      )),
    Match.when(
      'CompileError',
      () => madeFor(result, cases.CompileError.makeEffect({ ...shared, status: 'CompileError' })),
    ),
    Match.when('Ignored', () => madeFor(result, cases.Ignored.makeEffect({ ...shared, status: 'Ignored' }))),
    Match.when(
      'Pending',
      () => Effect.fail(invalidFacts(result, 'a Pending mutant reached the stream before it settled')),
    ),
    Match.exhaustive,
  )
})
