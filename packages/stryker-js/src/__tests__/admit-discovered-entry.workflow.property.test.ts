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
        outputCaseSensitive: true,
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
        outputCaseSensitive: true,
        entryName: name,
        entryPath: name,
        isDirectory: true,
      })
      const result = subject(command)
      return Result.isSuccess(result) && S.is(EntryIgnored)(result.success)
    },
  )

  it.prop(
    '∀s_OtherCaseFile_≡OutputPatternKeepsItOnlyWhereCaseIsSensitive',
    {
      of: [Arbitrary.all({ segment: segmentArb, outputCaseSensitive: Arbitrary.schema(S.Boolean) })],
      subject: admitDiscoveredEntry,
    },
    (subject, [draw]) => {
      const otherCaseName = `${draw.segment.toUpperCase()}.ts`
      const result = subject(
        DiscoveredEntryCommand.make({
          ignorePatterns: [],
          outputPatterns: [`src/${draw.segment}.ts`],
          outputCaseSensitive: draw.outputCaseSensitive,
          entryName: otherCaseName,
          entryPath: `src/${otherCaseName}`,
          isDirectory: false,
        }),
      )
      return Result.isSuccess(result) && S.is(EntryIncluded)(result.success) === draw.outputCaseSensitive
    },
  )

  it.prop(
    '∀s_OtherCaseFile_≡IgnorePatternDropsItWhateverTheOutputCase',
    {
      of: [Arbitrary.all({ segment: segmentArb, outputCaseSensitive: Arbitrary.schema(S.Boolean) })],
      subject: admitDiscoveredEntry,
    },
    (subject, [draw]) => {
      const otherCaseName = `${draw.segment.toUpperCase()}.ts`
      const result = subject(
        DiscoveredEntryCommand.make({
          ignorePatterns: [`src/${draw.segment}.ts`],
          outputPatterns: [],
          outputCaseSensitive: draw.outputCaseSensitive,
          entryName: otherCaseName,
          entryPath: `src/${otherCaseName}`,
          isDirectory: false,
        }),
      )
      return Result.isSuccess(result) && S.is(EntryIgnored)(result.success)
    },
  )
})
