import { describe, it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { CliRouteCommand } from '../Cli.schema.js'
import {
  CliMergeReportsRequested,
  routeCliRequest,
} from '../route-cli-request.workflow.js'

const routeTagOf = (command: CliRouteCommand): string =>
  Match.value(command.route).pipe(
    Match.tag('help', () => 'CliHelpRequested'),
    Match.tag('merge-reports', () => 'CliMergeReportsRequested'),
    Match.tag('run', (run) => run.survivors ? 'CliSurvivorsRequested' : 'CliRunRequested'),
    Match.exhaustive,
  )

describe('routeCliRequest', () => {
  it.prop(
    '∀r_Request_≡RouteFollowsSubcommand',
    [CliRouteCommand],
    ([command]) =>
      Result.match(routeCliRequest(command), {
        onFailure: () => false,
        onSuccess: (decision) => decision._tag === routeTagOf(command),
      }),
  )

  it.prop(
    '∀m_MergeRoute_≡MergePayloadRoundtrips',
    [CliRouteCommand],
    ([command]) =>
      Match.value(command.route).pipe(
        Match.tag('help', () => true),
        Match.tag('run', () => true),
        Match.tag('merge-reports', (route) =>
          Result.match(routeCliRequest(command), {
            onFailure: () => false,
            onSuccess: (decision) =>
              decision instanceof CliMergeReportsRequested
              && decision.parts === route.parts
              && decision.out === route.out
              && decision.packages === route.packages,
          })),
        Match.exhaustive,
      ),
  )
})