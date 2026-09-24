import { describe, it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { KeepTempDirCommand, keepTempDir, type KeepTempDirOutcome } from '../keep-temp-dir.workflow.js'

const fateOf = (decision: KeepTempDirOutcome): 'kept' | 'removed' =>
  Match.value(decision).pipe(
    Match.tag('TempDirKept', () => 'kept' as const),
    Match.tag('TempDirRemoved', () => 'removed' as const),
    Match.exhaustive,
  )

describe('keepTempDir', () => {

  it.prop('∀a_Always_≡Removed', [KeepTempDirCommand], ([command]) => {
    const always = KeepTempDirCommand.make({ cleanTempDir: { _tag: 'KeepTempDirAlways' }, failed: command.failed })
    return Result.match(keepTempDir(always), {
      onFailure: () => false,
      onSuccess: (decision) => fateOf(decision) === 'removed',
    })
  })

  it.prop('∀f_OnFailure_≡KeptIffFailed', [KeepTempDirCommand], ([command]) => {
    const onFailure = KeepTempDirCommand.make({
      cleanTempDir: { _tag: 'KeepTempDirOnFailure', failed: command.failed },
      failed: command.failed,
    })
    return Result.match(keepTempDir(onFailure), {
      onFailure: () => false,
      onSuccess: (decision) => (command.failed ? fateOf(decision) === 'kept' : fateOf(decision) === 'removed'),
    })
  })
})
