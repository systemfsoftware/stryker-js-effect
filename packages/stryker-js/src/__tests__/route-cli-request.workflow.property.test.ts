import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CliRouteCommand } from '../Cli.schema.js'
import { CliMergeReportsRequested, routeCliRequest } from '../route-cli-request.workflow.js'

const matchesRoute = (command: CliRouteCommand, tag: string): boolean =>
  Match.value(command.route).pipe(
    Match.tag('help', () => tag === 'CliHelpRequested'),
    Match.tag('merge-reports', () => tag === 'CliMergeReportsRequested'),
    Match.tag('run', (run) => tag === (run.survivors ? 'CliSurvivorsRequested' : 'CliRunRequested')),
    Match.exhaustive,
  )

const decides = (subject: typeof routeCliRequest, command: CliRouteCommand): string | undefined =>
  Result.match(subject(command), {
    onFailure: () => undefined,
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('CliHelpRequested', () => 'CliHelpRequested'),
        Match.tag('CliMergeReportsRequested', () => 'CliMergeReportsRequested'),
        Match.tag('CliRunRequested', () => 'CliRunRequested'),
        Match.tag('CliSurvivorsRequested', () => 'CliSurvivorsRequested'),
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

  it.prop(
    '∀m_MergeRoute_≡MergePayloadRoundtrips',
    { of: [CliRouteCommand], subject: routeCliRequest },
    (subject, [command]) =>
      Match.value(command.route).pipe(
        Match.tag('help', () => true),
        Match.tag('run', () => true),
        Match.tag('merge-reports', (route) =>
          Result.match(subject(command), {
            onFailure: () => false,
            onSuccess: (decision) =>
              S.is(CliMergeReportsRequested)(decision) &&
              decision.parts === route.parts &&
              decision.out === route.out &&
              decision.packages === route.packages,
          })),
        Match.exhaustive,
      ),
  )
})
