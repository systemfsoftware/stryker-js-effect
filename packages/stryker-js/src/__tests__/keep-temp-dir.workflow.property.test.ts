import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { keepTempDir, KeepTempDirCommand, type KeepTempDirOutcome } from '../keep-temp-dir.workflow.js'

const removed = (decision: KeepTempDirOutcome): boolean =>
  Match.value(decision).pipe(
    Match.tag('TempDirKept', () => false),
    Match.tag('TempDirRemoved', () => true),
    Match.exhaustive,
  )

describe('keepTempDir', () => {
  it.prop(
    '∀c_KeepTempDir_⊨CleanTempDirContract',
    { of: [KeepTempDirCommand], subject: keepTempDir },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          removed(decision) ===
            (command.cleanTempDir === 'always' || (command.cleanTempDir === true && !command.failed)),
      }),
  )
})
