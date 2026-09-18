import * as Rpc from 'effect/unstable/rpc/Rpc'
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup'

import { CheckerFailed } from './Checker.schema.js'
import { ReporterFailed } from './ReporterEvent.schema.js'
import {
  DryRunResultSchema,
  MutantRunResultSchema,
  TestRunnerCapabilitiesSchema,
  TestRunnerFailed,
} from './TestRunner.schema.js'

import type { Schema } from 'effect'
import {
  CheckerCheckResult,
  CheckerGroupResult,
  CheckerRequest,
  ReporterAck,
  ReporterDrained,
  ReporterEventBatch,
  ReporterInitOptions,
  TestRunnerDryRunRequest,
  TestRunnerMutantRunRequest,
} from './Plugin.schema.js'
import { TraceContextMiddleware, type TracedRpc } from './TraceContextRpc.js'

export const TestRunnerRpcs: RpcGroup.RpcGroup<
  | TracedRpc<'capabilities', Schema.Void, typeof TestRunnerCapabilitiesSchema, typeof TestRunnerFailed>
  | TracedRpc<'dryRun', typeof TestRunnerDryRunRequest, typeof DryRunResultSchema, typeof TestRunnerFailed>
  | TracedRpc<'mutantRun', typeof TestRunnerMutantRunRequest, typeof MutantRunResultSchema, typeof TestRunnerFailed>
> = RpcGroup.make(
  Rpc.make('capabilities', {
    success: TestRunnerCapabilitiesSchema,
    error: TestRunnerFailed,
  }),
  Rpc.make('dryRun', {
    payload: TestRunnerDryRunRequest,
    success: DryRunResultSchema,
    error: TestRunnerFailed,
  }),
  Rpc.make('mutantRun', {
    payload: TestRunnerMutantRunRequest,
    success: MutantRunResultSchema,
    error: TestRunnerFailed,
  }),
).middleware(TraceContextMiddleware)

export const CheckerRpcs: RpcGroup.RpcGroup<
  | TracedRpc<'check', typeof CheckerRequest, typeof CheckerCheckResult, typeof CheckerFailed>
  | TracedRpc<'group', typeof CheckerRequest, typeof CheckerGroupResult, typeof CheckerFailed>
> = RpcGroup.make(
  Rpc.make('check', {
    payload: CheckerRequest,
    success: CheckerCheckResult,
    error: CheckerFailed,
  }),
  Rpc.make('group', {
    payload: CheckerRequest,
    success: CheckerGroupResult,
    error: CheckerFailed,
  }),
).middleware(TraceContextMiddleware)

export const ReporterRpcs: RpcGroup.RpcGroup<
  | TracedRpc<'init', typeof ReporterInitOptions, typeof ReporterAck, typeof ReporterFailed>
  | TracedRpc<'onEventBatch', typeof ReporterEventBatch, typeof ReporterAck, typeof ReporterFailed>
  | TracedRpc<'flush', Schema.Void, typeof ReporterDrained, typeof ReporterFailed>
> = RpcGroup.make(
  Rpc.make('init', {
    payload: ReporterInitOptions,
    success: ReporterAck,
    error: ReporterFailed,
  }),
  Rpc.make('onEventBatch', {
    payload: ReporterEventBatch,
    success: ReporterAck,
    error: ReporterFailed,
  }),
  Rpc.make('flush', {
    success: ReporterDrained,
    error: ReporterFailed,
  }),
).middleware(TraceContextMiddleware)
