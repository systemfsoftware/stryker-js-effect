import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  EphemeralInstrument,
  InPlaceInstrument,
  InstrumentCommand,
  planInstrumentation,
} from '../plan-instrumentation.workflow.js'

describe('planInstrumentation', () => {
  it.prop(
    '∀c_Command_≡Decision',
    { of: [InstrumentCommand], subject: planInstrumentation },
    (subject, [command]) => {
      const result = subject(command)
      if (command.inPlace) {
        return (
          Result.isSuccess(result) &&
          S.is(InPlaceInstrument)(result.success) &&
          result.success.fileCount === command.fileCount
        )
      }
      return (
        Result.isSuccess(result) &&
        S.is(EphemeralInstrument)(result.success) &&
        result.success.fileCount === command.fileCount
      )
    },
  )

  it.prop(
    '∀inPlace_EmptyFileSet_≡DryRunWithoutMutants',
    { of: [S.Boolean, S.Finite], subject: planInstrumentation },
    (subject, [inPlace, pluginCount]) => {
      const result = subject(InstrumentCommand.make({ fileCount: 0, inPlace, pluginCount }))
      return Result.isSuccess(result) && result.success.fileCount === 0
    },
  )
})
