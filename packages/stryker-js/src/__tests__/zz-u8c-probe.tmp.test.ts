import { describe, expect } from 'vitest'
import { it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { WarningNameSchema, WarningsSchema } from '../../tests/__fixtures__/config-law.schema.js'
import { ResolveWarningEnabledCommand, warningEnabled } from '../config/warning-enabled.workflow.js'

describe('probe', () => {
  it.prop('∀pr_Probe_≡WarningDisabled', [WarningNameSchema, S.Record(S.String, S.Boolean)], ([warning, configured]) => {
    const outcome = warningEnabled(ResolveWarningEnabledCommand.make({ warning, warnings: configured }))
    const tag = Result.isSuccess(outcome) ? outcome.success._tag : 'not-a-result-success'
    expect([warning, configured, tag]).toStrictEqual([warning, configured, 'WarningDisabled'])
  })
})
