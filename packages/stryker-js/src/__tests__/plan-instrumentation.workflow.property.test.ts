import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  EphemeralInstrument,
  InPlaceInstrument,
  InstrumentCommand,
  InstrumentError,
  planInstrumentation,
} from '../plan-instrumentation.workflow.js'

describe('planInstrumentation', () => {
  it.prop('∀c_Command_≡Decision', [InstrumentCommand], ([command]) => {
    const result = planInstrumentation(command)
    if (command.fileCount === 0) {
      return Result.isFailure(result) && S.is(InstrumentError)(result.failure)
    }
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
  })
})
