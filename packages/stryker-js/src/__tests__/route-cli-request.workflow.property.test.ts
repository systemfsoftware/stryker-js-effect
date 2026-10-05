import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { CliRouteCommand } from '../Cli.schema.js'
import { routeCliRequest } from '../route-cli-request.workflow.js'

const matchesRoute = (command: CliRouteCommand, tag: string): boolean =>
  Match.value(command.route).pipe(
    Match.tag('help', () => tag === 'CliHelpRequested'),
    Match.tag('merge-reports', () => tag === 'CliMergeReportsRequested'),
    Match.tag('compare', () => tag === 'CliCompareRequested'),
    Match.tag('gate', () => tag === 'CliGateRequested'),
    Match.tag('annotate', () => tag === 'CliAnnotateRequested'),
    Match.tag('plan', () => tag === 'CliPlanRequested'),
    Match.tag('serve', () => tag === 'CliServeRequested'),
    Match.tag('feedback', () => tag === 'CliFeedbackRequested'),
    Match.tag('mcp', () => tag === 'CliMcpRequested'),
    Match.tag('run', (run) =>
      run.mutants !== undefined && run.mutants.length > 0
        ? tag === 'CliRerunRequested'
        : tag === (run.survivors ? 'CliSurvivorsRequested' : 'CliRunRequested')),
    Match.exhaustive,
  )

const decides = (subject: typeof routeCliRequest, command: CliRouteCommand): string | undefined =>
  Result.match(subject(command), {
    onFailure: () => undefined,
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('CliHelpRequested', () => 'CliHelpRequested'),
        Match.tag('CliMergeReportsRequested', () => 'CliMergeReportsRequested'),
        Match.tag('CliCompareRequested', () => 'CliCompareRequested'),
        Match.tag('CliGateRequested', () => 'CliGateRequested'),
        Match.tag('CliAnnotateRequested', () => 'CliAnnotateRequested'),
        Match.tag('CliPlanRequested', () => 'CliPlanRequested'),
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
    (subject, [command]) => {
      const decided = decides(subject, command)
      return decided !== undefined && matchesRoute(command, decided)
    },
  )
})
