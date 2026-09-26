import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { admitFileMatch, FileMatchCommand, FileMatched } from '../admit-file-match.workflow.js'

const matched = (result: ReturnType<typeof admitFileMatch>): boolean =>
  Result.isSuccess(result) && S.is(FileMatched)(result.success)

const hiddenSegment = (fileName: string): boolean => fileName.split('/').some((segment) => segment.startsWith('.'))

describe('admitFileMatch', () => {
  it.prop(
    '∀c_Echo_≡DecisionCarriesTheCommandFileName',
    { of: [FileMatchCommand], subject: admitFileMatch },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) => decision.resolvedFileName === command.resolvedFileName,
      }),
  )

  it.prop(
    '∀c_Refusal_≡NonStringPatternNeverMatches',
    { of: [FileMatchCommand], subject: admitFileMatch },
    (subject, [command]) => typeof command.resolvedPattern === 'string' || !matched(subject(command)),
  )

  it.prop(
    '∀c_Refusal_≡HiddenSegmentRefusedUnlessAllowed',
    { of: [FileMatchCommand], subject: admitFileMatch },
    (subject, [command]) =>
      !hiddenSegment(command.resolvedFileName) || command.allowHiddenFiles || !matched(subject(command)),
  )
})
