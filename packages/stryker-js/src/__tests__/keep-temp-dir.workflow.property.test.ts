import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import {
  keepTempDir,
  KeepTempDirAlways,
  KeepTempDirCommand,
  KeepTempDirOnFailure,
  type KeepTempDirOutcome,
} from '../keep-temp-dir.workflow.js'

const fateOf = (decision: KeepTempDirOutcome): 'kept' | 'removed' =>
  Match.value(decision).pipe(
    Match.tag('TempDirKept', () => 'kept' as const),
    Match.tag('TempDirRemoved', () => 'removed' as const),
    Match.exhaustive,
  )

describe('keepTempDir', () => {
  it.prop(
    '∀a_Always_≡Removed',
    { of: [KeepTempDirCommand], subject: keepTempDir },
    (subject, [command]) => {
      const always = KeepTempDirCommand.make({ cleanTempDir: KeepTempDirAlways.make({}), failed: command.failed })
      return Result.match(subject(always), {
        onFailure: () => false,
        onSuccess: (decision) => fateOf(decision) === 'removed',
      })
    },
  )

  it.prop(
    '∀f_OnFailure_≡KeptIffFailed',
    { of: [KeepTempDirCommand], subject: keepTempDir },
    (subject, [command]) => {
      const onFailure = KeepTempDirCommand.make({
        cleanTempDir: KeepTempDirOnFailure.make({ failed: command.failed }),
        failed: command.failed,
      })
      return Result.match(subject(onFailure), {
        onFailure: () => false,
        onSuccess: (decision) => (command.failed ? fateOf(decision) === 'kept' : fateOf(decision) === 'removed'),
      })
    },
  )
})
