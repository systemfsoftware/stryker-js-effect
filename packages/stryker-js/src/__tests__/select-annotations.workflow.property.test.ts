import { Mutant, type Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  AnnotationsSelected,
  NothingToAnnotate,
  selectAnnotations,
  SelectAnnotationsCommand,
  type SurvivorAnnotation,
} from '../select-annotations.workflow.js'
import { SurvivorRef } from '../surfacing.schema.js'

const isSurvivorStatus = (status: string): boolean => status === 'Survived' || status === 'NoCoverage'
type Subject = typeof selectAnnotations

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

const refsOf = (report: Report.MutationTestResult): ReadonlyArray<SurvivorRef> =>
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

const commandArb: Arbitrary.Arbitrary<SelectAnnotationsCommand> = Arbitrary.all({
  report: reportArb,
  baseline: Mutant.MutantId.pipe(S.Array, Arbitrary.schema),
}).pipe(
  Arbitrary.map(({ report, baseline }) =>
    SelectAnnotationsCommand.make({ report, survivors: refsOf(report), baseline })
  ),
)

const withBaseline = (
  command: SelectAnnotationsCommand,
  baseline: ReadonlyArray<Mutant.MutantId>,
): SelectAnnotationsCommand =>
  SelectAnnotationsCommand.make({ report: command.report, survivors: command.survivors, baseline })

const decisionOf = (subject: Subject, command: SelectAnnotationsCommand) => subject(command).pipe(Result.getOrThrow)

const annotationsOf = (subject: Subject, command: SelectAnnotationsCommand): ReadonlyArray<SurvivorAnnotation> =>
  Match.value(decisionOf(subject, command)).pipe(
    Match.tag('AnnotationsSelected', (selected): ReadonlyArray<SurvivorAnnotation> => selected.annotations),
    Match.tag('NothingToAnnotate', (): ReadonlyArray<SurvivorAnnotation> => []),
    Match.exhaustive,
  )

const everyRefOf = (report: Report.MutationTestResult): ReadonlyArray<SurvivorRef> =>
  Arr.flatMap(
    Object.entries(report.files),
    ([fileName, file]) =>
      Arr.flatMap(file.mutants, (mutant) =>
        Option.toArray(
          Option.map(S.decodeOption(Mutant.MutantId)(mutant.id), (id) => ({
            id,
            fileName,
            line: mutant.location.start.line,
          })),
        )),
  )

const mixedCommandArb: Arbitrary.Arbitrary<SelectAnnotationsCommand> = Arbitrary.all({
  report: reportArb,
  strays: Arbitrary.array(Arbitrary.schema(SurvivorRef), { maxLength: 2 }),
  mask: Arbitrary.array(Arbitrary.schema(S.Boolean), { minLength: 12, maxLength: 12 }),
  baselineStrays: Mutant.MutantId.pipe(S.Array, Arbitrary.schema),
}).pipe(
  Arbitrary.map(({ report, strays, mask, baselineStrays }) => {
    const survivors = [...everyRefOf(report), ...strays]
    const baselined = Arr.filter(survivors, (_ref, index) => mask[index % mask.length] === true)
    return SelectAnnotationsCommand.make({
      report,
      survivors,
      baseline: [...Arr.map(baselined, (ref) => ref.id), ...baselineStrays],
    })
  }),
)

const expectedAnnotationsOf = (command: SelectAnnotationsCommand): ReadonlyArray<SurvivorAnnotation> => {
  const baselined = new Set<string>(command.baseline)
  const held = new Map<string, SurvivorAnnotation>()
  for (const [fileName, file] of Object.entries(command.report.files)) {
    for (const mutant of file.mutants) {
      if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') {
        held.set(mutant.id, { fileName, status: mutant.status, mutant })
      }
    }
  }
  return command.survivors.flatMap((ref) => {
    const annotation = held.get(ref.id)
    return baselined.has(ref.id) || annotation === undefined ? [] : [annotation]
  })
}

const sameAnnotations = (left: ReadonlyArray<SurvivorAnnotation>, right: ReadonlyArray<SurvivorAnnotation>): boolean =>
  left.length === right.length &&
  left.every((annotation, index) => {
    const other = right[index]
    return other !== undefined && annotation.fileName === other.fileName && annotation.status === other.status &&
      JSON.stringify(annotation.mutant) === JSON.stringify(other.mutant)
  })

describe('selectAnnotations', () => {
  it.prop(
    '∀c_SelectAnnotationsCommand_≡NoBaselineSelectsOneAnnotationPerCommandedSurvivor',
    { of: [commandArb], subject: selectAnnotations },
    (subject, [command]) => annotationsOf(subject, withBaseline(command, [])).length === command.survivors.length,
  )

  it.prop(
    '∀c_SelectAnnotationsCommand_≡ABaselineOfEveryCommandedSurvivorAnnotatesNothing',
    { of: [commandArb], subject: selectAnnotations },
    (subject, [command]) => {
      const decision = decisionOf(
        subject,
        withBaseline(command, Arr.map(command.survivors, (ref) => ref.id)),
      )
      return S.is(NothingToAnnotate)(decision) && decision.survivorCount === command.survivors.length
    },
  )

  it.prop(
    '∀c_SelectAnnotationsCommand_≡BaselineRemovesExactlyTheNamedSurvivors',
    { of: [commandArb], subject: selectAnnotations },
    (subject, [command]) => {
      const first = Arr.head(command.survivors)
      return Option.match(first, {
        onNone: () => annotationsOf(subject, withBaseline(command, [])).length === 0,
        onSome: (ref) =>
          annotationsOf(subject, withBaseline(command, [ref.id])).length ===
            annotationsOf(subject, withBaseline(command, [])).length - 1,
      })
    },
  )

  it.prop(
    '∀c_SelectAnnotationsCommand_≡SelectsEveryUnbaselinedSurvivorTheReportHoldsInCommandOrder',
    { of: [mixedCommandArb], subject: selectAnnotations },
    (subject, [command]) => {
      const expected = expectedAnnotationsOf(command)
      const decision = decisionOf(subject, command)
      return expected.length === 0
        ? S.is(NothingToAnnotate)(decision) && decision.survivorCount === command.survivors.length
        : S.is(AnnotationsSelected)(decision) && sameAnnotations(decision.annotations, expected)
    },
  )
})
