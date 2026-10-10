import { Mutant, type Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Function from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import type { Reports } from '@systemfsoftware/stryker-js-contracts'
import { capSurvivors, CapSurvivorsCommand } from './cap-survivors.workflow.js'
import { type RenderAnnotationsDecision } from './render-annotations.workflow.js'

const isSurvivor = (mutant: Report.MutantResult): boolean =>
  mutant.status === 'Survived' || mutant.status === 'NoCoverage'

const refOf = (fileName: string, mutant: Report.MutantResult): Option.Option<Reports.SurvivorRef> =>
  S.decodeOption(Mutant.MutantId)(mutant.id).pipe(
    Option.map((id): Reports.SurvivorRef => ({ id, fileName, line: mutant.location.start.line })),
  )

const survivorRefsOf = (report: Report.MutationTestResult): ReadonlyArray<Reports.SurvivorRef> =>
  Arr.flatMap(
    Object.entries(report.files),
    ([fileName, file]) =>
      Arr.flatMap(file.mutants, (mutant) => isSurvivor(mutant) ? Option.toArray(refOf(fileName, mutant)) : []),
  )

export const surfacedSurvivorsOf: {
  (caps: Reports.SurfacingCaps): (report: Report.MutationTestResult) => ReadonlyArray<Reports.SurvivorRef>
  (report: Report.MutationTestResult, caps: Reports.SurfacingCaps): ReadonlyArray<Reports.SurvivorRef>
} = Function.dual(
  2,
  (report: Report.MutationTestResult, caps: Reports.SurfacingCaps): ReadonlyArray<Reports.SurvivorRef> =>
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
