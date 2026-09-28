import { Mutant, type Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Function from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { capSurvivors, CapSurvivorsCommand } from './cap-survivors.workflow.js'
import { type RenderAnnotationsDecision } from './render-annotations.workflow.js'
import { type SurfacingCaps, SurvivorRef } from './surfacing.schema.js'

const isSurvivor = (mutant: Report.MutantResult): boolean =>
  mutant.status === 'Survived' || mutant.status === 'NoCoverage'

const refOf = (fileName: string, mutant: Report.MutantResult): Option.Option<SurvivorRef> =>
  S.decodeOption(Mutant.MutantId)(mutant.id).pipe(
    Option.map((id): SurvivorRef => ({ id, fileName, line: mutant.location.start.line })),
  )

const survivorRefsOf = (report: Report.MutationTestResult): ReadonlyArray<SurvivorRef> =>
  Arr.flatMap(
    Object.entries(report.files),
    ([fileName, file]) =>
      Arr.flatMap(file.mutants, (mutant) => isSurvivor(mutant) ? Option.toArray(refOf(fileName, mutant)) : []),
  )

export const surfacedSurvivorsOf: {
  (caps: SurfacingCaps): (report: Report.MutationTestResult) => ReadonlyArray<SurvivorRef>
  (report: Report.MutationTestResult, caps: SurfacingCaps): ReadonlyArray<SurvivorRef>
} = Function.dual(
  2,
  (report: Report.MutationTestResult, caps: SurfacingCaps): ReadonlyArray<SurvivorRef> =>
    capSurvivors(CapSurvivorsCommand.make({ survivors: survivorRefsOf(report), caps })).pipe(
      Result.getOrThrow,
      Match.value,
      Match.tag('SurvivorsWithinCaps', (within) => within.surfaced),
      Match.tag('SurvivorsCapped', (capped) => capped.surfaced),
      Match.exhaustive,
    ),
)

export const annotationLinesOf = (decision: RenderAnnotationsDecision): ReadonlyArray<string> =>
  Match.value(decision).pipe(
    Match.tag('AnnotationsRendered', (rendered) => rendered.lines),
    Match.tag('NothingToAnnotate', (nothing): ReadonlyArray<string> => [
      `stryker annotate: no survivors to annotate (${nothing.survivorCount} survivors in the report)`,
    ]),
    Match.exhaustive,
  )
