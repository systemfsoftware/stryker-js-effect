import { Mutant, type Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import type { Reports } from '@systemfsoftware/stryker-js-contracts'
import { NothingToAnnotate, renderAnnotations, RenderAnnotationsCommand } from '../render-annotations.workflow.js'

const isSurvivorStatus = (status: string): boolean => status === 'Survived' || status === 'NoCoverage'
type Subject = typeof renderAnnotations

const keyArb = Arbitrary.schema(
  S.String.check(S.isMinLength(1), S.isMaxLength(6), S.isPattern(/^[\x21-\x5B\x5D-\x7E]+(\/[\x21-\x5B\x5D-\x7E]+)*$/)),
)
const sourceArb = Arbitrary.schema(S.String.check(S.isMaxLength(32), S.isPattern(/^[\x20-\x7E\n]*$/)))

const mutantArb = (status: Arbitrary.Arbitrary<Mutant.MutantStatus>): Arbitrary.Arbitrary<Report.MutantResult> =>
  Arbitrary.all({
    id: Arbitrary.schema(Mutant.MutantId),
    mutatorName: Arbitrary.schema(Mutant.MutatorName),
    location: Arbitrary.schema(Mutant.Location),
    status,
    description: S.String.pipe(S.UndefinedOr, Arbitrary.schema),
  }).pipe(
    Arbitrary.map(({ description, ...rest }) => description === undefined ? rest : { ...rest, description }),
  )

const survivorFileArb: Arbitrary.Arbitrary<Report.FileResult> = Arbitrary.all({
  language: Arbitrary.Constant('javascript'),
  source: sourceArb,
  others: Arbitrary.array(Mutant.MutantStatusSchema.pipe(Arbitrary.schema, mutantArb), { maxLength: 2 }),
  survivor: Mutant.SurvivorStatusSchema.pipe(Arbitrary.schema, mutantArb),
}).pipe(Arbitrary.map(({ language, source, others, survivor }) => ({
  language,
  source,
  mutants: [...others, survivor],
})))

const recordOf = <A>(value: Arbitrary.Arbitrary<A>): Arbitrary.Arbitrary<Record<string, A>> =>
  Arbitrary.array(Arbitrary.all([keyArb, value]), { maxLength: 2 }).pipe(
    Arbitrary.map((entries) => Object.fromEntries(entries)),
  )

const reportArb: Arbitrary.Arbitrary<Report.MutationTestResult> = Arbitrary.all({
  key: keyArb,
  survivorFile: survivorFileArb,
  extra: recordOf(survivorFileArb),
}).pipe(
  Arbitrary.map(({ key, survivorFile, extra }) => ({
    schemaVersion: '1',
    thresholds: { high: 80, low: 60, break: null },
    files: { [key]: survivorFile, ...extra },
  })),
)

const refsOf = (report: Report.MutationTestResult): ReadonlyArray<Reports.SurvivorRef> =>
  Arr.dedupeWith(
    Arr.flatMap(
      Object.entries(report.files),
      ([fileName, file]) =>
        Arr.flatMap(file.mutants, (mutant) => {
          const id = S.decodeOption(Mutant.MutantId)(mutant.id)
          return Option.isSome(id) && isSurvivorStatus(mutant.status)
            ? [{ id: id.value, fileName, line: mutant.location.start.line }]
            : []
        }),
    ),
    (left, right) => left.id === right.id,
  )

const commandArb: Arbitrary.Arbitrary<RenderAnnotationsCommand> = Arbitrary.all({
  report: reportArb,
  baseline: Mutant.MutantId.pipe(S.Array, Arbitrary.schema),
}).pipe(
  Arbitrary.map(({ report, baseline }) =>
    RenderAnnotationsCommand.make({ report, survivors: refsOf(report), baseline })
  ),
)

const withBaseline = (
  command: RenderAnnotationsCommand,
  baseline: ReadonlyArray<Mutant.MutantId>,
): RenderAnnotationsCommand =>
  RenderAnnotationsCommand.make({ report: command.report, survivors: command.survivors, baseline })

const decisionOf = (subject: Subject, command: RenderAnnotationsCommand) => subject(command).pipe(Result.getOrThrow)

const linesOf = (subject: Subject, command: RenderAnnotationsCommand): ReadonlyArray<string> =>
  Match.value(decisionOf(subject, command)).pipe(
    Match.tag('AnnotationsRendered', (rendered) => rendered.lines),
    Match.tag('NothingToAnnotate', (): ReadonlyArray<string> => []),
    Match.exhaustive,
  )

describe('renderAnnotations', () => {
  it.prop(
    '∀c_RenderAnnotationsCommand_≡NoBaselineRendersOneAnnotationPerCommandedSurvivor',
    { of: [commandArb], subject: renderAnnotations },
    (subject, [command]) => linesOf(subject, withBaseline(command, [])).length === command.survivors.length,
  )

  it.prop(
    '∀c_RenderAnnotationsCommand_≡ABaselineOfEveryCommandedSurvivorAnnotatesNothing',
    { of: [commandArb], subject: renderAnnotations },
    (subject, [command]) => {
      const decision = decisionOf(
        subject,
        withBaseline(command, Arr.map(command.survivors, (ref) => ref.id)),
      )
      return S.is(NothingToAnnotate)(decision) && decision.survivorCount === command.survivors.length
    },
  )

  it.prop(
    '∀c_RenderAnnotationsCommand_≡BaselineRemovesExactlyTheNamedSurvivors',
    { of: [commandArb], subject: renderAnnotations },
    (subject, [command]) => {
      const first = Arr.head(command.survivors)
      return Option.match(first, {
        onNone: () => linesOf(subject, withBaseline(command, [])).length === 0,
        onSome: (ref) =>
          linesOf(subject, withBaseline(command, [ref.id])).length ===
            linesOf(subject, withBaseline(command, [])).length - 1,
      })
    },
  )
})
