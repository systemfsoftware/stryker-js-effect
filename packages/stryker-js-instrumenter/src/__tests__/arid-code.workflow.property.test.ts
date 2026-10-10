import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type AridCallee,
  AridCalleeSchema,
  aridCode,
  AridCodeCommand,
  type AridCodeDecision,
  type AridFrame,
  AridKept,
  AridSuppressed,
} from '../arid-code.workflow.js'

const detailOf = (callee: AridCallee): string =>
  Match.value(callee).pipe(
    Match.tagsExhaustive({
      EffectExport: (effectExport) => `${effectExport.module}.${effectExport.exportName}`,
      Global: (global) => `${global.name}.${global.member}`,
    }),
  )

const isKept = (decided: Result.Result<AridCodeDecision, never>): boolean =>
  Result.isSuccess(decided) && S.is(AridKept)(decided.success)

const suppressionOf = (decided: Result.Result<AridCodeDecision, never>): Option.Option<AridSuppressed> =>
  Result.isSuccess(decided) && S.is(AridSuppressed)(decided.success) ? Option.some(decided.success) : Option.none()

const sameDecision = (
  left: Result.Result<AridCodeDecision, never>,
  right: Result.Result<AridCodeDecision, never>,
): boolean => Result.isSuccess(left) && Result.isSuccess(right) && Equal.equals(left.success, right.success)

const argumentFrame = (callee: AridCallee): AridFrame => ({
  _tag: 'CallFrame',
  callee: Option.some(callee),
  childIsArgument: true,
})

const FUNCTION_BOUNDARY: AridFrame = { _tag: 'FunctionBoundary' }

const throughCallees = (frames: readonly AridFrame[]): readonly AridFrame[] =>
  frames.flatMap((frame) =>
    Match.value(frame).pipe(
      Match.tagsExhaustive({
        CallFrame: (callFrame): readonly AridFrame[] => [{ ...callFrame, childIsArgument: false }],
        FunctionBoundary: (): readonly AridFrame[] => [],
      }),
    )
  )

const withoutCallees = (frames: readonly AridFrame[]): readonly AridFrame[] =>
  frames.flatMap((frame) =>
    Match.value(frame).pipe(
      Match.tagsExhaustive({
        CallFrame: (callFrame): readonly AridFrame[] => [{ ...callFrame, callee: Option.none<AridCallee>() }],
        FunctionBoundary: (): readonly AridFrame[] => [],
      }),
    )
  )

const asLoggerOrConsole = (callee: AridCallee): AridCallee =>
  Match.value(callee).pipe(
    Match.tagsExhaustive({
      EffectExport: (effectExport): AridCallee => ({ ...effectExport, module: 'Logger' }),
      Global: (global): AridCallee => global,
    }),
  )

const decided = (frames: readonly AridFrame[]): AridCodeCommand =>
  AridCodeCommand.make({ policy: 'default', frames: [...frames] })

describe('aridCode', () => {
  it.prop(
    '∀c_Callee_≡AnyLoggerExportOrConsoleMemberIsSuppressedAsAridLoggingUnderItsCanonicalName',
    { of: [AridCalleeSchema], subject: aridCode },
    (subject, [callee]) => {
      const logger = asLoggerOrConsole(callee)
      return Option.exists(
        suppressionOf(subject(decided([argumentFrame(logger)]))),
        (suppressed) => suppressed.ruleId === 'arid-logging' && suppressed.detail === detailOf(logger),
      )
    },
  )

  it.prop(
    '∀cc_CalleeAndCommand_≡TheInnermostArgumentFrameThatMatchesARuleDecidesAheadOfEveryOuterFrame',
    { of: [AridCalleeSchema, AridCodeCommand], subject: aridCode },
    (subject, [callee, command]) => {
      const alone = subject(decided([argumentFrame(callee)]))
      const withOuterFrames = subject(decided([argumentFrame(callee), ...command.frames]))
      return Option.match(suppressionOf(alone), {
        onNone: () => sameDecision(withOuterFrames, subject(decided(command.frames))),
        onSome: (suppressed) => suppressed.detail === detailOf(callee) && sameDecision(withOuterFrames, alone),
      })
    },
  )

  it.prop(
    '∀c_Command_≡FramesWhoseChildIsNotAnArgumentNeverSuppress',
    { of: [AridCodeCommand], subject: aridCode },
    (subject, [command]) => isKept(subject(decided(throughCallees(command.frames)))),
  )

  it.prop(
    '∀c_Command_≡AFrameWhoseCalleeResolvesToNoEffectModuleAndNoUnshadowedGlobalIsNeverSuppressed',
    { of: [AridCodeCommand], subject: aridCode },
    (subject, [command]) => isKept(subject(decided(withoutCallees(command.frames)))),
  )

  it.prop(
    '∀cc_CalleeAndCommand_≡NoFrameBeyondAFunctionBoundarySuppressesWhileOneBelowItStillDecides',
    { of: [AridCalleeSchema, AridCodeCommand], subject: aridCode },
    (subject, [callee, command]) =>
      isKept(subject(decided([FUNCTION_BOUNDARY, argumentFrame(callee), ...command.frames]))) &&
      sameDecision(
        subject(decided([argumentFrame(callee), FUNCTION_BOUNDARY, ...command.frames])),
        subject(decided([argumentFrame(callee)])),
      ),
  )

  it.prop(
    '∀c_Command_≡TheFullPolicyKeepsWhateverTheFramesSay',
    { of: [AridCodeCommand], subject: aridCode },
    (subject, [command]) => isKept(subject(AridCodeCommand.make({ policy: 'full', frames: [...command.frames] }))),
  )
})
