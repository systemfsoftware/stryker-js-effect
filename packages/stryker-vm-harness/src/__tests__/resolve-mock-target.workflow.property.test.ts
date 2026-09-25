import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type BaseCommandFields,
  BaseCommandFieldsSchema,
  RedirectedCommandFieldsSchema,
} from '../../tests/__fixtures__/resolve-mock-target.schema.js'
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

const decisionOf = (
  resolve: typeof resolveMockTarget,
  command: MockTargetCommand,
): MockTargetDecision | undefined => {
  const decided = resolve(command)
  return Result.isSuccess(decided) ? decided.success : undefined
}

describe('resolveMockTarget property tests', () => {
  it.prop(
    '∀f_Manual_≡Synthetic',
    { of: [BaseCommandFieldsSchema], subject: resolveMockTarget },
    (resolve, [fields]) => S.is(MockTargetSynthetic)(decisionOf(resolve, commandFrom(fields, 'manual'))),
  )

  it.prop(
    '∀f_Redirect_≡MockFileWins',
    { of: [RedirectedCommandFieldsSchema], subject: resolveMockTarget },
    (resolve, [fields]) => {
      const automocked = decisionOf(resolve, commandFrom(fields, 'automock', fields.redirectPath))
      const autospied = decisionOf(resolve, commandFrom(fields, 'autospy', fields.redirectPath))
      return S.is(MockTargetRedirected)(automocked) &&
        automocked.redirectPath === fields.redirectPath &&
        S.is(MockTargetRedirected)(autospied) &&
        autospied.redirectPath === fields.redirectPath
    },
  )

  it.prop(
    '∀f_Automock_≡WithoutMockFile',
    { of: [BaseCommandFieldsSchema], subject: resolveMockTarget },
    (resolve, [fields]) => {
      const automocked = decisionOf(resolve, commandFrom(fields, 'automock'))
      const autospied = decisionOf(resolve, commandFrom(fields, 'autospy'))
      return S.is(MockTargetAutomocked)(automocked) &&
        automocked.kind === 'automock' &&
        S.is(MockTargetAutomocked)(autospied) &&
        autospied.kind === 'autospy'
    },
  )

  it.prop(
    '∀f_Decision_∈VariantFamily',
    { of: [BaseCommandFieldsSchema, RedirectedCommandFieldsSchema], subject: resolveMockTarget },
    (resolve, [bare, redirected]) => {
      const decisions = [
        decisionOf(resolve, commandFrom(bare, 'manual')),
        decisionOf(resolve, commandFrom(bare, 'automock')),
        decisionOf(resolve, commandFrom(redirected, 'automock', redirected.redirectPath)),
      ]
      return decisions.every(
        (decision) =>
          S.is(MockTargetSynthetic)(decision) ||
          S.is(MockTargetRedirected)(decision) ||
          S.is(MockTargetAutomocked)(decision),
      )
    },
  )
})
