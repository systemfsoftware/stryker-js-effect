import * as S from 'effect/Schema'

export const OutputMode = S.Literals(['human', 'machine'])
export type OutputMode = typeof OutputMode.Type

export const ModeSignal = S.Literals(['flag', 'env', 'tty', 'agent', 'tool'])
export type ModeSignal = typeof ModeSignal.Type

export const ResolvedMode = S.Struct({
  mode: OutputMode,
  signal: ModeSignal,
  stdoutIsTTY: S.Boolean,
})
export type ResolvedMode = typeof ResolvedMode.Type
