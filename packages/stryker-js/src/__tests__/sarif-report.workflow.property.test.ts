import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, type Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  FailureReportSource,
  SarifFailureReportRendered,
  sarifReport,
  SarifReportCommand,
  type SarifReportDecision,
  SarifReportRendered,
  SurvivorsReportSource,
} from '../sarif-report.workflow.js'
import type { SurvivorRef } from '../surfacing.schema.js'

const GENEROUS_BUDGET = Number.MAX_SAFE_INTEGER
const TEST_TOOL = { name: 'StrykerJS', version: '0.0.0', informationUri: 'https://stryker-mutator.io' } as const
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
  maxResults: Arbitrary.schema(S.Natural),
}).pipe(
  Arbitrary.map(({ report, maxResults }) =>
    SarifReportCommand.make({
      source: SurvivorsReportSource.make({ report, survivors: refsOf(report), maxResults }),
      tool: TEST_TOOL,
    })
  ),
)

const withBudget = (
  command: SarifReportCommand,
  survivors: ReadonlyArray<SurvivorRef>,
  maxResults: number,
): SarifReportCommand => {
  const source = command.source
  return SarifReportCommand.make({
    source: S.is(SurvivorsReportSource)(source)
      ? SurvivorsReportSource.make({ report: source.report, survivors, maxResults })
      : source,
    tool: command.tool,
  })
}

const survivorsOf = (command: SarifReportCommand): ReadonlyArray<SurvivorRef> =>
  S.is(SurvivorsReportSource)(command.source) ? [...command.source.survivors] : []

const decisionOf = (subject: Subject, command: SarifReportCommand) => subject(command).pipe(Result.getOrThrow)

const runOf = (subject: Subject, command: SarifReportCommand) =>
  Option.getOrThrow(Arr.head(decisionOf(subject, command).log.runs))

const failureDecisionOf = (source: FailureReportSource): SarifReportDecision =>
  sarifReport(SarifReportCommand.make({ source, tool: TEST_TOOL })).pipe(Result.getOrThrow)

const failureRunOf = (decision: SarifReportDecision) =>
  Option.getOrThrow(
    Arr.head(Option.getOrThrow(Option.liftPredicate(decision, S.is(SarifFailureReportRendered))).log.runs),
  )

const failureCodeOf = (record: FailureRecord.FailureRecord): FailureRecord.FailureCode =>
  Option.getOrThrow(Arr.findFirst(FailureRecord.FailureCode.literals, (code) => Predicate.isTagged(record, code)))

const recordLocationsOf = (record: FailureRecord.FailureRecord): ReadonlyArray<FailureRecord.SourceLocation> =>
  Match.value(record).pipe(
    Match.tag(
      'BaselineTestsFailed',
      (evidence) => Arr.flatMap(evidence.tests, (test) => Option.toArray(Option.fromNullishOr(test.location))),
    ),
    Match.orElse((): ReadonlyArray<FailureRecord.SourceLocation> => []),
  )

describe('sarifReport', () => {
  it.prop(
    '∀c_SarifReportCommand_≡AGenerousBudgetEmitsOneResultPerCommandedSurvivor',
    { of: [commandArb], subject: sarifReport },
    (subject, [command]) => {
      const survivors = survivorsOf(command)
      const results = runOf(subject, withBudget(command, survivors, GENEROUS_BUDGET)).results
      const fingerprints = Arr.map(results, (result) => result.partialFingerprints.primaryLocationLineHash)
      return results.length === survivors.length &&
        new Set(fingerprints).size === results.length &&
        fingerprints.every((id) => survivors.some((ref) => ref.id === id))
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
      S.is(SarifReportRendered)(decisionOf(subject, withBudget(command, survivorsOf(command), GENEROUS_BUDGET))),
  )

  it.prop(
    '∀c_SarifReportCommand_≡AZeroResultBudgetEmitsNoResultAndDeclaresTheOmission',
    { of: [commandArb], subject: sarifReport },
    (subject, [command]) => {
      const decision = decisionOf(subject, withBudget(command, survivorsOf(command), 0))
      const results = Option.getOrThrow(Arr.head(decision.log.runs)).results
      return Match.value(decision).pipe(
        Match.tag('SarifReportRendered', () => results.length === 0 && survivorsOf(command).length === 0),
        Match.tag('SarifReportTruncated', (truncated) => results.length === 0 && truncated.omitted > 0),
        Match.tag('SarifFailureReportRendered', () => false),
        Match.exhaustive,
      )
    },
  )
})

describe('sarifReport failure notifications', () => {
  it.prop(
    '∀s_FailureReportSource_≡AFailedInvocationNotifiesOncePerRecord',
    { of: [FailureReportSource], subject: failureDecisionOf },
    (subject, [source]) => {
      const invocation = Option.getOrThrow(Arr.head(failureRunOf(subject(source)).invocations))
      return invocation.exitCode === source.exitCode &&
        invocation.toolExecutionNotifications.length === source.records.length &&
        Arr.every(
          Arr.zip(source.records, invocation.toolExecutionNotifications),
          ([record, notification]) =>
            notification.descriptor.id === failureCodeOf(record) &&
            notification.message.text === FailureRecord.sarifTextOf(record),
        )
    },
  )

  it.prop(
    '∀s_FailureReportSource_≡OnlyLocatedBaselineTestsCarryAPhysicalLocation',
    { of: [FailureReportSource], subject: failureDecisionOf },
    (subject, [source]) => {
      const notifications = Option.getOrThrow(Arr.head(failureRunOf(subject(source)).invocations))
        .toolExecutionNotifications
      return notifications.length === source.records.length &&
        Arr.every(Arr.zip(source.records, notifications), ([record, notification]) => {
          const expected = recordLocationsOf(record)
          return notification.locations.length === expected.length &&
            Arr.every(
              Arr.zip(expected, notification.locations),
              ([location, projected]) =>
                decodeURIComponent(projected.physicalLocation.artifactLocation.uri) === location.file.toWellFormed() &&
                projected.physicalLocation.region.startLine === location.line &&
                projected.physicalLocation.region.startColumn === location.column,
            )
        })
    },
  )
})
