import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import type { CountedReport, RunCounts } from '../audit.schema.js'
import { countRuns, CountRunsCommand } from '../count-runs.workflow.js'

type CountedMutant = CountedReport['files'][string]['mutants'][number]

const statusReasonArb: Arbitrary.Arbitrary<string> = Arbitrary.all({
  named: Arbitrary.schema(S.Boolean),
  rule: Arbitrary.schema(Mutant.IgnoreRuleId),
  free: Arbitrary.schema(S.String.check(S.isMaxLength(8))),
}).pipe(Arbitrary.map(({ named, rule, free }) => (named ? `${rule}: ${free}` : free)))

const mutantArb: Arbitrary.Arbitrary<CountedMutant> = Arbitrary.all({
  id: Arbitrary.schema(S.String.check(S.isMaxLength(4))),
  status: Arbitrary.schema(Mutant.MutantStatusSchema),
  statusReason: statusReasonArb,
  testsCompleted: Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 9 }))),
})

const reportArb: Arbitrary.Arbitrary<CountedReport> = Arbitrary.array(
  Arbitrary.array(mutantArb, { maxLength: 4 }),
  { maxLength: 3 },
).pipe(Arbitrary.map((files) => ({
  files: Object.fromEntries(files.map((mutants, index) => [`src/f${index}.ts`, { mutants }])),
})))

const commandArb: Arbitrary.Arbitrary<CountRunsCommand> = Arbitrary.array(reportArb, { minLength: 1, maxLength: 3 })
  .pipe(
    Arbitrary.map((reports) =>
      CountRunsCommand.make({ reports: reports.map((report, index) => ({ project: `p${index}`, report })) })
    ),
  )

const mutantsOf = (command: CountRunsCommand): ReadonlyArray<CountedMutant> =>
  command.reports.flatMap((entry) => Object.values(entry.report.files).flatMap((file) => file.mutants))

const sumOf = (values: ReadonlyArray<number>): number => values.reduce((sum, value) => sum + value, 0)

const statusTotal = (counts: RunCounts): number => sumOf(Object.values(counts.statuses))

const encodeIgnoreReason = S.encodeOption(Mutant.IgnoreStatusReason)

const ignoredOnceCommandOf = (statusReason: string): CountRunsCommand =>
  CountRunsCommand.make({
    reports: [{
      project: 'p0',
      report: { files: { 'src/f0.ts': { mutants: [{ id: 'm0', status: 'Ignored', statusReason }] } } },
    }],
  })

describe('countRuns', () => {
  it.prop(
    '∀c_CountRunsCommand_≡ShouldRefuseWhenNoReportRecordsAMutant',
    { of: [commandArb], subject: countRuns },
    (subject, [command]) => Result.isFailure(subject(command)) === (mutantsOf(command).length === 0),
  )

  it.prop(
    '∀c_CountRunsCommand_≡ShouldCountEveryRecordedMutantOnceWhenProjectsAreTotalled',
    { of: [commandArb], subject: countRuns },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => mutantsOf(command).length === 0,
        onSuccess: (counts) =>
          counts.total.planned === mutantsOf(command).length &&
          statusTotal(counts.total) === counts.total.planned &&
          sumOf(counts.projects.map((project) => project.counts.planned)) === counts.total.planned &&
          sumOf(counts.projects.map((project) => project.counts.testExecutions)) === counts.total.testExecutions,
      }),
  )

  it.prop(
    '∀c_CountRunsCommand_≡ShouldCountAnIgnoredMutantUnderTheRuleItsReasonNames',
    { of: [commandArb], subject: countRuns },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => true,
        onSuccess: (counts) => {
          const ignored = mutantsOf(command).filter((mutant) => mutant.status === 'Ignored')
          return counts.total.ignoredByRule.every((entry) =>
            entry.count === ignored.filter((mutant) => (mutant.statusReason ?? '').startsWith(`${entry.rule}: `)).length
          ) &&
            sumOf(counts.total.ignoredByRule.map((entry) => entry.count)) + counts.total.ignoredUnrecognized ===
              ignored.length
        },
      }),
  )

  it.prop(
    '∀r_IgnoreStatusReason_≡ShouldCountTheReasonCodeOnceWhenOneIgnoredMutantCarriesIt',
    { of: [Mutant.IgnoreStatusReason], subject: countRuns },
    (subject, [reason]) =>
      Option.match(encodeIgnoreReason(reason), {
        onNone: () => false,
        onSome: (statusReason) =>
          Result.match(subject(ignoredOnceCommandOf(statusReason)), {
            onFailure: () => false,
            onSuccess: (counts) =>
              counts.total.ignoredUnrecognized === 0 &&
              counts.total.ignoredByRule.length === 1 &&
              counts.total.ignoredByRule.every((entry) => entry.rule === reason.code && entry.count === 1),
          }),
      }),
  )
})
