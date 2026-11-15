import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { SurvivorRef } from './surfacing.schema.js'

const SelectAnnotationsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/SelectAnnotationsDecision')
type SelectAnnotationsTypeId = typeof SelectAnnotationsTypeId

export const SurvivorAnnotation = S.Struct({
  fileName: S.String,
  status: Mutant.SurvivorStatusSchema,
  mutant: Report.MutantResult,
})
export type SurvivorAnnotation = typeof SurvivorAnnotation.Type

export class AnnotationsSelected
  extends S.TaggedClass<AnnotationsSelected, { readonly brand: unique symbol }>()('AnnotationsSelected', {
    annotations: S.NonEmptyArray(SurvivorAnnotation),
  })
{
  readonly [SelectAnnotationsTypeId] = SelectAnnotationsTypeId
}

export class NothingToAnnotate
  extends S.TaggedClass<NothingToAnnotate, { readonly brand: unique symbol }>()('NothingToAnnotate', {
    survivorCount: S.Natural,
  })
{
  readonly [SelectAnnotationsTypeId] = SelectAnnotationsTypeId
}

export const SelectAnnotationsDecision = S.Union([AnnotationsSelected, NothingToAnnotate])
export type SelectAnnotationsDecision = typeof SelectAnnotationsDecision.Type

export class SelectAnnotationsCommand
  extends S.TaggedClass<SelectAnnotationsCommand, { readonly brand: unique symbol }>()('SelectAnnotationsCommand', {
    report: Report.MutationTestResult,
    survivors: S.Array(SurvivorRef),
    baseline: S.Array(Mutant.MutantId),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decodeSurvivorStatus = S.decodeUnknownOption(Mutant.SurvivorStatusSchema)

const annotationOf = (fileName: string, mutant: Report.MutantResult): Option.Option<SurvivorAnnotation> =>
  Option.map(decodeSurvivorStatus(mutant.status), (status): SurvivorAnnotation => ({ fileName, status, mutant }))

const annotationsByIdOf = (report: Report.MutationTestResult): HashMap.HashMap<string, SurvivorAnnotation> =>
  HashMap.fromIterable(
    Arr.flatMap(
      Object.entries(report.files),
      ([fileName, file]) =>
        Arr.flatMap(file.mutants, (mutant) =>
          Option.toArray(
            Option.map(
              annotationOf(fileName, mutant),
              (annotation): readonly [string, SurvivorAnnotation] => [mutant.id, annotation],
            ),
          )),
    ),
  )

const annotationsOf = (command: SelectAnnotationsCommand): ReadonlyArray<SurvivorAnnotation> => {
  const byId = annotationsByIdOf(command.report)
  const baseline = HashSet.fromIterable(command.baseline)
  return Arr.flatMap(
    Arr.filter(command.survivors, (ref) => !HashSet.has(baseline, ref.id)),
    (ref: SurvivorRef) => Option.toArray(HashMap.get(byId, ref.id)),
  )
}

const decide = (command: SelectAnnotationsCommand): SelectAnnotationsDecision =>
  Arr.match(annotationsOf(command), {
    onEmpty: (): SelectAnnotationsDecision => NothingToAnnotate.make({ survivorCount: Arr.length(command.survivors) }),
    onNonEmpty: (annotations): SelectAnnotationsDecision => AnnotationsSelected.make({ annotations }),
  })

export const selectAnnotations = Workflow.make({
  command: SelectAnnotationsCommand,
  decision: SelectAnnotationsDecision,
  error: S.Never,
  decide: (command): Result.Result<SelectAnnotationsDecision, never> => Result.succeed(decide(command)),
})
