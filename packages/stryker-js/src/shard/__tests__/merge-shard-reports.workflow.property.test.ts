import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  mergeShardReports,
  MergeShardReportsCommand,
  type ShardMutantVerdict,
  ShardReportOverlap,
} from '../merge-shard-reports.workflow.js'

const OVERLAPPED_ID = 'abc0123456789def'

const byId = (left: ShardMutantVerdict, right: ShardMutantVerdict): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0

const mergeCommandOf = (mutants: ReadonlyArray<ShardMutantVerdict>, second: (index: number) => boolean) => {
  const planned = mutants.map((mutant, index) => ({ mutant, onSecond: second(index) }))
  const firstIds = planned.filter((entry) => !entry.onSecond).map((entry) => entry.mutant.id)
  const secondIds = planned.filter((entry) => entry.onSecond).map((entry) => entry.mutant.id)
  return MergeShardReportsCommand.make({
    shards: [
      { index: 1, projects: [{ project: 'p', mutants: firstIds }] },
      { index: 2, projects: [{ project: 'p', mutants: secondIds }] },
    ],
    reports: [
      { shard: 1, project: 'p', mutants: mutants.filter((mutant) => firstIds.includes(mutant.id)) },
      { shard: 2, project: 'p', mutants: mutants.filter((mutant) => secondIds.includes(mutant.id)) },
    ],
  })
}

describe('mergeShardReports', () => {
  it.prop(
    '∀ms_Partition_≡MergedEqualsUnshardedVerdicts',
    {
      of: [S.Array(S.Struct({ status: Mutant.MutantStatusSchema, onSecond: S.Boolean }))],
      subject: mergeShardReports,
    },
    (subject, [entries]) => {
      const mutants = entries.map((entry, index): ShardMutantVerdict => ({ id: `m${index}`, status: entry.status }))
      const command = mergeCommandOf(mutants, (index) => entries[index]?.onSecond === true)
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (merged) => {
          const project = merged.projects.find((candidate) => candidate.project === 'p')
          if (project === undefined) {
            return false
          }
          return JSON.stringify(project.mutants) === JSON.stringify([...mutants].sort(byId))
        },
      })
    },
  )

  it.prop(
    '∀ms_RepeatedId_≡OverlapNamed',
    { of: [Mutant.MutantStatusSchema], subject: mergeShardReports },
    (subject, [status]) => {
      const mutant: ShardMutantVerdict = { id: OVERLAPPED_ID, status }
      const command = MergeShardReportsCommand.make({
        shards: [
          { index: 1, projects: [{ project: 'p', mutants: [OVERLAPPED_ID] }] },
          { index: 2, projects: [{ project: 'p', mutants: [OVERLAPPED_ID] }] },
        ],
        reports: [
          { shard: 1, project: 'p', mutants: [mutant] },
          { shard: 2, project: 'p', mutants: [mutant] },
        ],
      })
      return Result.match(subject(command), {
        onFailure: (failure) => S.is(ShardReportOverlap)(failure) && failure.mutants.includes(OVERLAPPED_ID),
        onSuccess: () => false,
      })
    },
  )
})
