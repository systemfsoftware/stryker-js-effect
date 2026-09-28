import { describe, it } from '@systemfsoftware/vitest'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type AridCallee,
  aridCode,
  AridCodeCommand,
  type AridCodeDecision,
  AridFrameSchema,
  AridKept,
  type AridRuleId,
  AridSuppressed,
} from '../arid-code.workflow.js'

const detailOf = (callee: AridCallee): string => `${callee.object}.${callee.member}`

const isKept = (decided: Result.Result<AridCodeDecision, never>): boolean =>
  Result.isSuccess(decided) && S.is(AridKept)(decided.success)

const namesSuppression = (
  decided: Result.Result<AridCodeDecision, never>,
  ruleId: AridRuleId,
  detail: string,
): boolean =>
  Result.isSuccess(decided) && S.is(AridSuppressed)(decided.success) && decided.success.ruleId === ruleId &&
  decided.success.detail === detail

const argumentFrame = (callee: AridCallee): AridCodeCommand['frames'][number] => ({
  callee: Option.some(callee),
  childIsArgument: true,
})

const throughCallee = (frame: AridCodeCommand['frames'][number]): AridCodeCommand['frames'][number] => ({
  ...frame,
  childIsArgument: false,
})

const withoutCallee = (frame: AridCodeCommand['frames'][number]): AridCodeCommand['frames'][number] => ({
  ...frame,
  callee: Option.none<AridCallee>(),
})

const LOG_INFO: AridCallee = { object: 'Effect', member: 'logInfo' }
const LOG_INFO_RULE: AridRuleId = 'arid-logging'

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
    '∀c_Command_≡TheFullPolicyKeepsWhateverTheFramesSay',
    { of: [AridCodeCommand], subject: aridCode },
    (subject, [command]) => isKept(subject(AridCodeCommand.make({ policy: 'full', frames: [...command.frames] }))),
  )
})
