import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const CheckpointRowTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/CheckpointMutantRow')
type CheckpointRowTypeId = typeof CheckpointRowTypeId

export class CheckpointSettledMutant extends S.TaggedClass<CheckpointSettledMutant>()('CheckpointSettledMutant', {
  mutant: Mutant.Mutant,
  status: Mutant.MutantStatusSchema,
  killedBy: S.String.pipe(S.Array, S.optional),
}) {
  readonly [CheckpointRowTypeId] = CheckpointRowTypeId
}

export class CheckpointPendingMutant extends S.TaggedClass<CheckpointPendingMutant>()('CheckpointPendingMutant', {
  mutant: Mutant.Mutant,
}) {
  readonly [CheckpointRowTypeId] = CheckpointRowTypeId
}

export const CheckpointMutantRow = S.Union([CheckpointSettledMutant, CheckpointPendingMutant])
export type CheckpointMutantRow = typeof CheckpointMutantRow.Type

export class CheckpointMutantsCommand extends S.TaggedClass<CheckpointMutantsCommand>()(
  'CheckpointMutantsCommand',
  {
    plannedMutants: S.Array(Mutant.Mutant),
    settled: S.Array(CheckpointSettledMutant),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const settledByIdOf = (settled: ReadonlyArray<CheckpointSettledMutant>) =>
  HashMap.fromIterable(settled.map((row) => [row.mutant.id, row] as const))

const rowOf = (
  mutant: Mutant.Mutant,
  settledById: HashMap.HashMap<Mutant.MutantId, CheckpointSettledMutant>,
): CheckpointMutantRow =>
  Option.getOrElse(HashMap.get(settledById, mutant.id), () => CheckpointPendingMutant.make({ mutant }))

const decide = (command: CheckpointMutantsCommand): Result.Result<ReadonlyArray<CheckpointMutantRow>, never> => {
  const settledById = settledByIdOf(command.settled)
  return Result.succeed(command.plannedMutants.map((mutant) => rowOf(mutant, settledById)))
}

export const checkpointMutants = Workflow.make({
  command: CheckpointMutantsCommand,
  decision: S.Array(CheckpointMutantRow),
  error: S.Never,
  decide,
})
