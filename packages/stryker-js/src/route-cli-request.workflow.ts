import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CliRouteCommand } from './Cli.schema.js'

export class CliHelpRequested extends S.TaggedClass<CliHelpRequested>()('CliHelpRequested', {}) {}

export class CliMergeReportsRequested extends S.TaggedClass<CliMergeReportsRequested>()(
  'CliMergeReportsRequested',
  {
    parts: S.String,
    out: S.String,
    packages: S.optional(S.String),
  },
) {}

export class CliRunRequested extends S.TaggedClass<CliRunRequested>()('CliRunRequested', {}) {}

export class CliSurvivorsRequested extends S.TaggedClass<CliSurvivorsRequested>()('CliSurvivorsRequested', {}) {}

export type CliRouteDecision =
  | CliHelpRequested
  | CliMergeReportsRequested
  | CliRunRequested
  | CliSurvivorsRequested

export const routeCliRequest = Workflow.make({
  command: CliRouteCommand,
  decision: S.Union([CliHelpRequested, CliMergeReportsRequested, CliRunRequested, CliSurvivorsRequested]),
  error: S.Never,
  decide: (command): Result.Result<CliRouteDecision, never> =>
    Match.value(command.route).pipe(
      Match.tag('help', () => Result.succeed(CliHelpRequested.make({}))),
      Match.tag('merge-reports', (merge) =>
        Result.succeed(
          CliMergeReportsRequested.make({ parts: merge.parts, out: merge.out, packages: merge.packages }),
        )),
      Match.tag('run', (run) =>
        Boolean.match(run.survivors, {
          onTrue: () => Result.succeed(CliSurvivorsRequested.make({})),
          onFalse: () => Result.succeed(CliRunRequested.make({})),
        })),
      Match.exhaustive,
    ),
})