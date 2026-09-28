import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  decodeConfigureParams,
  decodeDiscoverParams,
  decodeMutationTestParams,
  DiscoverParams,
  JsonRpcId,
  MSP_METHODS,
  MspMethod,
  MutationTestParams,
} from './msp.schema.js'

const MspDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MspDecision')
type MspDecisionTypeId = typeof MspDecisionTypeId

export class MspConfigureRequested extends S.TaggedClass<MspConfigureRequested>()('MspConfigureRequested', {
  id: JsonRpcId,
  configFilePath: S.optionalKey(S.String),
}) {
  readonly [MspDecisionTypeId] = MspDecisionTypeId
}

export class MspDiscoverRequested extends S.TaggedClass<MspDiscoverRequested>()('MspDiscoverRequested', {
  id: JsonRpcId,
  params: DiscoverParams,
}) {
  readonly [MspDecisionTypeId] = MspDecisionTypeId
}

export class MspMutationTestRequested extends S.TaggedClass<MspMutationTestRequested>()('MspMutationTestRequested', {
  id: JsonRpcId,
  params: MutationTestParams,
}) {
  readonly [MspDecisionTypeId] = MspDecisionTypeId
}

export class MspMethodNotFound extends S.TaggedClass<MspMethodNotFound>()('MspMethodNotFound', {
  id: JsonRpcId,
  method: S.String,
}) {
  readonly [MspDecisionTypeId] = MspDecisionTypeId
}

export class MspInvalidParams extends S.TaggedClass<MspInvalidParams>()('MspInvalidParams', {
  id: JsonRpcId,
  method: S.String,
  issue: S.String,
}) {
  readonly [MspDecisionTypeId] = MspDecisionTypeId
}

export class MspRequestBusy extends S.TaggedClass<MspRequestBusy>()('MspRequestBusy', {
  id: JsonRpcId,
  method: S.String,
}) {
  readonly [MspDecisionTypeId] = MspDecisionTypeId
}

export class MspNotificationIgnored extends S.TaggedClass<MspNotificationIgnored>()('MspNotificationIgnored', {
  method: S.String,
}) {
  readonly [MspDecisionTypeId] = MspDecisionTypeId
}

export type MspDecision =
  | MspConfigureRequested
  | MspDiscoverRequested
  | MspMutationTestRequested
  | MspMethodNotFound
  | MspInvalidParams
  | MspRequestBusy
  | MspNotificationIgnored

export class MspRequestCommand extends S.TaggedClass<MspRequestCommand>()('MspRequestCommand', {
  id: S.optionalKey(JsonRpcId),
  method: S.String,
  params: S.optionalKey(S.Json),
  busy: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

interface JsonIssue {
  readonly message: string
}

const refusedParams = (id: JsonRpcId, method: string, issue: JsonIssue): MspDecision =>
  MspInvalidParams.make({ id, method, issue: issue.message })

const configured = (
  id: JsonRpcId,
  params: S.Json | undefined,
): Result.Result<MspDecision, never> =>
  Result.match(decodeConfigureParams(params), {
    onFailure: (issue) => Result.succeed(refusedParams(id, MSP_METHODS.configure, issue)),
    onSuccess: (decoded) =>
      Result.succeed(MspConfigureRequested.make({ id, ...configFieldsOf(decoded.configFilePath) })),
  })

const configFieldsOf = (configFilePath: string | undefined): { readonly configFilePath?: string } =>
  Option.match(Option.fromUndefinedOr(configFilePath), {
    onNone: () => ({}),
    onSome: (path) => ({ configFilePath: path }),
  })

const discovered = (
  id: JsonRpcId,
  params: S.Json | undefined,
): Result.Result<MspDecision, never> =>
  Result.match(decodeDiscoverParams(params), {
    onFailure: (issue) => Result.succeed(refusedParams(id, MSP_METHODS.discover, issue)),
    onSuccess: (decoded) => Result.succeed(MspDiscoverRequested.make({ id, params: decoded })),
  })

const mutationTest = (
  id: JsonRpcId,
  params: S.Json | undefined,
): Result.Result<MspDecision, never> =>
  Result.match(decodeMutationTestParams(params), {
    onFailure: (issue) => Result.succeed(refusedParams(id, MSP_METHODS.mutationTest, issue)),
    onSuccess: (decoded) => Result.succeed(MspMutationTestRequested.make({ id, params: decoded })),
  })

const methodOf = (name: string): Option.Option<MspMethod> => S.decodeUnknownOption(MspMethod)(name)

const dispatchMethod = (
  method: MspMethod,
  command: MspRequestCommand,
  id: JsonRpcId,
): Result.Result<MspDecision, never> =>
  Match.value(method).pipe(
    Match.when(MSP_METHODS.configure, () => configured(id, command.params)),
    Match.when(MSP_METHODS.discover, () => discovered(id, command.params)),
    Match.when(MSP_METHODS.mutationTest, () => mutationTest(id, command.params)),
    Match.when(
      MSP_METHODS.reportMutationTestProgress,
      () => Result.succeed(MspMethodNotFound.make({ id, method: command.method })),
    ),
    Match.exhaustive,
  )

const decidedForMethod = (
  command: MspRequestCommand,
  id: JsonRpcId,
): Result.Result<MspDecision, never> =>
  Option.match(methodOf(command.method), {
    onNone: () => Result.succeed(MspMethodNotFound.make({ id, method: command.method })),
    onSome: (method) => dispatchMethod(method, command, id),
  })

const whileRunning = (
  command: MspRequestCommand,
  id: JsonRpcId,
): Result.Result<MspDecision, never> =>
  Boolean.match(command.busy, {
    onTrue: () => Result.succeed(MspRequestBusy.make({ id, method: command.method })),
    onFalse: () => decidedForMethod(command, id),
  })

const decideMspRequest = (command: MspRequestCommand): Result.Result<MspDecision, never> =>
  Option.match(Option.fromUndefinedOr(command.id), {
    onNone: () => Result.succeed(MspNotificationIgnored.make({ method: command.method })),
    onSome: (id) => whileRunning(command, id),
  })

export const mspProtocol = Workflow.make({
  command: MspRequestCommand,
  decision: S.Union([
    MspConfigureRequested,
    MspDiscoverRequested,
    MspMutationTestRequested,
    MspMethodNotFound,
    MspInvalidParams,
    MspRequestBusy,
    MspNotificationIgnored,
  ]),
  error: S.Never,
  decide: decideMspRequest,
})
