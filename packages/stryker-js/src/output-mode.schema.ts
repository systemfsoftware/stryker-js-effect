import { OutputMode as OutputModeContract } from '@systemfsoftware/stryker-js-cli-contract'
import * as S from 'effect/Schema'

export const ResolvedMode = S.Struct({
  mode: OutputModeContract.OutputMode,
  signal: OutputModeContract.ModeSignal,
  stdoutIsTTY: S.Boolean,
})
export type ResolvedMode = typeof ResolvedMode.Type

export const ResolvedModeInput = S.Struct({
  mode: OutputModeContract.OutputMode,
  signal: OutputModeContract.ModeSignal,
})
export type ResolvedModeInput = typeof ResolvedModeInput.Type
