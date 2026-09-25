import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { WarningNameSchema, WarningsSchema } from '../../tests/__fixtures__/config-law.schema.js'
import { ResolveWarningEnabledCommand, warningEnabled } from '../config/warning-enabled.workflow.js'

const decidedTagOf = (
  subject: typeof warningEnabled,
  warning: typeof WarningNameSchema.Type,
  warnings: typeof WarningsSchema.Type,
) =>
  Match.value(subject(ResolveWarningEnabledCommand.make({ warning, warnings }))).pipe(
    Match.when(
      Result.isSuccess,
      (success) =>
        Match.value(success.success).pipe(
          Match.tag('WarningEnabled', () => 'WarningEnabled'),
          Match.tag('WarningDisabled', () => 'WarningDisabled'),
          Match.exhaustive,
        ),
    ),
    Match.orElse(() => 'WarningDisabled'),
  )

describe('warningEnabled', () => {
  it.prop(
    '∀wr_Warning_≡RecordFlag',
    { of: [WarningNameSchema, S.Record(S.String, S.Boolean)], subject: warningEnabled },
    (subject, [warning, configured]) =>
      decidedTagOf(subject, warning, configured) ===
        (configured[warning] === true ? 'WarningEnabled' : 'WarningDisabled'),
  )

  it.prop(
    '∀wb_Warning_≡GlobalFlag',
    { of: [WarningNameSchema, S.Boolean], subject: warningEnabled },
    (subject, [warning, global]) =>
      decidedTagOf(subject, warning, global) === (global === true ? 'WarningEnabled' : 'WarningDisabled'),
  )
})
