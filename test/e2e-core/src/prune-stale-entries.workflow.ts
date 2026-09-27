import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class PruneStaleEntriesCommand extends S.TaggedClass<PruneStaleEntriesCommand>()('PruneStaleEntriesCommand', {
  entries: S.Array(S.String),
  keep: S.String,
  leased: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const PrunableEntryTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/PrunableEntry')
type PrunableEntryTypeId = typeof PrunableEntryTypeId

export class PrunableEntry extends S.TaggedClass<PrunableEntry>()('PrunableEntry', { name: S.String }) {
  readonly [PrunableEntryTypeId] = PrunableEntryTypeId
}

const removable = (command: PruneStaleEntriesCommand, name: string): boolean =>
  Boolean.not(Boolean.or(name === command.keep, command.leased.includes(name)))

const removableOf = (command: PruneStaleEntriesCommand): ReadonlyArray<string> =>
  command.entries.filter((name) => removable(command, name))

const decide = (command: PruneStaleEntriesCommand): Result.Result<ReadonlyArray<PrunableEntry>, never> =>
  Result.succeed(removableOf(command).map((name) => PrunableEntry.make({ name })))

export const pruneStaleEntries = Workflow.make({
  command: PruneStaleEntriesCommand,
  decision: S.Array(PrunableEntry),
  error: S.Never,
  decide,
})
