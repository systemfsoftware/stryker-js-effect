import type { Schema } from 'effect'
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
import { TraceContextMiddleware, type TracedRpc } from './TraceContextRpc.service.js'

const capabilities: TracedRpc<
  'capabilities',
  Schema.Void,
  typeof TestRunnerCapabilitiesSchema,
  typeof TestRunnerFailed
> = Rpc.make('capabilities', { success: TestRunnerCapabilitiesSchema, error: TestRunnerFailed })
  .middleware(TraceContextMiddleware)

const dryRun: TracedRpc<
  'dryRun',
  typeof TestRunnerDryRunRequest,
  typeof DryRunResultSchema,
  typeof TestRunnerFailed
> = Rpc.make('dryRun', { payload: TestRunnerDryRunRequest, success: DryRunResultSchema, error: TestRunnerFailed })
  .middleware(TraceContextMiddleware)

const mutantRun: TracedRpc<
  'mutantRun',
  typeof TestRunnerMutantRunRequest,
  typeof MutantRunResultSchema,
  typeof TestRunnerFailed
> = Rpc.make('mutantRun', {
  payload: TestRunnerMutantRunRequest,
  success: MutantRunResultSchema,
  error: TestRunnerFailed,
})
  .middleware(TraceContextMiddleware)

const check: TracedRpc<'check', typeof CheckerRequest, typeof CheckerCheckResult, typeof CheckerFailed> = Rpc.make(
  'check',
  { payload: CheckerRequest, success: CheckerCheckResult, error: CheckerFailed },
)
  .middleware(TraceContextMiddleware)

const group: TracedRpc<'group', typeof CheckerRequest, typeof CheckerGroupResult, typeof CheckerFailed> = Rpc.make(
  'group',
  { payload: CheckerRequest, success: CheckerGroupResult, error: CheckerFailed },
)
  .middleware(TraceContextMiddleware)

const init: TracedRpc<'init', typeof ReporterInitOptions, typeof ReporterAck, typeof ReporterFailed> = Rpc.make(
  'init',
  { payload: ReporterInitOptions, success: ReporterAck, error: ReporterFailed },
)
  .middleware(TraceContextMiddleware)

const onEventBatch: TracedRpc<'onEventBatch', typeof ReporterEventBatch, typeof ReporterAck, typeof ReporterFailed> =
  Rpc.make('onEventBatch', { payload: ReporterEventBatch, success: ReporterAck, error: ReporterFailed })
    .middleware(TraceContextMiddleware)

const flush: TracedRpc<'flush', Schema.Void, typeof ReporterDrained, typeof ReporterFailed> = Rpc.make('flush', {
  success: ReporterDrained,
  error: ReporterFailed,
})
  .middleware(TraceContextMiddleware)

export const TestRunnerRpcs: RpcGroup.RpcGroup<typeof capabilities | typeof dryRun | typeof mutantRun> = RpcGroup.make(
  capabilities,
  dryRun,
  mutantRun,
)

export const CheckerRpcs: RpcGroup.RpcGroup<typeof check | typeof group> = RpcGroup.make(check, group)

export const ReporterRpcs: RpcGroup.RpcGroup<typeof init | typeof onEventBatch | typeof flush> = RpcGroup.make(
  init,
  onEventBatch,
  flush,
)
