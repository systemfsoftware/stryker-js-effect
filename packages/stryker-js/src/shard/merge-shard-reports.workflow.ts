import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const MergeShardReportsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MergeShardReports')
type MergeShardReportsTypeId = typeof MergeShardReportsTypeId

export const ShardMutantVerdict = S.Struct({
  id: S.String,
  status: Mutant.MutantStatusSchema,
})
export type ShardMutantVerdict = typeof ShardMutantVerdict.Type

export const PlannedShardProject = S.Struct({
  project: S.String,
  mutants: S.Array(S.String),
})
export type PlannedShardProject = typeof PlannedShardProject.Type

export const PlannedShard = S.Struct({
  index: S.Int,
  projects: S.Array(PlannedShardProject),
})
export type PlannedShard = typeof PlannedShard.Type

export const ReportedShardProject = S.Struct({
  shard: S.Int,
  project: S.String,
  mutants: S.Array(ShardMutantVerdict),
})
export type ReportedShardProject = typeof ReportedShardProject.Type

export const MergedShardProject = S.Struct({
  project: S.String,
  mutants: S.Array(ShardMutantVerdict),
})
export type MergedShardProject = typeof MergedShardProject.Type

export class MergeShardReportsCommand extends S.Class<MergeShardReportsCommand>('MergeShardReportsCommand')({
  shards: S.Array(PlannedShard),
  reports: S.Array(ReportedShardProject),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class MergedShardReports extends S.TaggedClass<MergedShardReports>()('MergedShardReports', {
  projects: S.Array(MergedShardProject),
}) {
  readonly [MergeShardReportsTypeId] = MergeShardReportsTypeId
}

export class ShardReportGap extends S.TaggedError<ShardReportGap>()('ShardReportGap', {
  mutants: S.Array(S.String),
}) {
  readonly [MergeShardReportsTypeId] = MergeShardReportsTypeId

  override get message(): string {
    return `planned mutant(s) missing from the shard reports: ${this.mutants.join(', ')}`
  }
}

export class ShardReportOverlap extends S.TaggedError<ShardReportOverlap>()('ShardReportOverlap', {
  mutants: S.Array(S.String),
}) {
  readonly [MergeShardReportsTypeId] = MergeShardReportsTypeId

  override get message(): string {
    return `mutant(s) reported by more than one shard: ${this.mutants.join(', ')}`
  }
}

const ShardReportsComplete = S.TaggedStruct('ShardReportsComplete', {})

const sortedIds = (ids: Iterable<string>): readonly string[] => Arr.sort(Arr.dedupe([...ids]), Order.String)

const idOrder: Order.Order<ShardMutantVerdict> = Order.mapInput(Order.String, (mutant: ShardMutantVerdict) => mutant.id)

const mutantIdOf = (mutant: ShardMutantVerdict): string => mutant.id

const reportsOfProject = (
  command: MergeShardReportsCommand,
  project: string,
): readonly ReportedShardProject[] => command.reports.filter((report) => report.project === project)

const reportedIdsOf = (
  command: MergeShardReportsCommand,
  shard: number,
  project: string,
): readonly string[] =>
  reportsOfProject(command, project)
    .filter((report) => report.shard === shard)
    .flatMap((report) => report.mutants.map(mutantIdOf))

const plannedEntriesOf = (command: MergeShardReportsCommand) =>
  command.shards.flatMap((shard) =>
    shard.projects.map((project) => ({ shard: shard.index, project: project.project, mutants: project.mutants }))
  )

const gapIdsOf = (command: MergeShardReportsCommand): readonly string[] =>
  sortedIds(
    plannedEntriesOf(command).flatMap((entry) =>
      entry.mutants.filter((id) => !Arr.contains(reportedIdsOf(command, entry.shard, entry.project), id))
    ),
  )

const occurrencesOf = (command: MergeShardReportsCommand, project: string, id: string): number =>
  reportsOfProject(command, project).filter((report) => Arr.some(report.mutants, (mutant) => mutant.id === id)).length

const overlapIdsOf = (command: MergeShardReportsCommand): readonly string[] =>
  sortedIds(
    command.reports
      .flatMap((report) => report.mutants.map((mutant) => ({ project: report.project, id: mutant.id })))
      .filter((entry) => occurrencesOf(command, entry.project, entry.id) > 1)
      .map((entry) => entry.id),
  )

const byIdOf = (
  command: MergeShardReportsCommand,
  project: string,
): Record<string, ShardMutantVerdict> =>
  Arr.reduce(
    reportsOfProject(command, project).flatMap((report) => report.mutants),
    Record.empty<string, ShardMutantVerdict>(),
    (byId, mutant) => Record.set(byId, mutant.id, mutant),
  )

const mergedProjectsOf = (command: MergeShardReportsCommand): readonly MergedShardProject[] =>
  Arr.dedupe(command.shards.flatMap((shard) => shard.projects.map((project) => project.project))).map((project) => ({
    project,
    mutants: Arr.sort(Record.values(byIdOf(command, project)), idOrder),
  }))

const Completeness = S.Union([ShardReportOverlap, ShardReportGap, ShardReportsComplete])

const completenessOf = (command: MergeShardReportsCommand): S.Schema.Type<typeof Completeness> =>
  Option.match(Option.liftPredicate(overlapIdsOf(command), (ids) => ids.length > 0), {
    onSome: (mutants) => ShardReportOverlap.make({ mutants }),
    onNone: () =>
      Option.match(Option.liftPredicate(gapIdsOf(command), (ids) => ids.length > 0), {
        onSome: (mutants) => ShardReportGap.make({ mutants }),
        onNone: () => ShardReportsComplete.make({}),
      }),
  })

export const mergeShardReports = Workflow.make({
  command: MergeShardReportsCommand,
  decision: MergedShardReports,
  error: S.Union([ShardReportGap, ShardReportOverlap]),
  decide: (
    command: MergeShardReportsCommand,
  ): Result.Result<MergedShardReports, ShardReportGap | ShardReportOverlap> =>
    Match.value(completenessOf(command)).pipe(
      Match.tag('ShardReportOverlap', (overlap) => Result.fail(overlap)),
      Match.tag('ShardReportGap', (gap) => Result.fail(gap)),
      Match.tag(
        'ShardReportsComplete',
        () => Result.succeed(MergedShardReports.make({ projects: mergedProjectsOf(command) })),
      ),
      Match.exhaustive,
    ),
})
