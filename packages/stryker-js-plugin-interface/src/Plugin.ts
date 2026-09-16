import {
  CheckerFailed,
  DryRunResultSchema,
  MutantRunResultSchema,
  ReporterFailed,
  TestRunnerCapabilitiesSchema,
  TestRunnerFailed,
} from '@systemfsoftware/stryker-js-language'
import * as Rpc from 'effect/unstable/rpc/Rpc'
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup'

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
  type WorkerPluginKind,
} from './Plugin.schema.js'
import { TraceContextMiddleware } from './TraceContextRpc.js'

export const TestRunnerRpcs = RpcGroup.make(
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

export const CheckerRpcs = RpcGroup.make(
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

export const ReporterRpcs = RpcGroup.make(
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

export interface WorkerRpcGroupMap {
  readonly TestRunner: typeof TestRunnerRpcs
  readonly Checker: typeof CheckerRpcs
  readonly Reporter: typeof ReporterRpcs
}

export const WorkerRpcGroups: WorkerRpcGroupMap = {
  TestRunner: TestRunnerRpcs,
  Checker: CheckerRpcs,
  Reporter: ReporterRpcs,
}

export type WorkerRpcsOf<K extends WorkerPluginKind> = WorkerRpcGroupMap[K]

export interface WorkerPluginEntry<K extends WorkerPluginKind = WorkerPluginKind> {
  readonly kind: K
  readonly group: WorkerRpcsOf<K>
}
