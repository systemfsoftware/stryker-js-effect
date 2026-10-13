import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { CliRouteCommand } from '../Cli.schema.js'
import { routeCliRequest } from '../route-cli-request.workflow.js'

const REFUSED = 'RunPlanWithoutShardRefused'

const matchesRoute = (command: CliRouteCommand, tag: string): boolean =>
  Match.value(command.route).pipe(
    Match.tag('help', () => tag === 'CliHelpRequested'),
    Match.tag('merge', () => tag === 'CliMergeRequested'),
    Match.tag('compare', () => tag === 'CliCompareRequested'),
    Match.tag('gate', () => tag === 'CliGateRequested'),
    Match.tag('annotate', () => tag === 'CliAnnotateRequested'),
    Match.tag('plan', () => tag === 'CliPlanRequested'),
    Match.tag('audit', () => tag === 'CliAuditRequested'),
    Match.tag('serve', () => tag === 'CliServeRequested'),
    Match.tag('feedback', () => tag === 'CliFeedbackRequested'),
    Match.tag('mcp', () => tag === 'CliMcpRequested'),
    Match.tag('run', (run) =>
      run.plan !== undefined && run.shard === undefined
        ? tag === REFUSED
        : run.plan !== undefined && run.shard !== undefined
        ? (run.project !== undefined ? tag === 'CliShardLeafRequested' : tag === 'CliShardRunRequested')
        : run.mutants !== undefined && run.mutants.length > 0
        ? tag === 'CliRerunRequested'
        : tag === (run.survivors ? 'CliSurvivorsRequested' : 'CliRunRequested')),
    Match.exhaustive,
  )

const decides = (subject: typeof routeCliRequest, command: CliRouteCommand): string =>
  Result.match(subject(command), {
    onFailure: (refusal) =>
      Match.value(refusal).pipe(
        Match.tag('RunPlanWithoutShardRefused', () => REFUSED),
        Match.exhaustive,
      ),
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('CliHelpRequested', () => 'CliHelpRequested'),
        Match.tag('CliMergeRequested', () => 'CliMergeRequested'),
        Match.tag('CliShardRunRequested', () => 'CliShardRunRequested'),
        Match.tag('CliShardLeafRequested', () => 'CliShardLeafRequested'),
        Match.tag('CliCompareRequested', () => 'CliCompareRequested'),
        Match.tag('CliGateRequested', () => 'CliGateRequested'),
        Match.tag('CliAnnotateRequested', () => 'CliAnnotateRequested'),
        Match.tag('CliPlanRequested', () => 'CliPlanRequested'),
        Match.tag('CliAuditRequested', () => 'CliAuditRequested'),
        Match.tag('CliServeRequested', () => 'CliServeRequested'),
        Match.tag('CliFeedbackRequested', () => 'CliFeedbackRequested'),
        Match.tag('CliMcpRequested', () => 'CliMcpRequested'),
        Match.tag('CliRunRequested', () => 'CliRunRequested'),
        Match.tag('CliSurvivorsRequested', () => 'CliSurvivorsRequested'),
        Match.tag('CliRerunRequested', () => 'CliRerunRequested'),
        Match.exhaustive,
      ),
  })

describe('routeCliRequest', () => {
  it.prop(
    '∀r_Request_≡RouteFollowsSubcommand',
    { of: [CliRouteCommand], subject: routeCliRequest },
    (subject, [command]) => matchesRoute(command, decides(subject, command)),
  )
})
