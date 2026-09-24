import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import type { DrainedStatus, TestOutcome } from './drain-registry.workflow.js'

export interface TestStatusDecision {
  readonly status: DrainedStatus
  readonly failureMessage: string | undefined
}

export interface TestStatusContext {
  readonly inverted: boolean
  readonly fullName: string
}

type DrainOutcomeInput = (TestOutcome & { readonly skipped?: boolean | undefined }) | undefined

const skippedDecision: TestStatusDecision = { status: 'skipped', failureMessage: undefined }

const skippedOf = (outcome: DrainOutcomeInput): boolean =>
  Option.getOrElse(
    Option.map(Option.fromNullishOr(outcome), (present) => present.skipped === true),
    () => false,
  )

const failureMessageOf = (outcome: DrainOutcomeInput): string | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Option.fromNullishOr(outcome), (present) => Option.fromNullishOr(present.failureMessage)),
  )

const statusOf = (threw: boolean, inverted: boolean): DrainedStatus =>
  Match.value(threw === inverted).pipe(
    Match.when(true, (): DrainedStatus => 'success'),
    Match.when(false, (): DrainedStatus => 'failed'),
    Match.exhaustive,
  )

const expectedToFailMessageOf = (inverted: boolean, fullName: string): string | undefined =>
  Match.value(inverted).pipe(
    Match.when(true, () => `${fullName} was expected to fail, but passed`),
    Match.when(false, () => undefined),
    Match.exhaustive,
  )

const failureOf = (
  threw: boolean,
  failureMessage: string | undefined,
  context: TestStatusContext,
): string | undefined =>
  Match.value(threw).pipe(
    Match.when(true, () => failureMessage),
    Match.when(false, () => expectedToFailMessageOf(context.inverted, context.fullName)),
    Match.exhaustive,
  )

const ranDecisionOf = (context: TestStatusContext, outcome: DrainOutcomeInput): TestStatusDecision => {
  const failureMessage = failureMessageOf(outcome)
  const threw = failureMessage !== undefined
  return { status: statusOf(threw, context.inverted), failureMessage: failureOf(threw, failureMessage, context) }
}

export const decideTestStatus = dual<
  (context: TestStatusContext) => (outcome: DrainOutcomeInput) => TestStatusDecision,
  (outcome: DrainOutcomeInput, context: TestStatusContext) => TestStatusDecision
>(
  2,
  (outcome: DrainOutcomeInput, context: TestStatusContext): TestStatusDecision =>
    Match.value(skippedOf(outcome)).pipe(
      Match.when(true, (): TestStatusDecision => skippedDecision),
      Match.when(false, () => ranDecisionOf(context, outcome)),
      Match.exhaustive,
    ),
)
