import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { Position } from './Location.schema.js'

import { type LocatedDirective, LocatedDirectiveSchema, type UnusedDirective } from './directives/directive.schema.js'
import { NodePositionSchema, SourceLineSchema } from './Instrument.schema.js'

const LocationSchema = S.Struct({ start: NodePositionSchema, end: NodePositionSchema })

const WILDCARD = 'all'
const NEXT_LINE = 'next-line'

export const MutantCandidateSchema = S.Struct({
  mutatorName: S.String,
  replacementCode: S.String,
  location: S.optional(LocationSchema),
  ignorerReason: S.optional(S.String),
})
export type MutantCandidate = typeof MutantCandidateSchema.Type

const PlannedMutantSchema = S.Struct({
  id: S.String,
  mutatorName: S.String,
  replacementCode: S.String,
  location: LocationSchema,
  ignoreReason: S.optional(S.String),
})
export type PlannedMutant = typeof PlannedMutantSchema.Type

const MutantCounterSchema = S.Int.pipe(S.check(S.isBetween({ minimum: 0, maximum: 1_000_000 })))
const MutantCountSchema = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))

export class PlanMutantsCommand extends S.TaggedClass<PlanMutantsCommand>()('PlanMutantsCommand', {
  fileName: S.String,
  firstIndex: MutantCounterSchema,
  offset: NodePositionSchema,
  line: SourceLineSchema,
  mutatorNames: S.Array(S.String),
  excludedMutations: S.Array(S.String),
  rule: S.Array(LocatedDirectiveSchema),
  directives: S.Array(LocatedDirectiveSchema),
  candidates: S.Array(MutantCandidateSchema),
}) {}

const MutantPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-instrumenter/MutantPlan')
type MutantPlanTypeId = typeof MutantPlanTypeId

export class MutantsPlanned extends S.TaggedClass<MutantsPlanned>()('MutantsPlanned', {
  mutants: S.Array(PlannedMutantSchema),
  placeable: S.Array(PlannedMutantSchema),
  warnings: S.Array(S.String),
  nextIndex: MutantCountSchema,
}) {
  readonly [MutantPlanTypeId] = MutantPlanTypeId
}

export class MutantsFullyIgnored extends S.TaggedClass<MutantsFullyIgnored>()('MutantsFullyIgnored', {
  mutants: S.Array(PlannedMutantSchema),
  warnings: S.Array(S.String),
  nextIndex: MutantCountSchema,
}) {
  readonly [MutantPlanTypeId] = MutantPlanTypeId
}

export type MutantPlan = MutantsPlanned | MutantsFullyIgnored

export class MutantWithoutLocation extends S.TaggedError<MutantWithoutLocation>()('MutantWithoutLocation', {
  fileName: S.String,
  mutatorName: S.String,
}) {}

export type PlanFailure = MutantWithoutLocation

const reachedLine = (located: LocatedDirective, line: number): boolean =>
  Match.value(located.directive.scope).pipe(
    Match.when(NEXT_LINE, () => located.governedLine === line),
    Match.when('block', () => true),
    Match.exhaustive,
  )

const namesMutator = (located: LocatedDirective, lowerMutatorName: string): boolean =>
  located.directive.mutatorNames.some((name) =>
    [name === WILDCARD, name.toLowerCase() === lowerMutatorName].some(Boolean)
  )

const lastReachingDirective = (
  rule: readonly LocatedDirective[],
  lowerMutatorName: string,
  line: number,
): Option.Option<LocatedDirective> =>
  Option.fromNullishOr(
    [...rule].reverse().find((located) =>
      [reachedLine(located, line), namesMutator(located, lowerMutatorName)].every(Boolean)
    ),
  )

const directiveReason = (
  rule: readonly LocatedDirective[],
  mutatorName: string,
  line: number,
): Option.Option<string> =>
  Option.flatMap(
    lastReachingDirective(rule, mutatorName.toLowerCase(), line),
    (located) =>
      Match.value(located.directive.action).pipe(
        Match.when('disable', () => Option.some(located.directive.reason)),
        Match.when('restore', () => Option.none<string>()),
        Match.exhaustive,
      ),
  )

const exclusionReason = (
  excludedMutations: readonly string[],
  mutatorName: string,
): Option.Option<string> =>
  Match.value(excludedMutations.includes(mutatorName)).pipe(
    Match.when(true, () => Option.some(`Ignored because of excluded mutation "${mutatorName}"`)),
    Match.when(false, () => Option.none<string>()),
    Match.exhaustive,
  )

