import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { MutatorNameSchema } from './directives/directive.schema.js'
import { MutantNotApplied, MutantsUnapplied, type PlacerName, PlacerNameSchema } from './Instrument.schema.js'
import { MutantId } from './Mutant.schema.js'

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
  id: MutantId,
  mutatorName: MutatorNameSchema,
  replacement: ReplacementFactsSchema,
})
export type PlacedMutant = typeof PlacedMutantSchema.Type

export class PlaceMutantsCommand extends S.TaggedClass<PlaceMutantsCommand>()('PlaceMutantsCommand', {
  fileName: S.String,
  facts: PlacementFactsSchema,
  mutants: S.Array(PlacedMutantSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const PlacementDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/PlacementDecision',
)
type PlacementDecisionTypeId = typeof PlacementDecisionTypeId

export class ExpressionSite extends S.TaggedClass<ExpressionSite>()('ExpressionSite', {
  fileName: S.String,
  mutantIds: S.Array(MutantId),
}) {
  readonly [PlacementDecisionTypeId] = PlacementDecisionTypeId
}

export class StatementSite extends S.TaggedClass<StatementSite>()('StatementSite', {
  fileName: S.String,
  mutantIds: S.Array(MutantId),
}) {
  readonly [PlacementDecisionTypeId] = PlacementDecisionTypeId
}

export class SwitchCaseSite extends S.TaggedClass<SwitchCaseSite>()('SwitchCaseSite', {
  fileName: S.String,
  mutantIds: S.Array(MutantId),
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
  mutantId: MutantId,
  mutatorName: MutatorNameSchema,
  expected: ExpectedKindSchema,
}) {
  override get message(): string {
    return `Expected ${this.expected} for mutant ${this.mutantId} (${this.mutatorName}) in ${this.fileName}`
  }
}

export class NoPlacerClaimsNode extends S.TaggedError<NoPlacerClaimsNode>()('NoPlacerClaimsNode', {
  fileName: S.String,
}) {
  override get message(): string {
    return `No placer claims the node in ${this.fileName}`
  }
}

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
    Match.when(Option.isNone, () => Result.fail(NoPlacerClaimsNode.make({ fileName: command.fileName }))),
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
      MutantKindMismatch.make({
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
    Match.when('expression', () => ExpressionSite.make({ fileName: command.fileName, mutantIds })),
    Match.when('statement', () => StatementSite.make({ fileName: command.fileName, mutantIds })),
    Match.when('switch-case', () => SwitchCaseSite.make({ fileName: command.fileName, mutantIds })),
    Match.exhaustive,
  )
}

export const placeMutants = Workflow.make({
  command: PlaceMutantsCommand,
  decision: S.Union([ExpressionSite, StatementSite, SwitchCaseSite]),
  error: S.Union([MutantKindMismatch, NoPlacerClaimsNode, MutantsUnapplied, MutantNotApplied]),
  decide: (command: PlaceMutantsCommand): Result.Result<PlacementDecision, PlacementRefusal> =>
    Result.gen(function*() {
      const placer = yield* placerOf(command)
      yield* placementRefusal(command, placer)
      return siteOf(command, placer)
    }),
})
