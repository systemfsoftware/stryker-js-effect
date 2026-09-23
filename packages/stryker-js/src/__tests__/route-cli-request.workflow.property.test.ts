import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'

import {
  CliMergeReportsRequested,
  CliRouteCommand,
} from '../route-cli-request.workflow.js'
import {
  type CliRouteDecision,
  routeCliRequest,
} from '../route-cli-request.workflow.js'

const tagOf = (decision: CliRouteDecision): string => decision._tag

describe('routeCliRequest', () => {
  it.prop(
    '∀r_Request_≡RouteFollowsSubcommand',
    [CliRouteCommand],
    ([command]) =>
      Result.match(routeCliRequest(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          command.route._tag === 'help'
            ? tagOf(decision) === 'CliHelpRequested'
          : command.route._tag === 'merge-reports'
            ? tagOf(decision) === 'CliMergeReportsRequested'
          : command.route.survivors
            ? tagOf(decision) === 'CliSurvivorsRequested'
          : tagOf(decision) === 'CliRunRequested',
      }),
  )

  it.prop(
    '∀m_MergeRoute_≡MergePayloadRoundtrips',
    [CliRouteCommand],
    ([command]) =>
      command.route._tag !== 'merge-reports' || Result.match(routeCliRequest(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          decision instanceof CliMergeReportsRequested
          && decision.parts === command.route.parts
          && decision.out === command.route.out
          && decision.packages === command.route.packages,
      }),
  )
})