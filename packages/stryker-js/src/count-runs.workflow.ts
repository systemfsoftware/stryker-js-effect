import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Number from 'effect/Number'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  CountedProject,
  type CountedReport,
  CountsReport,
  NothingCounted,
  type RunCounts,
  type StatusCounts,
} from './audit.schema.js'

export class CountRunsCommand extends S.TaggedClass<CountRunsCommand>()('CountRunsCommand', {
  reports: S.Array(CountedProject),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

type CountedMutant = CountedReport['files'][string]['mutants'][number]

interface Counted {
  readonly mutant: CountedMutant
  readonly checkerMs: number
}

const decodeIgnoreReason = S.decodeOption(Mutant.IgnoreStatusReason)

const checkerMsOf = (report: CountedReport, id: string): number =>
  Option.getOrElse(
    Option.flatMap(
      Option.flatMap(Option.fromUndefinedOr(report.costs), (costs) => Record.get(costs, id)),
      (cost) => Option.fromNullOr(cost.actualMs),
    ),
    () => 0,
  )

const countedOf = (report: CountedReport): ReadonlyArray<Counted> =>
  Object.values(report.files).flatMap((file) =>
    file.mutants.map((mutant) => ({ mutant, checkerMs: checkerMsOf(report, mutant.id) }))
  )

const statusCountsOf = (mutants: ReadonlyArray<CountedMutant>): StatusCounts => {
  const count = (status: Mutant.MutantStatus): number => mutants.filter((mutant) => mutant.status === status).length
  return {
    Killed: count('Killed'),
    Survived: count('Survived'),
    NoCoverage: count('NoCoverage'),
    CompileError: count('CompileError'),
    RuntimeError: count('RuntimeError'),
    Timeout: count('Timeout'),
    Ignored: count('Ignored'),
    Pending: count('Pending'),
  }
}

const ignoreRuleOf = (mutant: CountedMutant): Option.Option<Mutant.IgnoreRuleIdValue> =>
  Option.map(Option.flatMap(Option.fromUndefinedOr(mutant.statusReason), decodeIgnoreReason), (reason) => reason.ruleId)

const runCountsOf = (reports: ReadonlyArray<CountedReport>): RunCounts => {
  const counted = reports.flatMap(countedOf)
  const mutants = counted.map((entry) => entry.mutant)
  const statuses = statusCountsOf(mutants)
  const ignoreRules = mutants.filter((mutant) => mutant.status === 'Ignored').map(ignoreRuleOf)
  const recognized = Arr.getSomes(ignoreRules)
  const planned = mutants.length
  return {
    planned,
    statuses,
    ignoredByRule: Arr.sort(
      Object.values(Arr.groupBy(recognized, (rule) => rule)).map((members) => ({
        rule: members[0],
        count: members.length,
      })),
      Order.mapInput(Order.String, (entry: { readonly rule: string }) => entry.rule),
    ),
    ignoredUnrecognized: ignoreRules.length - recognized.length,
    compileErrorShare: Boolean.match(planned === 0, {
      onTrue: () => 0,
      onFalse: () => statuses.CompileError / planned,
    }),
    compiled: planned - statuses.CompileError - statuses.Ignored - statuses.Pending,
    executed: statuses.Killed + statuses.Survived + statuses.Timeout + statuses.RuntimeError,
    testExecutions: Number.sumAll(
      mutants.map((mutant) => Option.getOrElse(Option.fromUndefinedOr(mutant.testsCompleted), () => 0)),
    ),
    compileErrorCheckerMs: Number.sumAll(
      counted.filter((entry) => entry.mutant.status === 'CompileError').map((entry) => entry.checkerMs),
    ),
  }
}

const decide = (command: CountRunsCommand): Result.Result<CountsReport, NothingCounted> => {
  const total = runCountsOf(command.reports.map((entry) => entry.report))
  return Boolean.match(total.planned === 0, {
    onTrue: () => Result.fail(NothingCounted.make({ projects: command.reports.map((entry) => entry.project) })),
    onFalse: () =>
      Result.succeed(CountsReport.make({
        schemaVersion: '1',
        projects: command.reports.map((entry) => ({ project: entry.project, counts: runCountsOf([entry.report]) })),
        total,
      })),
  })
}

export const countRuns = Workflow.make({
  command: CountRunsCommand,
  decision: CountsReport,
  error: NothingCounted,
  decide,
})
