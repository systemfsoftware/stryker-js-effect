import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitDiscoveredEntry,
  DiscoveredEntryCommand,
  EntryIgnored,
  EntryIncluded,
} from '../admit-discovered-entry.workflow.js'

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
        outputPatterns: [],
        entryName: `${draw.segment}.ts`,
        entryPath: `src/${draw.segment}.ts`,
        isDirectory: false,
      })
      const result = subject(command)
      return Result.isSuccess(result) && S.is(EntryIgnored)(result.success) === draw.matching
    },
  )

  it.prop(
    '∀d_Directory_≡MatchingDirectoryPatternExcludes',
    { of: [segmentArb], subject: admitDiscoveredEntry },
    (subject, [name]) => {
      const command = DiscoveredEntryCommand.make({
        ignorePatterns: [name],
        outputPatterns: [],
        entryName: name,
        entryPath: name,
        isDirectory: true,
      })
      const result = subject(command)
      return Result.isSuccess(result) && S.is(EntryIgnored)(result.success)
    },
  )

  it.prop(
    '∀s_OtherCaseFile_≡OutputPatternKeepsItAndIgnorePatternDropsIt',
    { of: [segmentArb], subject: admitDiscoveredEntry },
    (subject, [segment]) => {
      const otherCase = `src/${segment.toUpperCase()}.ts`
      const decisionOf = (patterns: { ignorePatterns: string[]; outputPatterns: string[] }) =>
        subject(
          DiscoveredEntryCommand.make({ ...patterns, entryName: otherCase, entryPath: otherCase, isDirectory: false }),
        )
      const kept = decisionOf({ ignorePatterns: [], outputPatterns: [`src/${segment}.ts`] })
      const dropped = decisionOf({ ignorePatterns: [`src/${segment}.ts`], outputPatterns: [] })
      return Result.isSuccess(kept) && S.is(EntryIncluded)(kept.success) && Result.isSuccess(dropped) &&
        S.is(EntryIgnored)(dropped.success)
    },
  )
})
