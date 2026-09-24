import { describe, expect, test } from 'vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { ResolveWarningEnabledCommand, warningEnabled } from '../config/warning-enabled.workflow.ts'

describe('probe', () => {
  test('tag of empty-record outcome', () => {
    const outcome = warningEnabled(
      ResolveWarningEnabledCommand.make({ warning: 'unknownOptions', warnings: {} }),
    )
    const provided = Match.value(outcome).pipe(
      Match.when(Result.isSuccess, (success) =>
        Match.value(success.success).pipe(
          Match.tag('WarningEnabled', () => 'WarningEnabled'),
          Match.tag('WarningDisabled', () => 'WarningDisabled'),
        )),
      Match.orElse(() => 'WarningDisabled'),
    )
    expect(provided).toStrictEqual('sentinel')
  })
})
