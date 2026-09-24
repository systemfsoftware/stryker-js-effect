import * as Match from 'effect/Match'

import type { DrainedStatus, TestOutcome } from './drain-registry.workflow.js'

export interface TestStatusDecision {
  readonly status: DrainedStatus
  readonly failureMessage: string | undefined
}

export const decideTestStatus = (
  inverted: boolean,
  fullName: string,
  outcome: (TestOutcome & { readonly skipped?: boolean | undefined }) | undefined,
): TestStatusDecision => {
  if (outcome?.skipped === true) {
    return { status: 'skipped', failureMessage: undefined }
  }
  const failureMessage = outcome?.failureMessage
  const threw = failureMessage !== undefined
  const status: DrainedStatus = Match.value(threw === inverted).pipe(
    Match.when(true, (): DrainedStatus => 'success'),
    Match.when(false, (): DrainedStatus => 'failed'),
    Match.exhaustive,
  )
  const message = Match.value(threw).pipe(
    Match.when(true, () => failureMessage),
    Match.when(false, () =>
      Match.value(inverted).pipe(
        Match.when(true, () => `${fullName} was expected to fail, but passed`),
        Match.when(false, () => undefined),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )
  return { status, failureMessage: message }
}
