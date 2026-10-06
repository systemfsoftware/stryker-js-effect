import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { selectShard, SelectShardCommand, ShardUnknown } from '../select-shard.workflow.js'

const labelOf = (shard: { readonly index: number; readonly count: number }): string => `${shard.index}/${shard.count}`

const SelectionCase = { plan: Arbitrary.schema(ShardPlan), pick: Arbitrary.schema(S.Int) }

const selectionCase = Arbitrary.map(
  Arbitrary.all(SelectionCase),
  ({ plan, pick }) => {
    const chosen = plan.shards[Math.abs(pick) % Math.max(plan.shards.length, 1)]
    return { plan, shard: chosen === undefined ? '0/0' : labelOf(chosen), expected: chosen }
  },
)

describe('selectShard', () => {
  it.prop(
    '∀plan-pick_SelectShard_≡TheMatchingPlanShardOrUnknown',
    { of: [selectionCase], subject: selectShard },
    (subject, [selection]) => {
      const command = SelectShardCommand.make({ plan: selection.plan, shard: selection.shard })
      return Result.match(subject(command), {
        onFailure: (failure) => selection.expected === undefined && S.is(ShardUnknown)(failure),
        onSuccess: (selected) =>
          selection.expected !== undefined &&
          selected.index === selection.expected.index &&
          selected.count === selection.expected.count &&
          Equal.equals(selected.projects, selection.expected.projects),
      })
    },
  )
})
