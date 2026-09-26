import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { admitDiscoveredEntry, DiscoveredEntryCommand, EntryIgnored } from '../admit-discovered-entry.workflow.js'

const segmentArb = Arbitrary.schema(S.String.check(S.isPattern(/^[a-z][a-z0-9]{0,4}$/)))

const NON_MATCHING_PATTERN = 'zzz/never/**'

describe('admitDiscoveredEntry', () => {
  it.prop(
    '∀fm_FileAndPattern_≡MatchingPatternExcludesAndNonMatchingDoesNot',
    {
      of: [Arbitrary.all({ segment: segmentArb, matching: Arbitrary.schema(S.Boolean) })],
      subject: admitDiscoveredEntry,
    },
    (subject, [draw]) => {
      const command = DiscoveredEntryCommand.make({
        ignorePatterns: [draw.matching ? `${draw.segment}.ts` : NON_MATCHING_PATTERN],
        entryName: `${draw.segment}.ts`,
        entryPath: `src/${draw.segment}.ts`,
        isDirectory: false,
      })
      const result = subject(command)
      return Result.isSuccess(result) && S.is(EntryIgnored)(result.success) === draw.matching
    },
  )

  it.prop(
    '∀d_Directory_≡ExcludedDirectoryPatternExcludes',
    {
      of: [Arbitrary.schema(S.Literals(['node_modules', 'dist', '.git', '.stryker-tmp', '.cache']))],
      subject: admitDiscoveredEntry,
    },
    (subject, [name]) => {
      const command = DiscoveredEntryCommand.make({
        ignorePatterns: [name],
        entryName: name,
        entryPath: name,
        isDirectory: true,
      })
      const result = subject(command)
      return Result.isSuccess(result) && S.is(EntryIgnored)(result.success)
    },
  )
})
