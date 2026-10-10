import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type LineStarts, lineStartsOf, offsetAt } from '@systemfsoftware/stryker-js-instrumenter'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

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

const originalTextOf = (source: Option.Option<SourceText>, location: Mutant.Location): string =>
  Option.getOrElse(
    Option.flatMap(source, ({ text, lineStarts }) =>
      Option.zipWith(
        offsetAt(lineStarts, location.start),
        offsetAt(lineStarts, location.end),
        (start, end) => text.slice(start, end),
      )),
    () => '',
  )

const requiredReasonOf = (result: Mutant.RunMutantResult): string =>
  Option.getOrThrowWith(
    Option.fromUndefinedOr(result.statusReason),
    () => new Error(`${result.status} mutant ${result.id} reached the stream without a status reason`),
  )

const sharedFactsOf = ({ result, file }: MutantFactsInput) => ({
  id: result.id,
  fileName: file,
  location: result.location,
  mutatorName: result.mutatorName,
  replacement: result.replacement,
  static: Option.getOrElse(Option.fromUndefinedOr(result.static), () => false),
  cost: Option.getOrNull(Option.map(Option.fromUndefinedOr(result.cost), (cost) => RunEvent.MutantCost.make(cost))),
  subsumption: Option.getOrNull(Option.fromUndefinedOr(result.subsumption)),
  statusReason: requiredReasonOf(result),
})

const actionableFactsOf = <Status extends Mutant.ActionableStatus>(
  { result, file, source }: MutantFactsInput,
  status: Status,
) => {
  const coveredBy = [...Option.getOrElse(Option.fromUndefinedOr(result.coveredBy), () => [])]
  return {
    original: originalTextOf(source, result.location),
    coveredBy,
    next: RunEvent.nextActionOf({ id: result.id, file, location: result.location, coveredBy }, status),
  }
}

export const mutantFactsOf = (input: MutantFactsInput): RunEvent.MutantFacts => {
  const { result } = input
  const shared = sharedFactsOf(input)
  const { cases } = RunEvent.MutantFacts
  return Match.value(result.status).pipe(
    Match.when('Killed', () =>
      cases.Killed.make({
        ...shared,
        status: 'Killed',
        killedBy: [...Option.getOrElse(Option.fromUndefinedOr(result.killedBy), () => [])],
      })),
    Match.when(
      'Survived',
      () => cases.Survived.make({ ...shared, status: 'Survived', ...actionableFactsOf(input, 'Survived') }),
    ),
    Match.when('NoCoverage', () => {
      const { original, next } = actionableFactsOf(input, 'NoCoverage')
      return cases.NoCoverage.make({ ...shared, status: 'NoCoverage', original, next })
    }),
    Match.when(
      'Timeout',
      () => cases.Timeout.make({ ...shared, status: 'Timeout', ...actionableFactsOf(input, 'Timeout') }),
    ),
    Match.when(
      'RuntimeError',
      () => cases.RuntimeError.make({ ...shared, status: 'RuntimeError', ...actionableFactsOf(input, 'RuntimeError') }),
    ),
    Match.when('CompileError', () => cases.CompileError.make({ ...shared, status: 'CompileError' })),
    Match.when('Ignored', () => cases.Ignored.make({ ...shared, status: 'Ignored' })),
    Match.when('Pending', (): never => {
      throw new Error(`Pending mutant ${result.id} reached the stream before it settled`)
    }),
    Match.exhaustive,
  )
}