const ignoreReasonOf = (command: PlanMutantsCommand, candidate: MutantCandidate): string | undefined =>
  Option.getOrUndefined(
    Option.orElse(
      Option.orElse(
        directiveReason(command.rule, candidate.mutatorName, command.line),
        () => exclusionReason(command.excludedMutations, candidate.mutatorName),
      ),
      () => Option.fromNullishOr(candidate.ignorerReason),
    ),
  )

const unusedDirectives = (
  directives: readonly LocatedDirective[],
  mutatorNames: readonly string[],
): readonly UnusedDirective[] =>
  directives.flatMap((located) =>
    located.directive.mutatorNames
      .filter((mutatorName) => mutatorName !== WILDCARD)
      .filter((mutatorName) => !mutatorNames.includes(mutatorName.toLowerCase()))
      .map((mutatorName): UnusedDirective => ({
        directive: located.directive,
        at: located.at,
        mutatorName,
      }))
  )

const unusedDirectiveWarning = (unused: UnusedDirective, fileName: string): string => {
  const label = Match.value(unused.directive.scope).pipe(
    Match.when(NEXT_LINE, () => `${unused.directive.action} ${NEXT_LINE}`),
    Match.when('block', () => unused.directive.action),
    Match.exhaustive,
  )
  return `Unused 'Stryker ${label}' directive. Mutator with name '${unused.mutatorName}' not found. ` +
    `Directive found at: ${fileName}:${unused.at.line}:${unused.at.column}.`
}

const warningsOf = (command: PlanMutantsCommand): readonly string[] =>
  unusedDirectives(command.directives, command.mutatorNames)
    .map((unused) => unusedDirectiveWarning(unused, command.fileName))

const columnOffsetOf = (source: Position, offset: Position): number =>
  Match.value(source.line === 1).pipe(
    Match.when(true, () => offset.column),
    Match.when(false, () => 0),
    Match.exhaustive,
  )

const shiftedPosition = (source: Position, offset: Position): Position => ({
  column: source.column + columnOffsetOf(source, offset),
  line: source.line + offset.line - 1,
})

const shiftedLocation = (
  location: typeof LocationSchema.Type,
  offset: Position,
): typeof LocationSchema.Type => ({
  start: shiftedPosition(location.start, offset),
  end: shiftedPosition(location.end, offset),
})

const plannedMutant = (
  command: PlanMutantsCommand,
  candidate: MutantCandidate,
  index: number,
): Result.Result<PlannedMutant, MutantWithoutLocation> =>
  Option.match(Option.fromNullishOr(candidate.location), {
    onNone: () =>
      Result.fail(MutantWithoutLocation.make({ fileName: command.fileName, mutatorName: candidate.mutatorName })),
    onSome: (location) =>
      Result.succeed({
        id: `${command.firstIndex + index}`,
        mutatorName: candidate.mutatorName,
        replacementCode: candidate.replacementCode,
        location: shiftedLocation(location, command.offset),
        ignoreReason: ignoreReasonOf(command, candidate),
      }),
  })

const plannedMutants = (
  command: PlanMutantsCommand,
): Result.Result<readonly PlannedMutant[], MutantWithoutLocation> =>
  command.candidates.reduce<Result.Result<readonly PlannedMutant[], MutantWithoutLocation>>(
    (accumulated, candidate, index) =>
      Result.flatMap(
        accumulated,
        (mutants) => Result.map(plannedMutant(command, candidate, index), (mutant) => [...mutants, mutant]),
      ),
    Result.succeed([]),
  )

const withoutReason = (mutant: PlannedMutant): boolean => mutant.ignoreReason === undefined

const planOf = (command: PlanMutantsCommand, mutants: readonly PlannedMutant[]): MutantPlan =>
  Match.value(mutants.some(withoutReason)).pipe(
    Match.when(true, () =>
      MutantsPlanned.make({
        mutants: [...mutants],
        placeable: mutants.filter(withoutReason),
        warnings: warningsOf(command),
        nextIndex: command.firstIndex + mutants.length,
      })),
    Match.when(false, () =>
      MutantsFullyIgnored.make({
        mutants: [...mutants],
        warnings: warningsOf(command),
        nextIndex: command.firstIndex + mutants.length,
      })),
    Match.exhaustive,
  )

export const planMutants = Workflow.make(
  PlanMutantsCommand,
  (command: PlanMutantsCommand): Result.Result<MutantPlan, PlanFailure> =>
    Result.gen(function*() {
      const mutants = yield* plannedMutants(command)
      return planOf(command, mutants)
    }),
)
