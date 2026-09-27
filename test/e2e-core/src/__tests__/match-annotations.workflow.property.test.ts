import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  AllMutators,
  Annotation,
  AnnotationStatusOutcome,
  type MutatorTarget,
  NamedMutators,
  type Scope,
  SourcedAnnotation,
} from '../annotation.schema.js'
import {
  AnnotationDangling,
  matchAnnotations,
  MatchAnnotationsCommand,
  MutantClaimedTwice,
  MutantUnmatched,
} from '../match-annotations.workflow.js'
import type { ReportMutant } from '../match.schema.js'

const FILE = 'src/subject.ts'
const APPLIES_EVERYWHERE = 'calc'

const WIDE_RANGE: Mutant.Location = { start: { line: 1, column: 1 }, end: { line: 100, column: 1 } }

const NARROW_RANGE: Mutant.Location = { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }

const sourcedAnnotationOf = (
  scope: Scope,
  mutators: MutatorTarget,
  range: Mutant.Location,
  line: number,
  slices?: ReadonlyArray<string>,
): SourcedAnnotation => ({
  file: FILE,
  annotation: Annotation.make({
    line,
    scope,
    range,
    outcome: AnnotationStatusOutcome.make({ status: 'Killed' }),
    mutators,
    ...(slices === undefined ? {} : { slices }),
  }),
})

const mutantOf = (
  line: number,
  column: number,
  mutatorName: string,
  status: Mutant.MutantStatus,
): ReportMutant => ({
  file: FILE,
  mutant: {
    id: `${line}:${column}`,
    mutatorName,
    location: { start: { line, column }, end: { line, column: column + 1 } },
    status,
  },
})

const commandOf = (
  annotations: ReadonlyArray<SourcedAnnotation>,
  mutants: ReadonlyArray<ReportMutant>,
  slice: string = APPLIES_EVERYWHERE,
) => MatchAnnotationsCommand.make({ slice, annotations: [...annotations], mutants: [...mutants] })

const outsideRangeArb = Arbitrary.filter(
  Arbitrary.schema(S.Int),
  (line) => line >= 1 && (line < 10 || line > 12),
)

