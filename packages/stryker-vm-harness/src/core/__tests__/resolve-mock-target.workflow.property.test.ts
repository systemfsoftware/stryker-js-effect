import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type BaseCommandFields,
  BaseCommandFieldsSchema,
  RedirectedCommandFieldsSchema,
} from '../../../tests/__fixtures__/resolve-mock-target.schema.js'
import {
  MockTargetAutomocked,
  MockTargetCommand,
  MockTargetRedirected,
  MockTargetSynthetic,
  resolveMockTarget,
} from '../resolve-mock-target.workflow.js'
import type { MockTargetDecision } from '../resolve-mock-target.workflow.js'

const commandFrom = (
  fields: BaseCommandFields,
  kind: 'manual' | 'automock' | 'autospy',
  redirectPath?: string,
): MockTargetCommand => MockTargetCommand.make({ ...fields, kind, redirectPath })

const decisionOf = (command: MockTargetCommand): MockTargetDecision | undefined => {
  const decided = resolveMockTarget(command)
  return Result.isSuccess(decided) ? decided.success : undefined
}

describe('resolveMockTarget property tests', () => {
  it.prop('∀f_Manual_≡Synthetic', [BaseCommandFieldsSchema], ([fields]) => {
    const decision = decisionOf(commandFrom(fields, 'manual'))
    return S.is(MockTargetSynthetic)(decision)
  })

  it.prop('∀f_Redirect_≡MockFileWins', [RedirectedCommandFieldsSchema], ([fields]) => {
    const automocked = decisionOf(commandFrom(fields, 'automock', fields.redirectPath))
    const autospied = decisionOf(commandFrom(fields, 'autospy', fields.redirectPath))
    return S.is(MockTargetRedirected)(automocked) &&
      automocked.redirectPath === fields.redirectPath &&
      S.is(MockTargetRedirected)(autospied) &&
      autospied.redirectPath === fields.redirectPath
  })

  it.prop('∀f_Automock_≡WithoutMockFile', [BaseCommandFieldsSchema], ([fields]) => {
    const automocked = decisionOf(commandFrom(fields, 'automock'))
    const autospied = decisionOf(commandFrom(fields, 'autospy'))
    return S.is(MockTargetAutomocked)(automocked) &&
      automocked.kind === 'automock' &&
      S.is(MockTargetAutomocked)(autospied) &&
      autospied.kind === 'autospy'
  })

  it.prop('∀f_Decision_∈VariantFamily', [BaseCommandFieldsSchema, RedirectedCommandFieldsSchema], ([
    bare,
    redirected,
  ]) => {
    const decisions = [
      decisionOf(commandFrom(bare, 'manual')),
      decisionOf(commandFrom(bare, 'automock')),
      decisionOf(commandFrom(redirected, 'automock', redirected.redirectPath)),
    ]
    return decisions.every(
      (decision) =>
        S.is(MockTargetSynthetic)(decision) ||
        S.is(MockTargetRedirected)(decision) ||
        S.is(MockTargetAutomocked)(decision),
    )
  })
})
