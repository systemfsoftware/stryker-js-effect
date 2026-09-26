import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

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
    { of: [S.Boolean], subject: keepTempDir },
    (subject, [failed]) => {
      const always = KeepTempDirCommand.make({ cleanTempDir: KeepTempDirAlways.make({}), failed })
      return Result.match(subject(always), {
        onFailure: () => false,
        onSuccess: (decision) => fateOf(decision) === 'removed',
      })
    },
  )

  it.prop(
    '∀f_OnFailure_≡KeptIffFailed',
    { of: [S.Boolean], subject: keepTempDir },
    (subject, [failed]) => {
      const onFailure = KeepTempDirCommand.make({
        cleanTempDir: KeepTempDirOnFailure.make({ failed }),
        failed,
      })
      return Result.match(subject(onFailure), {
        onFailure: () => false,
        onSuccess: (decision) => (failed ? fateOf(decision) === 'kept' : fateOf(decision) === 'removed'),
      })
    },
  )
})