describe('matchAnnotations', () => {
  it.prop(
    '∀n_MutantCoveredByOneAnnotation_≡MatchedToIt',
    { of: [Mutant.MutatorName, Mutant.MutantStatusSchema], subject: matchAnnotations },
    (subject, [mutatorName, status]) => {
      const range: Mutant.Location = { start: { line: 10, column: 1 }, end: { line: 12, column: 10 } }
      const annotation = sourcedAnnotationOf('Declaration', NamedMutators.make({ names: [mutatorName] }), range, 9)
      const mutant = mutantOf(11, 5, mutatorName, status)
      return Result.match(subject(commandOf([annotation], [mutant])), {
        onFailure: () => false,
        onSuccess: (matches) =>
          matches.length === 1 && Equal.equals(matches[0].mutant, mutant) &&
          Equal.equals(matches[0].annotation, annotation),
      })
    },
  )

  it.prop(
    '∀n_MutantOutsideEveryRange_≡RefusedNamingTheMutant',
    { of: [outsideRangeArb, Mutant.MutatorName, Mutant.MutantStatusSchema], subject: matchAnnotations },
    (subject, [line, mutatorName, status]) => {
      const annotation = sourcedAnnotationOf('Declaration', AllMutators.make({}), {
        start: { line: 10, column: 1 },
        end: { line: 12, column: 10 },
      }, 9)
      const mutant = mutantOf(line, 1, mutatorName, status)
      return Result.match(subject(commandOf([annotation], [mutant])), {
        onFailure: (failure) =>
          S.is(MutantUnmatched)(failure) &&
          failure.file === FILE &&
          failure.line === line &&
          failure.column === 1 &&
          failure.mutator === mutatorName,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀n_AnnotationOverNoMutant_≡RefusedAsDangling',
    { of: [Mutant.MutatorName, Mutant.MutatorName, Mutant.MutantStatusSchema], subject: matchAnnotations },
    (subject, [annotatedName, mutantName, status]) => {
      if (annotatedName === mutantName) {
        return true
      }
      const covering = sourcedAnnotationOf('Line', NamedMutators.make({ names: [mutantName] }), NARROW_RANGE, 1)
      const dangling = sourcedAnnotationOf('Declaration', NamedMutators.make({ names: [annotatedName] }), {
        start: { line: 5, column: 1 },
        end: { line: 5, column: 2 },
      }, 4)
      const mutant = mutantOf(1, 1, mutantName, status)
      return Result.match(subject(commandOf([covering, dangling], [mutant])), {
        onFailure: (failure) => S.is(AnnotationDangling)(failure) && failure.file === FILE && failure.line === 4,
        onSuccess: () => false,
      })
    },
  )

  it.prop(
    '∀s_SliceQualifiedAnnotation_≡AppliesOnlyToItsSlices',
    { of: [Mutant.MutatorName, Mutant.MutatorName, Mutant.MutantStatusSchema], subject: matchAnnotations },
    (subject, [slice, mutatorName, status]) => {
      if (slice.length === 0 || slice === APPLIES_EVERYWHERE) {
        return true
      }
      const annotation = sourcedAnnotationOf('Declaration', AllMutators.make({}), WIDE_RANGE, 1, [slice])
      const mutant = mutantOf(1, 1, mutatorName, status)
      const applied = subject(commandOf([annotation], [mutant], slice))
      const elsewhere = subject(commandOf([annotation], [mutant], `${slice}-other`))
      return Result.match(applied, {
        onFailure: () => false,
        onSuccess: (matches) =>
          matches.length === 1 &&
          Result.match(elsewhere, {
            onFailure: (failure) => S.is(MutantUnmatched)(failure) && failure.mutator === mutatorName,
            onSuccess: () => false,
          }),
      })
    },
  )

  it.prop(
    '∀n_NearestScope_≡LineBeatsDeclarationBeatsFile',
    {
      of: [Mutant.MutatorName, Mutant.MutatorName, Mutant.MutatorName, Mutant.MutantStatusSchema],
      subject: matchAnnotations,
    },
    (subject, [lineName, declarationName, fileName, status]) => {
      const annotations = [
        sourcedAnnotationOf('Line', AllMutators.make({}), {
          start: { line: 2, column: 1 },
          end: { line: 2, column: 3 },
        }, 1),
        sourcedAnnotationOf('Declaration', AllMutators.make({}), {
          start: { line: 2, column: 1 },
          end: { line: 4, column: 5 },
        }, 1),
        sourcedAnnotationOf('File', AllMutators.make({}), {
          start: { line: 1, column: 1 },
          end: { line: 20, column: 1 },
        }, 1),
      ]
      const mutants = [
        mutantOf(2, 1, lineName, status),
        mutantOf(3, 1, declarationName, status),
        mutantOf(5, 1, fileName, status),
      ]
      return Result.match(subject(commandOf(annotations, mutants)), {
        onFailure: () => false,
        onSuccess: (matches) =>
          matches.length === 3 &&
          Equal.equals(matches.map((match) => match.annotation.annotation.scope), ['Line', 'Declaration', 'File']),
      })
    },
  )

  it.prop(
    '∀n_TwoAnnotationsAtOneScope_≡RefusedNamingBoth',
    { of: [Mutant.MutatorName, Mutant.MutantStatusSchema], subject: matchAnnotations },
    (subject, [mutatorName, status]) => {
      const range: Mutant.Location = { start: { line: 3, column: 1 }, end: { line: 3, column: 4 } }
      const annotations = [
        sourcedAnnotationOf('Line', AllMutators.make({}), range, 1),
        sourcedAnnotationOf('Line', AllMutators.make({}), range, 2),
      ]
      const mutant = mutantOf(3, 1, mutatorName, status)
      return Result.match(subject(commandOf(annotations, [mutant])), {
        onFailure: (failure) =>
          S.is(MutantClaimedTwice)(failure) &&
          failure.mutator === mutatorName &&
          Equal.equals(failure.claimedBy.map((claim) => claim.line), [1, 2]),
        onSuccess: () => false,
      })
    },
  )
})
