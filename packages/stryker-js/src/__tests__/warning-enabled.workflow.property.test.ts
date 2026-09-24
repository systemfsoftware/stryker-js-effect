import { describe, it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ResolveWarningEnabledCommand,
  warningEnabled,
} from '../config/warning-enabled.workflow.js'
import { WarningNameSchema, WarningsSchema } from '../../tests/__fixtures__/config-law.schema.js'

const decidedTagOf = (warning: typeof WarningNameSchema.Type, warnings: typeof WarningsSchema.Type): string =>
  Match.value(warningEnabled(ResolveWarningEnabledCommand.make({ warning, warnings }))).pipe(
    Match.when(
      Result.isSuccess,
      (success) =>
        Match.value(success.success).pipe(
          Match.tag('WarningEnabled', () => 'WarningEnabled'),
          Match.tag('WarningDisabled', () => 'WarningDisabled'),
        ),
    ),
    Match.orElse(() => 'WarningDisabled'),
  )

describe('warningEnabled', () => {
  it.prop('∀wr_Warning_≡RecordFlag', [WarningNameSchema, S.Record(S.String, S.Boolean)], ([warning, configured]) =>
    decidedTagOf(warning, configured) === (configured[warning] === true ? 'WarningEnabled' : 'WarningDisabled'))

  it.prop('∀wb_Warning_≡GlobalFlag', [WarningNameSchema, S.Boolean], ([warning, global]) =>
    decidedTagOf(warning, global) === (global === true ? 'WarningEnabled' : 'WarningDisabled'))

  it.prop('∀wr_Warning_∈DecisionVariants', [WarningNameSchema, WarningsSchema], ([warning, warnings]) =>
    Match.value(warningEnabled(ResolveWarningEnabledCommand.make({ warning, warnings }))).pipe(
      Match.when(Result.isSuccess, () => true),
      Match.orElse(() => false),
    ))
})