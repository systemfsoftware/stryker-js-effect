import { describe, it } from '@systemfsoftware/vitest'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type AridCallee,
  aridCode,
  AridCodeCommand,
  type AridCodeDecision,
  AridEffectExportCallee,
  AridFrameSchema,
  AridKept,
  type AridRuleId,
  AridSuppressed,
} from '../arid-code.workflow.js'

const detailOf = (callee: AridCallee): string =>
  S.is(AridEffectExportCallee)(callee) ? `${callee.module}.${callee.exportName}` : `${callee.name}.${callee.member}`

const isKept = (decided: Result.Result<AridCodeDecision, never>): boolean =>
  Result.isSuccess(decided) && S.is(AridKept)(decided.success)

const namesSuppression = (
  decided: Result.Result<AridCodeDecision, never>,
  ruleId: AridRuleId,
  detail: string,
): boolean =>
  Result.isSuccess(decided) && S.is(AridSuppressed)(decided.success) && decided.success.ruleId === ruleId &&
  decided.success.detail === detail

const argumentFrame = (
  callee: AridCallee,
  firstArgumentIsString = true,
): AridCodeCommand['frames'][number] => ({
  callee: Option.some(callee),
  childIsArgument: true,
  firstArgumentIsString,
})

const throughCallee = (frame: AridCodeCommand['frames'][number]): AridCodeCommand['frames'][number] => ({
  ...frame,
  childIsArgument: false,
})

const withoutCallee = (frame: AridCodeCommand['frames'][number]): AridCodeCommand['frames'][number] => ({
  ...frame,
  callee: Option.none<AridCallee>(),
})

const LOG_INFO: AridCallee = { _tag: 'EffectExport', module: 'Effect', exportName: 'logInfo' }
const LOG_INFO_RULE: AridRuleId = 'arid-logging'
const EFFECT_FN: AridCallee = { _tag: 'EffectExport', module: 'Effect', exportName: 'fn' }
const TELEMETRY_RULE: AridRuleId = 'arid-telemetry'

describe('aridCode', () => {
  it.prop(
    '∀cf_CommandAndFrame_≡AnAridArgumentFrameDecidesWhereTheSameFrameThroughItsCalleeDoesNot',
    { of: [AridCodeCommand, AridFrameSchema], subject: aridCode },
    (subject, [command, frame]) => {
      const tail = [throughCallee(frame), ...command.frames.map(throughCallee)]
      const asArgument = subject(
        AridCodeCommand.make({ policy: 'default', frames: [argumentFrame(LOG_INFO), ...tail] }),
      )
      const throughTheCallee = subject(
        AridCodeCommand.make({ policy: 'default', frames: [throughCallee(argumentFrame(LOG_INFO)), ...tail] }),
      )
      return namesSuppression(asArgument, LOG_INFO_RULE, detailOf(LOG_INFO)) && isKept(throughTheCallee)
    },
  )

  it.prop(
    '∀c_Command_≡CalleelessOrNonArgumentFramesNeverSuppress',
    { of: [AridCodeCommand], subject: aridCode },
    (subject, [command]) =>
      isKept(subject(AridCodeCommand.make({ policy: 'default', frames: command.frames.map(throughCallee) }))) &&
      isKept(subject(AridCodeCommand.make({ policy: 'default', frames: command.frames.map(withoutCallee) }))),
  )

  it.prop(
    '∀f_Frame_≡AnEffectFnArgumentFrameSuppressesExactlyWhenItsFirstArgumentIsAString',
    { of: [AridFrameSchema], subject: aridCode },
    (subject, [frame]) => {
      const fnFrame = { ...frame, callee: Option.some(EFFECT_FN), childIsArgument: true }
      const decided = subject(AridCodeCommand.make({ policy: 'default', frames: [fnFrame] }))
      return fnFrame.firstArgumentIsString
        ? namesSuppression(decided, TELEMETRY_RULE, 'Effect.fn')
        : isKept(decided)
    },
  )

  it.prop(
    '∀c_Command_≡TheFullPolicyKeepsWhateverTheFramesSay',
    { of: [AridCodeCommand], subject: aridCode },
    (subject, [command]) => isKept(subject(AridCodeCommand.make({ policy: 'full', frames: [...command.frames] }))),
  )
})
