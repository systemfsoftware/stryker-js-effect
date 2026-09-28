import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  MspConfigureRequested,
  type MspDecision,
  MspDiscoverRequested,
  MspInvalidParams,
  MspMethodNotFound,
  MspMutationTestRequested,
  MspNotificationIgnored,
  mspProtocol,
  MspRequestBusy,
  MspRequestCommand,
} from '../Serve/msp-protocol.workflow.js'
import { MSP_METHODS } from '../Serve/msp.schema.js'

const IS_METHOD_DECISION: Record<string, (value: unknown) => value is MspDecision> = {
  [MSP_METHODS.configure]: S.is(MspConfigureRequested),
  [MSP_METHODS.discover]: S.is(MspDiscoverRequested),
  [MSP_METHODS.mutationTest]: S.is(MspMutationTestRequested),
}

const methodDecisionOf = (method: string): ((value: unknown) => value is MspDecision) | undefined =>
  IS_METHOD_DECISION[method]

const decisionOf = (subject: typeof mspProtocol, command: MspRequestCommand) => Result.getOrThrow(subject(command))

describe('mspProtocol', () => {
  it.prop(
    '∀c_MspRequestCommand_≡ARequestWithoutAnIdIsIgnoredAsANotification',
    { of: [MspRequestCommand], subject: mspProtocol },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      if (command.id !== undefined) {
        return true
      }
      return S.is(MspNotificationIgnored)(decision) && decision.method === command.method
    },
  )

  it.prop(
    '∀c_MspRequestCommand_≡AnAddressedRequestWhileARunIsInFlightIsRefusedAsBusy',
    { of: [MspRequestCommand], subject: mspProtocol },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      if (command.id === undefined || !command.busy) {
        return true
      }
      return S.is(MspRequestBusy)(decision) && decision.id === command.id && decision.method === command.method
    },
  )

  it.prop(
    '∀c_MspRequestCommand_≡AFreeAddressedRequestBecomesItsMethodOrIsRefusedAndKeepsItsId',
    { of: [MspRequestCommand], subject: mspProtocol },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      if (command.id === undefined || command.busy) {
        return true
      }
      const isMethodDecision = Option.fromUndefinedOr(methodDecisionOf(command.method))
      if (Option.isNone(isMethodDecision)) {
        return S.is(MspMethodNotFound)(decision) && decision.id === command.id && decision.method === command.method
      }
      return (Boolean(isMethodDecision.value(decision)) || S.is(MspInvalidParams)(decision)) &&
        'id' in decision &&
        decision.id === command.id
    },
  )

  it.prop(
    '∀c_MspRequestCommand_≡TheSameCommandAlwaysDecidesTheSameWay',
    { of: [MspRequestCommand], subject: mspProtocol },
    (subject, [command]) => Equal.equals(decisionOf(subject, command), decisionOf(subject, command)),
  )
})
