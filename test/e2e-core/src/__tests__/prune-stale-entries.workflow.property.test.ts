import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { pruneStaleEntries, PruneStaleEntriesCommand } from '../prune-stale-entries.workflow.js'

describe('pruneStaleEntries', () => {
  it.prop(
    '∀e_EntriesWithALeasedSubset_≡KeepsCurrentAndLeasedRemovesTheRest',
    { of: [S.Array(S.String), S.String, S.Array(S.Boolean)], subject: pruneStaleEntries },
    (subject, [entries, keep, leasedFlags]) => {
      const leased = entries.filter((_, index) => leasedFlags[index] === true)
      const expected = entries.filter((name) => name !== keep && !leased.includes(name))
      const decided = Result.getOrThrow(
        subject(PruneStaleEntriesCommand.make({ entries, keep, leased })),
      ).map((entry) => entry.name)
      return JSON.stringify(decided) === JSON.stringify(expected)
    },
  )
})
