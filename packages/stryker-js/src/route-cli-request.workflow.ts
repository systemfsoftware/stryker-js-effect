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

export class CliMergeReportsRequested extends S.TaggedClass<CliMergeReportsRequested>()(
  'CliMergeReportsRequested',
  {
    parts: S.String,
    out: S.String,
    packages: S.optional(S.String),
  },
) {
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
  baseline: S.String,
  updateBaseline: S.Boolean,
}) {
  readonly [CliRouteDecisionTypeId] = CliRouteDecisionTypeId
}

export class CliAnnotateRequested extends S.TaggedClass<CliAnnotateRequested>()('CliAnnotateRequested', {
  baseline: S.optional(S.String),
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
  | CliMergeReportsRequested
  | CliRunRequested
  | CliSurvivorsRequested
  | CliRerunRequested
  | CliCompareRequested
  | CliGateRequested
  | CliAnnotateRequested
  | CliServeRequested
  | CliFeedbackRequested
  | CliMcpRequested

export const routeCliRequest = Workflow.make({
  command: CliRouteCommand,
  decision: S.Union([
    CliHelpRequested,
    CliMergeReportsRequested,
    CliRunRequested,
    CliSurvivorsRequested,
    CliRerunRequested,
    CliCompareRequested,
    CliGateRequested,
    CliAnnotateRequested,
    CliServeRequested,
    CliFeedbackRequested,
    CliMcpRequested,
  ]),
  error: S.Never,
  decide: (command): Result.Result<CliRouteDecision, never> =>
    Match.value(command.route).pipe(
      Match.tag('help', () => Result.succeed(CliHelpRequested.make({}))),
      Match.tag('merge-reports', (merge) =>
        Result.succeed(
          CliMergeReportsRequested.make({ parts: merge.parts, out: merge.out, packages: merge.packages }),
        )),
      Match.tag('compare', (compare) =>
        Result.succeed(
          CliCompareRequested.make({ baseline: compare.baseline, fresh: compare.fresh, noise: compare.noise }),
        )),
      Match.tag('gate', (gate) =>
        Result.succeed(
          CliGateRequested.make({ baseline: gate.baseline, updateBaseline: gate.updateBaseline }),
        )),
      Match.tag('annotate', (annotate) => Result.succeed(CliAnnotateRequested.make({ baseline: annotate.baseline }))),
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
          Option.filter(Option.fromUndefinedOr(run.mutants), (ids) => ids.length > 0),
          {
            onSome: (ids) => Result.succeed(CliRerunRequested.make({ ids: [...ids] })),
            onNone: () =>
              Boolean.match(run.survivors, {
                onTrue: () => Result.succeed(CliSurvivorsRequested.make({})),
                onFalse: () => Result.succeed(CliRunRequested.make({})),
              }),
          },
        )),
      Match.exhaustive,
    ),
})
