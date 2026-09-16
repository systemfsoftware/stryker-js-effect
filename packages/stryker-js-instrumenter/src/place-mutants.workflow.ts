import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type MutantNotApplied, MutantsUnapplied, type PlacerName, PlacerNameSchema } from './Instrument.schema.js'

export const PlacementFactsSchema = S.Struct({
  isExpression: S.Boolean,
  isStatement: S.Boolean,
  isSwitchCase: S.Boolean,
  expressionIsValid: S.Boolean,
})
export type PlacementFacts = typeof PlacementFactsSchema.Type

const ReplacementFactsSchema = S.Struct({
  isExpression: S.Boolean,
  isStatement: S.Boolean,
  isSwitchCase: S.Boolean,
})

const PlacedMutantSchema = S.Struct({
  id: S.String,
  mutatorName: S.String,
  replacement: ReplacementFactsSchema,
})
export type PlacedMutant = typeof PlacedMutantSchema.Type

export class PlaceMutantsCommand extends S.TaggedClass<PlaceMutantsCommand>()('PlaceMutantsCommand', {
  fileName: S.String,
  facts: PlacementFactsSchema,
  mutants: S.Array(PlacedMutantSchema),
}) {}

const PlacementDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-instrumenter/PlacementDecision')
type PlacementDecisionTypeId = typeof PlacementDecisionTypeId

export class ExpressionSite extends S.TaggedClass<ExpressionSite>()('ExpressionSite', {
  fileName: S.String,
  mutantIds: S.Array(S.String),
}) {
  readonly [PlacementDecisionTypeId] = PlacementDecisionTypeId
}

export class StatementSite extends S.TaggedClass<StatementSite>()('StatementSite', {
  fileName: S.String,
  mutantIds: S.Array(S.String),
}) {
  readonly [PlacementDecisionTypeId] = PlacementDecisionTypeId
}

export class SwitchCaseSite extends S.TaggedClass<SwitchCaseSite>()('SwitchCaseSite', {
  fileName: S.String,
  mutantIds: S.Array(S.String),
}) {
  readonly [PlacementDecisionTypeId] = PlacementDecisionTypeId
}

export type EditSite = ExpressionSite | StatementSite | SwitchCaseSite
export type PlacementDecision = EditSite

const ExpectedKindSchema = S.Literals(['an expression', 'a statement', 'a switch case'])
type ExpectedKind = typeof ExpectedKindSchema.Type

export class MutantKindMismatch extends S.TaggedError<MutantKindMismatch>()('MutantKindMismatch', {
  fileName: S.String,
  placer: PlacerNameSchema,
  mutantId: S.String,
  mutatorName: S.String,
  expected: ExpectedKindSchema,
}) {}

export class NoPlacerClaimsNode extends S.TaggedError<NoPlacerClaimsNode>()('NoPlacerClaimsNode', {
  fileName: S.String,
}) {}

export type PlacementRefusal = MutantKindMismatch | NoPlacerClaimsNode | MutantsUnapplied | MutantNotApplied

const claimingPlacer = (facts: PlacementFacts): Option.Option<PlacerName> =>
  Match.value(facts).pipe(
    Match.when({ isExpression: true, expressionIsValid: true }, () => Option.some<PlacerName>('expression')),
    Match.when({ isStatement: true }, () => Option.some<PlacerName>('statement')),
    Match.when({ isSwitchCase: true }, () => Option.some<PlacerName>('switch-case')),
    Match.orElse(() => Option.none<PlacerName>()),
  )

const placerOf = (command: PlaceMutantsCommand): Result.Result<PlacerName, NoPlacerClaimsNode> =>
  Match.value(claimingPlacer(command.facts)).pipe(
    Match.when(Option.isSome, (chosen) => Result.succeed(chosen.value)),
    Match.when(Option.isNone, () => Result.fail(new NoPlacerClaimsNode({ fileName: command.fileName }))),
    Match.exhaustive,
  )

const expectedKindOf = (placer: PlacerName): ExpectedKind =>
  Match.value(placer).pipe(
    Match.when('expression', (): ExpectedKind => 'an expression'),
    Match.when('statement', (): ExpectedKind => 'a statement'),
    Match.when('switch-case', (): ExpectedKind => 'a switch case'),
    Match.exhaustive,
  )

const matchesPlacer = (placer: PlacerName, replacement: typeof ReplacementFactsSchema.Type): boolean =>
  Match.value(placer).pipe(
    Match.when('expression', () => replacement.isExpression),
    Match.when('statement', () => replacement.isStatement),
    Match.when('switch-case', () => replacement.isSwitchCase),
    Match.exhaustive,
  )

const firstMismatch = (command: PlaceMutantsCommand, placer: PlacerName): Option.Option<MutantKindMismatch> =>
  Option.map(
    Option.fromNullishOr(command.mutants.find((mutant) => !matchesPlacer(placer, mutant.replacement))),
    (mutant) =>
      new MutantKindMismatch({
        fileName: command.fileName,
        placer,
        mutantId: mutant.id,
        mutatorName: mutant.mutatorName,
        expected: expectedKindOf(placer),
      }),
  )

const placementRefusal = (
  command: PlaceMutantsCommand,
  placer: PlacerName,
): Result.Result<void, MutantKindMismatch> =>
  Match.value(firstMismatch(command, placer)).pipe(
    Match.when(Option.isSome, (mismatch) => Result.fail(mismatch.value)),
    Match.when(Option.isNone, () => Result.succeed(undefined)),
    Match.exhaustive,
  )

const siteOf = (command: PlaceMutantsCommand, placer: PlacerName): EditSite => {
  const mutantIds = command.mutants.map((mutant) => mutant.id)
  return Match.value(placer).pipe(
    Match.when('expression', () => new ExpressionSite({ fileName: command.fileName, mutantIds })),
    Match.when('statement', () => new StatementSite({ fileName: command.fileName, mutantIds })),
    Match.when('switch-case', () => new SwitchCaseSite({ fileName: command.fileName, mutantIds })),
    Match.exhaustive,
  )
}

export const placeMutants = Workflow.make(
  PlaceMutantsCommand,
  (command: PlaceMutantsCommand): Result.Result<PlacementDecision, PlacementRefusal> =>
    Result.gen(function*() {
      const placer = yield* placerOf(command)
      yield* placementRefusal(command, placer)
      return siteOf(command, placer)
    }),
)
