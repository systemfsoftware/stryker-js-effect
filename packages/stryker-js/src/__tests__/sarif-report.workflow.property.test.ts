import { Mutant, type Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { sarifReport, SarifReportCommand, SarifReportRendered } from '../sarif-report.workflow.js'
import type { SurvivorRef } from '../surfacing.schema.js'

const GENEROUS_BUDGET = Number.MAX_SAFE_INTEGER
type Subject = typeof sarifReport

const isSurvivorStatus = (status: string): boolean => status === 'Survived' || status === 'NoCoverage'

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

const commandArb: Arbitrary.Arbitrary<SarifReportCommand> = Arbitrary.all({
  report: reportArb,
  tool: Arbitrary.all({
    name: Arbitrary.schema(S.String),
    version: Arbitrary.schema(S.String),
    informationUri: Arbitrary.schema(S.String),
  }),
  maxResults: Arbitrary.schema(S.Natural),
}).pipe(
  Arbitrary.map(({ report, ...rest }) => SarifReportCommand.make({ report, survivors: refsOf(report), ...rest })),
)

const withBudget = (
  command: SarifReportCommand,
  survivors: ReadonlyArray<SurvivorRef>,
  maxResults: number,
): SarifReportCommand => SarifReportCommand.make({ report: command.report, survivors, tool: command.tool, maxResults })

const decisionOf = (subject: Subject, command: SarifReportCommand) => subject(command).pipe(Result.getOrThrow)

const runOf = (subject: Subject, command: SarifReportCommand) =>
  Option.getOrThrow(Arr.head(decisionOf(subject, command).log.runs))

describe('sarifReport', () => {
  it.prop(
    '∀c_SarifReportCommand_≡AGenerousBudgetEmitsOneResultPerCommandedSurvivor',
    { of: [commandArb], subject: sarifReport },
    (subject, [command]) => {
      const results = runOf(subject, withBudget(command, command.survivors, GENEROUS_BUDGET)).results
      const fingerprints = Arr.map(results, (result) => result.partialFingerprints.primaryLocationLineHash)
      return results.length === command.survivors.length &&
        new Set(fingerprints).size === results.length &&
        fingerprints.every((id) => command.survivors.some((ref) => ref.id === id))
    },
  )

  it.prop(
    '∀c_SarifReportCommand_≡EveryRuleIndexNamesTheResultsMutator',
    { of: [commandArb], subject: sarifReport },
    (subject, [command]) => {
      const run = runOf(subject, command)
      return run.results.every((result) => run.tool.driver.rules[result.ruleIndex]?.id === result.ruleId)
    },
  )

  it.prop(
    '∀c_SarifReportCommand_≡AGenerousBudgetNeverTruncates',
    { of: [commandArb], subject: sarifReport },
    (subject, [command]) =>
      S.is(SarifReportRendered)(decisionOf(subject, withBudget(command, command.survivors, GENEROUS_BUDGET))),
  )

  it.prop(
    '∀c_SarifReportCommand_≡AZeroResultBudgetEmitsNoResultAndDeclaresTheOmission',
    { of: [commandArb], subject: sarifReport },
    (subject, [command]) => {
      const decision = decisionOf(subject, withBudget(command, command.survivors, 0))
      const results = Option.getOrThrow(Arr.head(decision.log.runs)).results
      return Match.value(decision).pipe(
        Match.tag('SarifReportRendered', () => results.length === 0 && command.survivors.length === 0),
        Match.tag('SarifReportTruncated', (truncated) => results.length === 0 && truncated.omitted > 0),
        Match.exhaustive,
      )
    },
  )
})
