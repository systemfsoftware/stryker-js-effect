import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CliRouteCommand, FeedbackJudgmentSchema, ServeChannelSchema } from './Cli.schema.js'

const CliRouteDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/CliRouteDecision')
type CliRouteDecisionTypeId = typeof CliRouteDecisionTypeId

export class CliHelpRequested extends S.TaggedClass<CliHelpRequested>()('CliHelpRequested', {}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliMergeRequested extends S.TaggedClass<CliMergeRequested>()(
  'CliMergeRequested',
  {
    plan: S.String,
    out: S.optional(S.String),
    shards: S.Array(S.String),
  },
) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliShardRunRequested extends S.TaggedClass<CliShardRunRequested>()('CliShardRunRequested', {
  plan: S.String,
  shard: S.String,
  out: S.optional(S.String),
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliShardLeafRequested extends S.TaggedClass<CliShardLeafRequested>()('CliShardLeafRequested', {
  plan: S.String,
  shard: S.String,
  project: S.String,
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliRunRequested extends S.TaggedClass<CliRunRequested>()('CliRunRequested', {}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliSurvivorsRequested extends S.TaggedClass<CliSurvivorsRequested>()('CliSurvivorsRequested', {}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliRerunRequested extends S.TaggedClass<CliRerunRequested>()('CliRerunRequested', {
  ids: S.Array(S.String),
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliCompareRequested extends S.TaggedClass<CliCompareRequested>()('CliCompareRequested', {
  baseline: S.String,
  fresh: S.String,
  noise: S.optional(S.String),
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliGateRequested extends S.TaggedClass<CliGateRequested>()('CliGateRequested', {
  baseline: S.optional(S.String),
  updateBaseline: S.Boolean,
  budgetBaseline: S.optional(S.String),
  budgetTolerance: S.Finite,
  updateBudgetBaseline: S.Boolean,
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliAnnotateRequested extends S.TaggedClass<CliAnnotateRequested>()('CliAnnotateRequested', {
  baseline: S.optional(S.String),
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliPlanRequested extends S.TaggedClass<CliPlanRequested>()('CliPlanRequested', {
  targetSeconds: S.Finite,
  maxShards: S.optional(S.Int),
  projects: S.Array(S.String).pipe(S.optional),
  out: S.optional(S.String),
  full: S.Boolean,
  since: S.optional(S.String),
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliAuditRequested extends S.TaggedClass<CliAuditRequested>()('CliAuditRequested', {
  matrix: S.String,
  out: S.String,
  countsOnly: S.Boolean,
  projects: S.Array(S.String).pipe(S.optional),
  files: S.Array(S.String).pipe(S.optional),
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliServeRequested extends S.TaggedClass<CliServeRequested>()('CliServeRequested', {
  channel: ServeChannelSchema,
  port: S.optional(S.Int),
  address: S.optional(S.String),
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliFeedbackRequested extends S.TaggedClass<CliFeedbackRequested>()('CliFeedbackRequested', {
  id: S.String,
  judgment: FeedbackJudgmentSchema,
  reason: S.optional(S.String),
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliMcpRequested extends S.TaggedClass<CliMcpRequested>()('CliMcpRequested', {}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export type CliRouteDecision =
  | CliHelpRequested
  | CliMergeRequested
  | CliShardRunRequested
  | CliShardLeafRequested
  | CliRunRequested
  | CliSurvivorsRequested
  | CliRerunRequested
  | CliCompareRequested
  | CliGateRequested
  | CliAnnotateRequested
  | CliPlanRequested
  | CliAuditRequested
  | CliServeRequested
  | CliFeedbackRequested
  | CliMcpRequested

export const routeCliRequest = Workflow.make({
  command: CliRouteCommand,
  decision: S.Union([
    CliHelpRequested,
    CliMergeRequested,
    CliShardRunRequested,
    CliShardLeafRequested,
    CliRunRequested,
    CliSurvivorsRequested,
    CliRerunRequested,
    CliCompareRequested,
    CliGateRequested,
    CliAnnotateRequested,
    CliPlanRequested,
    CliAuditRequested,
    CliServeRequested,
    CliFeedbackRequested,
    CliMcpRequested,
  ]),
  error: S.Never,
  decide: (command): Result.Result<CliRouteDecision, never> =>
    Match.value(command.route).pipe(
      Match.tag('help', () => Result.succeed(CliHelpRequested.make({}))),
      Match.tag('merge', (merge) =>
        Result.succeed(CliMergeRequested.make({ plan: merge.plan, out: merge.out, shards: merge.shards }))),
      Match.tag('compare', (compare) =>
        Result.succeed(
          CliCompareRequested.make({ baseline: compare.baseline, fresh: compare.fresh, noise: compare.noise }),
        )),
      Match.tag('gate', (gate) =>
        Result.succeed(
          CliGateRequested.make({
            baseline: gate.baseline,
            updateBaseline: gate.updateBaseline,
            budgetBaseline: gate.budgetBaseline,
            budgetTolerance: gate.budgetTolerance,
            updateBudgetBaseline: gate.updateBudgetBaseline,
          }),
        )),
      Match.tag('annotate', (annotate) =>
        Result.succeed(CliAnnotateRequested.make({ baseline: annotate.baseline }))),
      Match.tag('plan', (plan) =>
        Result.succeed(
          CliPlanRequested.make({
            targetSeconds: plan.targetSeconds,
            maxShards: plan.maxShards,
            projects: plan.projects,
            out: plan.out,
            full: plan.full,
            since: plan.since,
          }),
        )),
      Match.tag('audit', (audit) =>
        Result.succeed(
          CliAuditRequested.make({
            matrix: audit.matrix,
            out: audit.out,
            countsOnly: audit.countsOnly,
            projects: audit.projects,
            files: audit.files,
          }),
        )),
      Match.tag('serve', (serve) =>
        Result.succeed(
          CliServeRequested.make({ channel: serve.channel, port: serve.port, address: serve.address }),
        )),
      Match.tag('feedback', (feedback) =>
        Result.succeed(
          CliFeedbackRequested.make({
            id: feedback.id,
            judgment: feedback.judgment,
            reason: feedback.reason,
          }),
        )),
      Match.tag('mcp', () => Result.succeed(CliMcpRequested.make({}))),
      Match.tag('run', (run) =>
        Option.match(
          Option.all([Option.fromUndefinedOr(run.plan), Option.fromUndefinedOr(run.shard)]),
          {
            onSome: ([plan, shard]) =>
              Option.match(Option.fromUndefinedOr(run.project), {
                onSome: (project) => Result.succeed(CliShardLeafRequested.make({ plan, shard, project })),
                onNone: () => Result.succeed(CliShardRunRequested.make({ plan, shard, out: run.out })),
              }),
            onNone: () =>
              Option.match(
                Option.filter(Option.fromUndefinedOr(run.mutants), (ids) => ids.length > 0),
                {
                  onSome: (ids) => Result.succeed(CliRerunRequested.make({ ids: [...ids] })),
                  onNone: () =>
                    Boolean.match(run.survivors, {
                      onTrue: () => Result.succeed(CliSurvivorsRequested.make({})),
                      onFalse: () => Result.succeed(CliRunRequested.make({})),
                    }),
                },
              ),
          },
        )),
      Match.exhaustive,
    ),
})
