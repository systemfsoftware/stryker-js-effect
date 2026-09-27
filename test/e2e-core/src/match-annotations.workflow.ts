import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type Annotation, type MutatorTarget, type Scope, SourcedAnnotation } from './annotation.schema.js'
import { ReportMutant } from './match.schema.js'

const MatchedAnnotationTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/MatchedAnnotation')
type MatchedAnnotationTypeId = typeof MatchedAnnotationTypeId

export class MatchedAnnotation extends S.TaggedClass<MatchedAnnotation>()('MatchedAnnotation', {
  mutant: ReportMutant,
  annotation: SourcedAnnotation,
}) {
  readonly [MatchedAnnotationTypeId] = MatchedAnnotationTypeId
}

export class MatchAnnotationsCommand extends S.TaggedClass<MatchAnnotationsCommand>()('MatchAnnotationsCommand', {
  slice: S.String,
  annotations: S.Array(SourcedAnnotation),
  mutants: S.Array(ReportMutant),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class MutantUnmatched extends S.TaggedError<MutantUnmatched>()('MutantUnmatched', {
  file: S.String,
  line: S.Int,
  column: S.Int,
  mutator: S.String,
}) {
  override get message(): string {
    return `${this.file}:${this.line}:${this.column}: no annotation covers the ${this.mutator} mutant`
  }
}

export class AnnotationDangling extends S.TaggedError<AnnotationDangling>()('AnnotationDangling', {
  file: S.String,
  line: S.Int,
}) {
  override get message(): string {
    return `${this.file}:${this.line}: the annotation claims no mutant`
  }
}

export const AnnotationClaim = S.Struct({ file: S.String, line: S.Int })
export type AnnotationClaim = typeof AnnotationClaim.Type

export class MutantClaimedTwice extends S.TaggedError<MutantClaimedTwice>()('MutantClaimedTwice', {
  file: S.String,
  line: S.Int,
  column: S.Int,
  mutator: S.String,
  claimedBy: S.Array(AnnotationClaim),
}) {
  override get message(): string {
    const claims = this.claimedBy.map((claim) => `${claim.file}:${claim.line}`).join(', ')
    return `${this.file}:${this.line}:${this.column}: the ${this.mutator} mutant is claimed at one scope by ${claims}`
  }
}

export const MatchFailure = S.Union([MutantUnmatched, AnnotationDangling, MutantClaimedTwice])
export type MatchFailure = typeof MatchFailure.Type

type ClaimantVerdict = 'none' | 'one' | 'many'

interface Point {
  readonly line: number
  readonly column: number
}

interface Pair {
  readonly mutant: ReportMutant
  readonly index: number
}

const RANKS: Readonly<Record<Scope, number>> = { Line: 0, Declaration: 1, File: 2 }

const scopeRank = (scope: Scope): number => RANKS[scope]

const sliceAppliesTo = (slice: string, annotation: Annotation): boolean =>
  Option.match(Option.fromUndefinedOr(annotation.slices), {
    onNone: () => true,
    onSome: (slices) => slices.includes(slice),
  })

const targetCoversMutator = (target: MutatorTarget, mutatorName: string): boolean =>
  Match.value(target).pipe(
    Match.tag('All', () => true),
    Match.tag('Named', ({ names }) => names.some((name) => name === mutatorName)),
    Match.exhaustive,
  )

const atOrAfter = (point: Point, start: Point): boolean =>
  [point.line > start.line, Boolean.and(point.line === start.line, point.column >= start.column)].some((holds) => holds)

const atOrBefore = (point: Point, end: Point): boolean =>
  [point.line < end.line, Boolean.and(point.line === end.line, point.column <= end.column)].some((holds) => holds)

const rangeContainsPoint = (range: Mutant.Location, point: Point): boolean =>
  Boolean.and(atOrAfter(point, range.start), atOrBefore(point, range.end))

const coversMutant = (sourced: SourcedAnnotation, mutant: ReportMutant): boolean =>
  Boolean.every([
    sourced.file === mutant.file,
    targetCoversMutator(sourced.annotation.mutators, mutant.mutant.mutatorName),
    rangeContainsPoint(sourced.annotation.range, mutant.mutant.location.start),
  ])

const indexIf = (holds: boolean, index: number): ReadonlyArray<number> =>
  Boolean.match(holds, {
    onTrue: () => [index],
    onFalse: () => [],
  })

const nearestClaimants = (
  annotations: ReadonlyArray<SourcedAnnotation>,
  mutant: ReportMutant,
): ReadonlyArray<number> => {
  const claimants = annotations.flatMap((sourced, index) => indexIf(coversMutant(sourced, mutant), index))
  const nearest = Arr.head(
    Arr.sort(claimants.map((index) => scopeRank(annotations[index].annotation.scope)), Order.Number),
  )
  return Option.match(nearest, {
    onNone: () => [],
    onSome: (rank) => claimants.filter((index) => scopeRank(annotations[index].annotation.scope) === rank),
  })
}

const claimantVerdict = (claimants: ReadonlyArray<number>): ClaimantVerdict =>
  Boolean.match(claimants.length === 0, {
    onTrue: (): ClaimantVerdict => 'none',
    onFalse: () =>
      Boolean.match(claimants.length === 1, {
        onTrue: (): ClaimantVerdict => 'one',
        onFalse: (): ClaimantVerdict => 'many',
      }),
  })

const claimsOf = (
  annotations: ReadonlyArray<SourcedAnnotation>,
  claimants: ReadonlyArray<number>,
): ReadonlyArray<AnnotationClaim> =>
  claimants.map((index) => ({
    file: annotations[index].file,
    line: annotations[index].annotation.line,
  }))

const pairOf = (
  annotations: ReadonlyArray<SourcedAnnotation>,
  mutant: ReportMutant,
  claimants: ReadonlyArray<number>,
): Result.Result<Pair, MatchFailure> =>
  Match.value(claimantVerdict(claimants)).pipe(
    Match.when('none', () =>
      Result.fail(
        MutantUnmatched.make({
          file: mutant.file,
          line: mutant.mutant.location.start.line,
          column: mutant.mutant.location.start.column,
          mutator: mutant.mutant.mutatorName,
        }),
      )),
    Match.when('one', () => Result.succeed({ mutant, index: claimants[0] })),
    Match.when('many', () =>
      Result.fail(
        MutantClaimedTwice.make({
          file: mutant.file,
          line: mutant.mutant.location.start.line,
          column: mutant.mutant.location.start.column,
          mutator: mutant.mutant.mutatorName,
          claimedBy: [...claimsOf(annotations, claimants)],
        }),
      )),
    Match.exhaustive,
  )

const pairsOf = (
  annotations: ReadonlyArray<SourcedAnnotation>,
  mutants: ReadonlyArray<ReportMutant>,
): Result.Result<ReadonlyArray<Pair>, MatchFailure> =>
  mutants.reduce<Result.Result<ReadonlyArray<Pair>, MatchFailure>>(
    (accumulated, mutant) =>
      Result.flatMap(accumulated, (pairs) =>
        Result.map(pairOf(annotations, mutant, nearestClaimants(annotations, mutant)), (pair) => [...pairs, pair])),
    Result.succeed([]),
  )

const mutatedBySlice = (sourced: SourcedAnnotation, mutants: ReadonlyArray<ReportMutant>): boolean =>
  mutants.some((mutant) => mutant.file === sourced.file)

const claimedByAny = (index: number, pairs: ReadonlyArray<Pair>): boolean => pairs.some((pair) => pair.index === index)

const danglingOf = (
  annotations: ReadonlyArray<SourcedAnnotation>,
  mutants: ReadonlyArray<ReportMutant>,
  pairs: ReadonlyArray<Pair>,
): ReadonlyArray<SourcedAnnotation> =>
  annotations.filter((sourced, index) =>
    Boolean.and(mutatedBySlice(sourced, mutants), Boolean.not(claimedByAny(index, pairs)))
  )

const danglingRefusal = (
  annotations: ReadonlyArray<SourcedAnnotation>,
  mutants: ReadonlyArray<ReportMutant>,
  pairs: ReadonlyArray<Pair>,
): Result.Result<void, MatchFailure> =>
  Option.match(Arr.head(danglingOf(annotations, mutants, pairs)), {
    onNone: () => Result.succeed(undefined),
    onSome: (sourced) => Result.fail(AnnotationDangling.make({ file: sourced.file, line: sourced.annotation.line })),
  })

const decide = (command: MatchAnnotationsCommand): Result.Result<ReadonlyArray<MatchedAnnotation>, MatchFailure> => {
  const annotations = command.annotations.filter((sourced) => sliceAppliesTo(command.slice, sourced.annotation))
  return Result.flatMap(
    pairsOf(annotations, command.mutants),
    (pairs) =>
      Result.map(
        danglingRefusal(annotations, command.mutants, pairs),
        () => pairs.map((pair) => MatchedAnnotation.make({ mutant: pair.mutant, annotation: annotations[pair.index] })),
      ),
  )
}

export const matchAnnotations = Workflow.make({
  command: MatchAnnotationsCommand,
  decision: S.Array(MatchedAnnotation),
  error: MatchFailure,
  decide,
})
